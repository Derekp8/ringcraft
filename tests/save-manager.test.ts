import { describe, expect, it } from "vitest";
import {
  autoAllocateCreationPoints,
  createCampaign,
  createCreationSession,
  finalizeCreationSession,
  hashCampaignState,
  importCampaignJson,
  advanceCampaignDays,
  rollCreationHistory,
  rollCreationStature,
  serializeCampaign,
  setCreationIdentity,
  setCreationSide,
} from "../src/core";
import type { CampaignState, WrestlerCareerRecord } from "../src/core";
import {
  AUTOSAVE_BUNDLE_SCHEMA,
  AUTOSAVE_KEY_PREFIX,
  BundleStorage,
  CAMPAIGN_LEGACY_SLOT_PREFIX,
  CAMPAIGN_SAVE_PREFIX,
  DEFAULT_AUTOSAVE_MAX_SNAPSHOTS,
  LEGACY_AUTOSAVE_KEY,
  SAVE_BUNDLE_SCHEMA,
  createSave,
  deleteAutosave,
  deleteSave,
  diffSavePreviews,
  duplicateSave,
  exportAutosaveBundle,
  exportSaveBundle,
  importSaveBundle,
  listAutosaves,
  listSaves,
  loadAutosaveSnapshot,
  loadCampaignState,
  overwriteSave,
  planSaveBundleImport,
  applySaveBundlePlan,
  pruneAutosaves,
  readLatestAutosave,
  readSave,
  renameSave,
  saveAutosaveAsNamedSave,
  writeAutosave,
} from "../src/ui/save-manager";
import type { SaveStorage } from "../src/ui/save-manager";
import type { CampaignSave, CampaignSaveBundle } from "../src/ui/save-manager";
import {
  RemoteBundleStorage,
  SYNC_META_KEY,
  bundleContentFingerprint,
} from "../src/ui/remote-save-storage";
import type { HttpClient } from "../src/ui/remote-save-storage";

class FakeStorage implements SaveStorage {
  private readonly map = new Map<string, string>();
  get length(): number { return this.map.size; }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
  entries(): Array<[string, string]> { return [...this.map.entries()]; }
}

/**
 * In-memory stand-in for the remote save endpoint contract: GET returns the
 * stored bundle plus a monotonic revision (404 when empty); PUT applies the
 * bundle only when `expectedRevision` matches (or `force` is true), else 409.
 */
class FakeSaveServer {
  revision = 0;
  bundle: CampaignSaveBundle | null = null;
  /** When true, bumps the revision just before each PUT so compare-and-set fails. */
  bumpBeforePut = false;
  handle: HttpClient = async (_endpoint, request) => {
    if (request.method === "GET") {
      if (!this.bundle) return { status: 404, body: { error: "not found" } };
      return { status: 200, body: { schema: SAVE_BUNDLE_SCHEMA, revision: String(this.revision), bundle: this.bundle } };
    }
    const parsed = JSON.parse(request.body ?? "{}") as { schema?: unknown; expectedRevision?: unknown; force?: unknown; bundle?: unknown };
    if (parsed.schema !== SAVE_BUNDLE_SCHEMA) return { status: 400, body: { error: "bad schema" } };
    if (this.bumpBeforePut) this.revision += 1;
    // An empty server has no revision token yet, so the expected revision is null.
    const current = this.bundle ? String(this.revision) : null;
    if (parsed.force !== true && parsed.expectedRevision !== current) {
      return { status: 409, body: { error: "conflict", currentRevision: current, bundle: this.bundle } };
    }
    this.revision += 1;
    this.bundle = parsed.bundle as CampaignSaveBundle;
    return { status: 200, body: { revision: String(this.revision) } };
  };
}

function makeRecord(seed: number, index: number): WrestlerCareerRecord {
  let session = createCreationSession(seed + index);
  session = setCreationIdentity(session, { name: `Save Test Wrestler ${index}`, epithet: "T", affiliation: "Save Test Roster" });
  session = setCreationSide(session, index % 2 ? "rulebreaker" : "fan-favorite");
  session = rollCreationStature(session);
  session = rollCreationHistory(session);
  session = autoAllocateCreationPoints(session);
  return finalizeCreationSession(session).finalized!;
}

function makeCampaign(seed = 1991): CampaignState {
  const roster = Array.from({ length: 4 }, (_, index) => makeRecord(seed, index));
  return createCampaign({
    name: "Save Manager Test",
    seed,
    startDate: "1991-01-01",
    roster,
    playerEntrantId: roster[0].id,
    playerDivision: "singles",
  });
}

describe("named campaign save manager", () => {
  it("creates named saves with timestamps and a live preview", () => {
    const storage = new FakeStorage();
    const campaign = makeCampaign();
    const meta = createSave(campaign, "Opening Night", storage);
    expect(meta.name).toBe("Opening Night");
    expect(meta.campaignId).toBe(campaign.campaignId);
    expect(meta.preview.campaignName).toBe("Save Manager Test");
    expect(meta.preview.currentDate).toBe("1991-01-01");
    expect(meta.preview.wins).toBe(0);
    expect(meta.preview.playerLabel).toContain("Save Test Wrestler");
    expect(Number.isNaN(Date.parse(meta.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(meta.updatedAt))).toBe(false);
    expect(storage.getItem(`${CAMPAIGN_SAVE_PREFIX}${meta.saveId}`)).not.toBeNull();
  });

  it("lists saves newest first and survives a second save", () => {
    const storage = new FakeStorage();
    const campaign = makeCampaign();
    createSave(campaign, "Opening Night", storage);
    createSave(campaign, "After Month One", storage);
    const list = listSaves(storage);
    expect(list.map((row) => row.name).sort()).toEqual(["After Month One", "Opening Night"]);
    const stamps = list.map((row) => row.updatedAt);
    expect([...stamps].sort().reverse()).toEqual(stamps);
  });

  it("loads a saved campaign with a stable canonical hash", () => {
    const storage = new FakeStorage();
    const campaign = makeCampaign();
    const meta = createSave(campaign, "Checkpoint", storage);
    const loaded = loadCampaignState(meta.saveId, storage);
    expect(loaded.campaignId).toBe(campaign.campaignId);
    expect(hashCampaignState(loaded)).toBe(hashCampaignState(campaign));
    expect(serializeCampaign(loaded)).toBe(serializeCampaign(campaign));
  });

  it("derives a default name from the campaign and date when none is given", () => {
    const storage = new FakeStorage();
    const meta = createSave(makeCampaign(), undefined, storage);
    expect(meta.name).toContain("Save Manager Test");
    expect(meta.name).toContain("1991-01-01");
  });

  it("duplicates a save with a copy name and keeps them independent", () => {
    const storage = new FakeStorage();
    const original = createSave(makeCampaign(), "Draft", storage);
    const copy = duplicateSave(original.saveId, undefined, storage);
    expect(copy.name).toBe("Draft (copy)");
    expect(copy.saveId).not.toBe(original.saveId);
    deleteSave(copy.saveId, storage);
    expect(readSave(copy.saveId, storage)).toBeNull();
    expect(readSave(original.saveId, storage)).not.toBeNull();
  });

  it("renames a save and rejects empty names", () => {
    const storage = new FakeStorage();
    const meta = createSave(makeCampaign(), "Draft", storage);
    const renamed = renameSave(meta.saveId, "  Final Draft  ", storage);
    expect(renamed.name).toBe("Final Draft");
    expect(() => renameSave(meta.saveId, "   ", storage)).toThrow(/empty/i);
    expect(readSave(meta.saveId, storage)?.name).toBe("Final Draft");
  });

  it("overwrites a save in place, keeping its name and id while refreshing the snapshot", () => {
    const storage = new FakeStorage();
    const meta = createSave(makeCampaign(), "Checkpoint", storage);
    const original = readSave(meta.saveId, storage)!;
    const fresh = makeCampaign(2001);
    const updated = overwriteSave(meta.saveId, fresh, undefined, storage);
    expect(updated.saveId).toBe(meta.saveId);
    expect(updated.name).toBe("Checkpoint");
    expect(updated.createdAt).toBe(meta.createdAt);
    expect(updated.campaignId).toBe(fresh.campaignId);
    expect(updated.updatedAt).not.toBe(meta.updatedAt);
    expect(listSaves(storage).map((row) => row.saveId)).toEqual([meta.saveId]);
    const record = readSave(meta.saveId, storage)!;
    expect(record.campaignJson).not.toBe(original.campaignJson);
    expect(loadCampaignState(meta.saveId, storage).campaignId).toBe(fresh.campaignId);
    expect(hashCampaignState(loadCampaignState(meta.saveId, storage))).toBe(hashCampaignState(fresh));
  });

  it("overwriteSave can rename at the same time and rejects missing saves", () => {
    const storage = new FakeStorage();
    const meta = createSave(makeCampaign(), "Checkpoint", storage);
    const updated = overwriteSave(meta.saveId, makeCampaign(2001), "  Fresh Checkpoint  ", storage);
    expect(updated.name).toBe("Fresh Checkpoint");
    expect(() => overwriteSave("missing", makeCampaign(), undefined, storage)).toThrow(/does not exist/i);
  });

  it("deletes a save idempotently", () => {
    const storage = new FakeStorage();
    const meta = createSave(makeCampaign(), "Temporary", storage);
    deleteSave(meta.saveId, storage);
    deleteSave(meta.saveId, storage);
    expect(listSaves(storage)).toEqual([]);
  });

  it("migrates legacy numeric slot keys into named saves and preserves corrupt values", () => {
    const storage = new FakeStorage();
    const campaign = makeCampaign();
    storage.setItem(`${CAMPAIGN_LEGACY_SLOT_PREFIX}1`, serializeCampaign(campaign));
    storage.setItem(`${CAMPAIGN_LEGACY_SLOT_PREFIX}2`, "corrupt-not-json");
    const list = listSaves(storage);
    const migrated = list.find((row) => row.name === "Slot 1");
    expect(migrated).toBeDefined();
    expect(migrated?.campaignId).toBe(campaign.campaignId);
    expect(storage.getItem(`${CAMPAIGN_LEGACY_SLOT_PREFIX}1`)).toBeNull();
    expect(storage.getItem(`${CAMPAIGN_LEGACY_SLOT_PREFIX}2`)).not.toBeNull();
    expect(list.filter((row) => row.name.startsWith("Slot")).length).toBe(1);
  });

  it("skips corrupt payloads when listing and rejects missing or corrupt loads", () => {
    const storage = new FakeStorage();
    storage.setItem(`${CAMPAIGN_SAVE_PREFIX}broken`, "{not json");
    expect(listSaves(storage)).toEqual([]);
    expect(() => loadCampaignState("broken", storage)).toThrow();
    expect(() => loadCampaignState("missing", storage)).toThrow(/does not exist/i);
  });

  it("keeps non-save keys untouched", () => {
    const storage = new FakeStorage();
    storage.setItem("asw91-project-ringcraft-autosave-v1", "autosave-json");
    storage.setItem("unrelated-key", "value");
    createSave(makeCampaign(), "Kept", storage);
    const keys = storage.entries().map(([key]) => key);
    expect(keys).toContain("asw91-project-ringcraft-autosave-v1");
    expect(keys).toContain("unrelated-key");
  });

  it("exports every named save into a single versioned JSON bundle", () => {
    const storage = new FakeStorage();
    createSave(makeCampaign(1991), "Opening Night", storage);
    createSave(makeCampaign(2001), "After Month One", storage);
    const bundle = JSON.parse(exportSaveBundle(storage)) as { schema: string; exportedAt: string; saves: Array<{ key: string; value: string }> };
    expect(bundle.schema).toBe(SAVE_BUNDLE_SCHEMA);
    expect(Number.isNaN(Date.parse(bundle.exportedAt))).toBe(false);
    expect(bundle.saves.length).toBe(2);
    expect(bundle.saves.every((entry) => entry.key.startsWith(CAMPAIGN_SAVE_PREFIX))).toBe(true);
    expect(bundle.saves.every((entry) => parsePayloadShape(entry.value))).toBe(true);
  });

  it("exports the whole autosave snapshot ring into a single archival bundle, newest first", () => {
    const storage = new FakeStorage();
    writeAutosave(makeCampaign(1991), storage, { now: () => "2099-01-01T00:00:00.000Z", maxSnapshots: 10 });
    writeAutosave(makeCampaign(2001), storage, { now: () => "2099-01-02T00:00:00.000Z", maxSnapshots: 10 });
    writeAutosave(makeCampaign(2002), storage, { now: () => "2099-01-03T00:00:00.000Z", maxSnapshots: 10 });
    const bundle = JSON.parse(exportAutosaveBundle(storage)) as { schema: string; exportedAt: string; autosaves: Array<{ key: string; savedAt: string; campaignId: string; campaignHash: string; campaignJson: string }> };
    expect(bundle.schema).toBe(AUTOSAVE_BUNDLE_SCHEMA);
    expect(Number.isNaN(Date.parse(bundle.exportedAt))).toBe(false);
    expect(bundle.autosaves.length).toBe(3);
    // Newest first: the ring's canonical ordering, so no snapshot is ever merged away.
    expect(bundle.autosaves[0].savedAt).toBe("2099-01-03T00:00:00.000Z");
    expect(bundle.autosaves[2].savedAt).toBe("2099-01-01T00:00:00.000Z");
    // Every entry is faithful to the stored snapshot: same key, hash, and bytes.
    for (const entry of bundle.autosaves) {
      expect(entry.key.startsWith(AUTOSAVE_KEY_PREFIX)).toBe(true);
      expect(entry.campaignHash).toBe(hashCampaignState(JSON.parse(entry.campaignJson) as CampaignState));
      const stored = JSON.parse(storage.getItem(entry.key)!) as { campaignJson: string; campaignHash: string };
      expect(entry.campaignJson).toBe(stored.campaignJson);
      expect(entry.campaignHash).toBe(stored.campaignHash);
    }
  });

  it("exports an empty ring as an empty autosave bundle", () => {
    const storage = new FakeStorage();
    const bundle = JSON.parse(exportAutosaveBundle(storage)) as { schema: string; autosaves: unknown[] };
    expect(bundle.schema).toBe(AUTOSAVE_BUNDLE_SCHEMA);
    expect(bundle.autosaves).toEqual([]);
  });

  it("round-trips every save through the bundle byte-identically", () => {
    const storage = new FakeStorage();
    const first = createSave(makeCampaign(1991), "Opening Night", storage);
    const second = createSave(makeCampaign(2001), "After Month One", storage);
    const raw = storage.getItem(`${CAMPAIGN_SAVE_PREFIX}${first.saveId}`);
    const otherRaw = storage.getItem(`${CAMPAIGN_SAVE_PREFIX}${second.saveId}`);
    const bundle = exportSaveBundle(storage);
    const target = new FakeStorage();
    const result = importSaveBundle(bundle, target);
    expect(result).toEqual({ imported: 2, merged: 0, keptLocal: 0, skipped: 0 });
    expect(target.getItem(`${CAMPAIGN_SAVE_PREFIX}${first.saveId}`)).toBe(raw);
    expect(target.getItem(`${CAMPAIGN_SAVE_PREFIX}${second.saveId}`)).toBe(otherRaw);
    const listed = listSaves(target).map((row) => row.name).sort();
    expect(listed).toEqual(["After Month One", "Opening Night"]);
  });

  it("restores a loaded campaign from an imported bundle with a stable hash", () => {
    const storage = new FakeStorage();
    const campaign = makeCampaign();
    const meta = createSave(campaign, "Checkpoint", storage);
    const target = new FakeStorage();
    importSaveBundle(exportSaveBundle(storage), target);
    const loaded = loadCampaignState(meta.saveId, target);
    expect(hashCampaignState(loaded)).toBe(hashCampaignState(campaign));
  });

  it("skips corrupt and non-save entries when importing, never touching valid ones", () => {
    const storage = new FakeStorage();
    const meta = createSave(makeCampaign(), "Valid", storage);
    const bundle = JSON.parse(exportSaveBundle(storage)) as { schema: string; exportedAt: string; saves: Array<{ key: string; value: string }> };
    bundle.saves.push(
      { key: `${CAMPAIGN_SAVE_PREFIX}corrupt`, value: "{not json" },
      { key: `${CAMPAIGN_SAVE_PREFIX}missing-field`, value: JSON.stringify({ saveId: "x" }) },
      { key: "unrelated-key", value: "whatever" },
      { key: `${CAMPAIGN_SAVE_PREFIX}bad-type`, value: "123" },
    );
    const target = new FakeStorage();
    const result = importSaveBundle(JSON.stringify(bundle), target);
    expect(result).toEqual({ imported: 1, merged: 0, keptLocal: 0, skipped: 4 });
    expect(listSaves(target).map((row) => row.saveId)).toEqual([meta.saveId]);
    expect(target.getItem("unrelated-key")).toBeNull();
  });

  it("rejects unparsable documents and unsupported schemas", () => {
    expect(() => importSaveBundle("{not json", new FakeStorage())).toThrow(/not valid JSON/i);
    expect(() => importSaveBundle(JSON.stringify({ schema: "asw91-campaign-save-bundle-v9", saves: [] }), new FakeStorage())).toThrow(/unsupported.*schema/i);
    expect(() => importSaveBundle(JSON.stringify({ schema: SAVE_BUNDLE_SCHEMA }), new FakeStorage())).toThrow(/saves array/i);
    expect(() => importSaveBundle("42", new FakeStorage())).toThrow(/JSON object/i);
  });

  it("BundleStorage is a second backend that round-trips through a single bundle string", () => {
    const source = new FakeStorage();
    const meta = createSave(makeCampaign(), "Portable", source);
    const rawBundle = exportSaveBundle(source);
    const bundle = JSON.parse(rawBundle) as { exportedAt: string; saves: Array<{ key: string; value: string }> };
    const restored = BundleStorage.fromBundle(rawBundle);
    expect(restored.length).toBe(1);
    expect(restored.getItem(`${CAMPAIGN_SAVE_PREFIX}${meta.saveId}`)).toBe(source.getItem(`${CAMPAIGN_SAVE_PREFIX}${meta.saveId}`));
    const again = JSON.parse(exportSaveBundle(restored)) as { saves: Array<{ key: string; value: string }> };
    expect(again.saves).toEqual(bundle.saves);
    expect(loadCampaignState(meta.saveId, restored).campaignId).toBe(meta.campaignId);
  });

  it("merges a newer same-campaign save in place, keeping the local identity", () => {
    const storage = new FakeStorage();
    const campaign = makeCampaign();
    const meta = createSave(campaign, "Local Career", storage);
    const incoming: CampaignSave = {
      ...readSave(meta.saveId, storage)!,
      saveId: "incoming-id",
      name: "Incoming Career",
      updatedAt: "2099-01-01T00:00:00.000Z",
    };
    const bundle = { schema: SAVE_BUNDLE_SCHEMA, exportedAt: "2099-01-01T00:00:00.000Z", saves: [{ key: `${CAMPAIGN_SAVE_PREFIX}incoming-id`, value: JSON.stringify(incoming) }] };
    const result = importSaveBundle(JSON.stringify(bundle), storage);
    expect(result).toEqual({ imported: 0, merged: 1, keptLocal: 0, skipped: 0 });
    expect(listSaves(storage).map((row) => row.saveId)).toEqual([meta.saveId]);
    expect(storage.getItem(`${CAMPAIGN_SAVE_PREFIX}incoming-id`)).toBeNull();
    const record = readSave(meta.saveId, storage)!;
    expect(record.name).toBe("Local Career");
    expect(record.createdAt).toBe(meta.createdAt);
    expect(record.updatedAt).toBe("2099-01-01T00:00:00.000Z");
    expect(loadCampaignState(meta.saveId, storage).campaignId).toBe(campaign.campaignId);
  });

  it("keeps the existing same-campaign save when the incoming one is older or tied", () => {
    const storage = new FakeStorage();
    const meta = createSave(makeCampaign(), "Local Career", storage);
    const base = readSave(meta.saveId, storage)!;
    const older = { ...base, saveId: "incoming-old", updatedAt: "1990-01-01T00:00:00.000Z" };
    const tied = { ...base, saveId: "incoming-tie", updatedAt: meta.updatedAt };
    const bundle = {
      schema: SAVE_BUNDLE_SCHEMA,
      exportedAt: "2099-01-01T00:00:00.000Z",
      saves: [
        { key: `${CAMPAIGN_SAVE_PREFIX}incoming-old`, value: JSON.stringify(older) },
        { key: `${CAMPAIGN_SAVE_PREFIX}incoming-tie`, value: JSON.stringify(tied) },
      ],
    };
    const result = importSaveBundle(JSON.stringify(bundle), storage);
    expect(result).toEqual({ imported: 0, merged: 0, keptLocal: 2, skipped: 0 });
    expect(listSaves(storage).map((row) => row.saveId)).toEqual([meta.saveId]);
    expect(readSave(meta.saveId, storage)!.updatedAt).toBe(meta.updatedAt);
  });

  it("dedupes same-campaign entries within a single bundle by the newest updatedAt", () => {
    const source = new FakeStorage();
    const template = readSave(createSave(makeCampaign(), "Template", source).saveId, source)!;
    const older = { ...template, saveId: "dup-old", updatedAt: "1991-01-01T00:00:00.000Z" };
    const newer = { ...template, saveId: "dup-new", updatedAt: "1991-06-01T00:00:00.000Z" };
    const target = new FakeStorage();
    const bundle = {
      schema: SAVE_BUNDLE_SCHEMA,
      exportedAt: "1991-06-01T00:00:00.000Z",
      saves: [
        { key: `${CAMPAIGN_SAVE_PREFIX}dup-old`, value: JSON.stringify(older) },
        { key: `${CAMPAIGN_SAVE_PREFIX}dup-new`, value: JSON.stringify(newer) },
      ],
    };
    const result = importSaveBundle(JSON.stringify(bundle), target);
    expect(result).toEqual({ imported: 1, merged: 1, keptLocal: 0, skipped: 0 });
    const listed = listSaves(target);
    expect(listed.length).toBe(1);
    expect(listed[0].updatedAt).toBe("1991-06-01T00:00:00.000Z");
    expect(target.getItem(`${CAMPAIGN_SAVE_PREFIX}dup-new`)).toBeNull();
  });

  it("counts imported, merged, kept, and skipped entries in one import", () => {
    const storage = new FakeStorage();
    const meta = createSave(makeCampaign(), "Existing", storage);
    const base = readSave(meta.saveId, storage)!;
    const newerIncoming = { ...base, saveId: "in-newer", name: "Newer", updatedAt: "2099-01-01T00:00:00.000Z" };
    const olderIncoming = { ...base, saveId: "in-older", name: "Older", updatedAt: "1990-01-01T00:00:00.000Z" };
    const freshSource = new FakeStorage();
    const freshIncoming = readSave(createSave(makeCampaign(3001), "Fresh", freshSource).saveId, freshSource)!;
    const bundle = {
      schema: SAVE_BUNDLE_SCHEMA,
      exportedAt: "2099-01-01T00:00:00.000Z",
      saves: [
        { key: `${CAMPAIGN_SAVE_PREFIX}${freshIncoming.saveId}`, value: JSON.stringify(freshIncoming) },
        { key: `${CAMPAIGN_SAVE_PREFIX}in-newer`, value: JSON.stringify(newerIncoming) },
        { key: `${CAMPAIGN_SAVE_PREFIX}in-older`, value: JSON.stringify(olderIncoming) },
        { key: `${CAMPAIGN_SAVE_PREFIX}broken`, value: "{not json" },
      ],
    };
    const result = importSaveBundle(JSON.stringify(bundle), storage);
    expect(result).toEqual({ imported: 1, merged: 1, keptLocal: 1, skipped: 1 });
    expect(listSaves(storage).map((row) => row.name).sort()).toEqual(["Existing", "Fresh"]);
    expect(listSaves(storage).length).toBe(2);
  });
});

describe("save bundle import plan (merge preview)", () => {
  function mixedBundle(base: CampaignSave): string {
    const newerIncoming = { ...base, saveId: "in-newer", name: "Newer", updatedAt: "2099-01-01T00:00:00.000Z" };
    const olderIncoming = { ...base, saveId: "in-older", name: "Older", updatedAt: "1990-01-01T00:00:00.000Z" };
    const freshSource = new FakeStorage();
    const freshIncoming = readSave(createSave(makeCampaign(3001), "Fresh", freshSource).saveId, freshSource)!;
    return JSON.stringify({
      schema: SAVE_BUNDLE_SCHEMA,
      exportedAt: "2099-01-01T00:00:00.000Z",
      saves: [
        { key: `${CAMPAIGN_SAVE_PREFIX}${freshIncoming.saveId}`, value: JSON.stringify(freshIncoming) },
        { key: `${CAMPAIGN_SAVE_PREFIX}in-newer`, value: JSON.stringify(newerIncoming) },
        { key: `${CAMPAIGN_SAVE_PREFIX}in-older`, value: JSON.stringify(olderIncoming) },
        { key: `${CAMPAIGN_SAVE_PREFIX}broken`, value: "{not json" },
      ],
    });
  }

  it("classifies every entry up front without touching storage", () => {
    const storage = new FakeStorage();
    const meta = createSave(makeCampaign(), "Existing", storage);
    const before = storage.entries();
    const plan = planSaveBundleImport(mixedBundle(readSave(meta.saveId, storage)!), storage);
    expect(plan.totals).toEqual({ imported: 1, merged: 1, keptLocal: 1, skipped: 1 });
    expect(plan.rows.map((row) => row.outcome)).toEqual(["imported", "merged", "keptLocal", "skipped"]);
    expect(storage.entries()).toEqual(before);
    expect(plan.rows[0].preview?.campaignName).toBe("Save Manager Test");
    expect(plan.rows[0].existingPreview).toBeNull();
    expect(plan.rows[1].existingName).toBe("Existing");
    expect(plan.rows[1].existingPreview).not.toBeNull();
    expect(plan.rows[1].existingPreview?.campaignName).toBe("Save Manager Test");
    expect(plan.rows[1].reason).toMatch(/update "Existing" in place/);
    expect(plan.rows[2].existingPreview).not.toBeNull();
    expect(plan.rows[2].reason).toMatch(/Kept "Existing"/);
    expect(plan.rows[3].reason).toMatch(/Unreadable/);
  });

  it("surfaces a validated stored-vs-incoming diff hint on merged rows so the merge decision is visible", () => {
    const storage = new FakeStorage();
    const meta = createSave(makeCampaign(), "Existing", storage);
    const stored = readSave(meta.saveId, storage)!;

    const incomingStorage = new FakeStorage();
    const advanced = advanceCampaignDays(makeCampaign(), 31);
    const advancedMeta = createSave(advanced, "Newer", incomingStorage);
    const incoming: CampaignSave = {
      ...readSave(advancedMeta.saveId, incomingStorage)!,
      saveId: "in-newer",
      name: "Newer",
      createdAt: stored.createdAt,
      updatedAt: "2099-01-01T00:00:00.000Z",
    };
    expect(incoming.campaignId).toBe(stored.campaignId);

    const bundle = JSON.stringify({ schema: SAVE_BUNDLE_SCHEMA, exportedAt: "2099-01-01T00:00:00.000Z", saves: [{ key: `${CAMPAIGN_SAVE_PREFIX}in-newer`, value: JSON.stringify(incoming) }] });
    const plan = planSaveBundleImport(bundle, storage);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].outcome).toBe("merged");
    expect(plan.rows[0].existingPreview).toEqual(stored.preview);
    expect(plan.rows[0].preview).toEqual(incoming.preview);
    const diff = diffSavePreviews(plan.rows[0].existingPreview, plan.rows[0].preview);
    expect(diff).toContain("Date: 1991-01-01 -> 1991-02-01");
  });

  it("reports an empty diff hint when stored and incoming previews match", () => {
    const storage = new FakeStorage();
    const meta = createSave(makeCampaign(), "Existing", storage);
    const stored = readSave(meta.saveId, storage)!;
    expect(diffSavePreviews(stored.preview, stored.preview)).toEqual([]);
    expect(diffSavePreviews(null, stored.preview)).toEqual([]);
  });

  it("applying the plan produces the same storage state as importSaveBundle", () => {
    const planned = new FakeStorage();
    const plannedMeta = createSave(makeCampaign(), "Existing", planned);
    const applied = new FakeStorage();
    createSave(makeCampaign(), "Existing", applied);
    const bundle = mixedBundle(readSave(plannedMeta.saveId, planned)!);
    const plan = planSaveBundleImport(bundle, planned);
    expect(applySaveBundlePlan(plan, planned)).toEqual({ imported: 1, merged: 1, keptLocal: 1, skipped: 1 });
    expect(importSaveBundle(bundle, applied)).toEqual({ imported: 1, merged: 1, keptLocal: 1, skipped: 1 });
    expect(listSaves(planned).map((row) => ({ name: row.name, updatedAt: row.updatedAt }))).toEqual(listSaves(applied).map((row) => ({ name: row.name, updatedAt: row.updatedAt })));
  });

  it("plans a bundle with no saves and reports it", () => {
    const plan = planSaveBundleImport(JSON.stringify({ schema: SAVE_BUNDLE_SCHEMA, exportedAt: "2099-01-01T00:00:00.000Z", saves: [] }), new FakeStorage());
    expect(plan.rows).toEqual([]);
    expect(plan.totals).toEqual({ imported: 0, merged: 0, keptLocal: 0, skipped: 0 });
  });

  it("plan validation errors mirror importSaveBundle exactly", () => {
    const storage = new FakeStorage();
    expect(() => planSaveBundleImport("{not json", storage)).toThrow(/not valid JSON/i);
    expect(() => planSaveBundleImport(JSON.stringify({ schema: "asw91-campaign-save-bundle-v9", saves: [] }), storage)).toThrow(/unsupported.*schema/i);
    expect(() => planSaveBundleImport(JSON.stringify({ schema: SAVE_BUNDLE_SCHEMA }), storage)).toThrow(/saves array/i);
    expect(() => planSaveBundleImport("42", storage)).toThrow(/JSON object/i);
  });
});

describe("autosave versioning", () => {
  function stamped(storage: SaveStorage, campaign: CampaignState, savedAt: string) {
    return writeAutosave(campaign, storage, { now: () => savedAt });
  }

  it("writes a versioned snapshot with a timestamp envelope and canonical hash", () => {
    const storage = new FakeStorage();
    const campaign = makeCampaign();
    const meta = stamped(storage, campaign, "2099-01-01T00:00:00.000Z");
    expect(meta.key).toBe(`${AUTOSAVE_KEY_PREFIX}2099-01-01T00:00:00.000Z-000001`);
    expect(meta.savedAt).toBe("2099-01-01T00:00:00.000Z");
    expect(meta.campaignId).toBe(campaign.campaignId);
    expect(meta.campaignHash).toBe(hashCampaignState(campaign));
    const raw = JSON.parse(storage.getItem(meta.key)!) as { schema: string; savedAt: string; campaignJson: string };
    expect(raw.schema).toBe("asw91-project-ringcraft-autosave-snapshot-v1");
    expect(raw.savedAt).toBe("2099-01-01T00:00:00.000Z");
    expect(importCampaignJson(raw.campaignJson).state.campaignId).toBe(campaign.campaignId);
  });

  it("keeps only the newest N snapshots, pruning the oldest", () => {
    const storage = new FakeStorage();
    for (let day = 1; day <= 7; day += 1) stamped(storage, makeCampaign(), `2099-01-0${day}T00:00:00.000Z`);
    const list = listAutosaves(storage);
    expect(list.length).toBe(DEFAULT_AUTOSAVE_MAX_SNAPSHOTS);
    expect(list[0].savedAt).toBe("2099-01-07T00:00:00.000Z");
    expect(list.at(-1)!.savedAt).toBe("2099-01-03T00:00:00.000Z");
    expect(storage.getItem(`${AUTOSAVE_KEY_PREFIX}2099-01-01T00:00:00.000Z-000001`)).toBeNull();
    expect(storage.getItem(`${AUTOSAVE_KEY_PREFIX}2099-01-02T00:00:00.000Z-000002`)).toBeNull();
  });

  it("readLatestAutosave returns the newest snapshot with a stable hash", () => {
    const storage = new FakeStorage();
    const first = makeCampaign(1991);
    const second = makeCampaign(2001);
    stamped(storage, first, "2099-01-01T00:00:00.000Z");
    stamped(storage, second, "2099-01-02T00:00:00.000Z");
    const latest = readLatestAutosave(storage)!;
    expect(hashCampaignState(latest)).toBe(hashCampaignState(second));
    expect(latest.campaignId).toBe(second.campaignId);
  });

  it("loads a specific older snapshot and validates the campaign on load", () => {
    const storage = new FakeStorage();
    const first = makeCampaign(1991);
    const second = makeCampaign(2001);
    const firstMeta = stamped(storage, first, "2099-01-01T00:00:00.000Z");
    stamped(storage, second, "2099-01-02T00:00:00.000Z");
    const restored = loadAutosaveSnapshot(firstMeta.key, storage);
    expect(hashCampaignState(restored)).toBe(hashCampaignState(first));
    expect(() => loadAutosaveSnapshot(`${AUTOSAVE_KEY_PREFIX}missing`, storage)).toThrow(/does not exist/i);
  });

  it("falls back to the legacy single-key autosave and migrates it on the first versioned write", () => {
    const storage = new FakeStorage();
    const campaign = makeCampaign();
    storage.setItem(LEGACY_AUTOSAVE_KEY, serializeCampaign(campaign));
    expect(hashCampaignState(readLatestAutosave(storage)!)).toBe(hashCampaignState(campaign));
    const meta = stamped(storage, makeCampaign(2001), "2099-01-01T00:00:00.000Z");
    expect(storage.getItem(LEGACY_AUTOSAVE_KEY)).toBeNull();
    expect(listAutosaves(storage).length).toBe(1);
    expect(listAutosaves(storage)[0].key).toBe(meta.key);
  });

  it("skips corrupt snapshots when listing and reading the latest", () => {
    const storage = new FakeStorage();
    const campaign = makeCampaign();
    stamped(storage, campaign, "2099-01-02T00:00:00.000Z");
    storage.setItem(`${AUTOSAVE_KEY_PREFIX}2099-01-03T00:00:00.000Z`, "{not json");
    const list = listAutosaves(storage);
    expect(list.length).toBe(1);
    expect(list[0].savedAt).toBe("2099-01-02T00:00:00.000Z");
    expect(hashCampaignState(readLatestAutosave(storage)!)).toBe(hashCampaignState(campaign));
  });

  it("pruneAutosaves removes the oldest beyond a custom cap", () => {
    const storage = new FakeStorage();
    for (let day = 1; day <= 4; day += 1) stamped(storage, makeCampaign(), `2099-01-0${day}T00:00:00.000Z`);
    const removed = pruneAutosaves(storage, 2);
    expect(removed).toBe(2);
    expect(listAutosaves(storage).map((row) => row.savedAt)).toEqual(["2099-01-04T00:00:00.000Z", "2099-01-03T00:00:00.000Z"]);
  });

  it("writeAutosave honors a custom snapshot cap", () => {
    const storage = new FakeStorage();
    for (let day = 1; day <= 5; day += 1) stamped(storage, makeCampaign(), `2099-01-0${day}T00:00:00.000Z`);
    expect(listAutosaves(storage).length).toBe(5);
    writeAutosave(makeCampaign(), storage, { now: () => "2099-01-06T00:00:00.000Z", maxSnapshots: 3 });
    expect(listAutosaves(storage).map((row) => row.savedAt)).toEqual(["2099-01-06T00:00:00.000Z", "2099-01-05T00:00:00.000Z", "2099-01-04T00:00:00.000Z"]);
  });

  it("deleteAutosave removes exactly one snapshot and rejects foreign keys", () => {
    const storage = new FakeStorage();
    stamped(storage, makeCampaign(), "2099-01-01T00:00:00.000Z");
    const second = stamped(storage, makeCampaign(2001), "2099-01-02T00:00:00.000Z");
    stamped(storage, makeCampaign(3001), "2099-01-03T00:00:00.000Z");
    expect(listAutosaves(storage).length).toBe(3);
    deleteAutosave(second.key, storage);
    expect(listAutosaves(storage).map((row) => row.savedAt)).toEqual(["2099-01-03T00:00:00.000Z", "2099-01-01T00:00:00.000Z"]);
    deleteAutosave(second.key, storage);
    expect(listAutosaves(storage).length).toBe(2);
    expect(() => deleteAutosave(`${CAMPAIGN_SAVE_PREFIX}whatever`, storage)).toThrow(/not an autosave snapshot key/i);
  });

  it("saveAutosaveAsNamedSave promotes a snapshot into a named save with a stable hash", () => {
    const storage = new FakeStorage();
    const campaign = makeCampaign(1991);
    const older = stamped(storage, campaign, "2099-01-01T00:00:00.000Z");
    stamped(storage, makeCampaign(2001), "2099-01-02T00:00:00.000Z");
    const meta = saveAutosaveAsNamedSave(older.key, "Promoted", storage);
    expect(meta.name).toBe("Promoted");
    expect(meta.campaignId).toBe(campaign.campaignId);
    expect(hashCampaignState(loadCampaignState(meta.saveId, storage))).toBe(hashCampaignState(campaign));
    expect(listAutosaves(storage).length).toBe(2);
  });

  it("saveAutosaveAsNamedSave derives the name when none is given", () => {
    const storage = new FakeStorage();
    const campaign = makeCampaign(1991);
    const meta = stamped(storage, campaign, "2099-01-01T00:00:00.000Z");
    const promoted = saveAutosaveAsNamedSave(meta.key, undefined, storage);
    expect(promoted.name).toBe(`${campaign.name} - ${campaign.currentDate}`);
  });
});

describe("remote save sync backend", () => {
  function storageWithSave(name = "Local Save"): FakeStorage {
    const storage = new FakeStorage();
    createSave(makeCampaign(), name, storage);
    return storage;
  }

  it("computes a stable content fingerprint that ignores the export timestamp", () => {
    const bundleA = { schema: SAVE_BUNDLE_SCHEMA, exportedAt: "1991-01-01T00:00:00.000Z", saves: [{ key: "asw91-campaign-save-a", value: "x" }] };
    const bundleB = { schema: SAVE_BUNDLE_SCHEMA, exportedAt: "1991-06-01T00:00:00.000Z", saves: [{ key: "asw91-campaign-save-a", value: "x" }] };
    const bundleC = { schema: SAVE_BUNDLE_SCHEMA, exportedAt: "1991-01-01T00:00:00.000Z", saves: [{ key: "asw91-campaign-save-a", value: "y" }] };
    expect(bundleContentFingerprint(bundleA)).toBe(bundleContentFingerprint(bundleB));
    expect(bundleContentFingerprint(bundleA)).not.toBe(bundleContentFingerprint(bundleC));
  });

  it("sends the configured auth token as a Bearer header on every request", async () => {
    const server = new FakeSaveServer();
    const storage = storageWithSave("Opening Night");
    const seen: Array<{ method: "GET" | "PUT"; headers?: Record<string, string> }> = [];
    const recording: HttpClient = async (endpoint, request) => {
      seen.push({ method: request.method, headers: request.headers });
      return server.handle(endpoint, request);
    };
    const remote = new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: recording, storage, authToken: "s3cret" });
    const result = await remote.sync();
    expect(result.status).toBe("pushed");
    // A first sync issues a GET (probe) then a PUT (push); both carry the token.
    expect(seen.length).toBe(2);
    for (const request of seen) expect(request.headers?.authorization).toBe("Bearer s3cret");
    // Force push and force pull carry it too.
    seen.length = 0;
    await remote.forcePush();
    expect(seen.length).toBe(1);
    expect(seen[0].headers?.authorization).toBe("Bearer s3cret");
    seen.length = 0;
    await remote.forcePull();
    expect(seen.length).toBe(1);
    expect(seen[0].headers?.authorization).toBe("Bearer s3cret");
  });

  it("omits the Authorization header when no token is configured", async () => {
    const server = new FakeSaveServer();
    const storage = storageWithSave("Opening Night");
    const seen: Array<{ headers?: Record<string, string> }> = [];
    const recording: HttpClient = async (endpoint, request) => {
      seen.push({ headers: request.headers });
      return server.handle(endpoint, request);
    };
    const remote = new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: recording, storage });
    expect((await remote.sync()).status).toBe("pushed");
    expect(seen.length).toBe(2);
    for (const request of seen) expect(request.headers?.authorization).toBeUndefined();
  });

  it("first sync pushes local saves to an empty server and records the baseline", async () => {
    const server = new FakeSaveServer();
    const storage = storageWithSave("Opening Night");
    const remote = new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage });
    const result = await remote.sync();
    expect(result.status).toBe("pushed");
    expect(server.bundle?.saves.length).toBe(1);
    const payloadKey = `${CAMPAIGN_SAVE_PREFIX}${listSaves(storage)[0].saveId}`;
    expect(server.bundle?.saves[0].value).toBe(storage.getItem(payloadKey));
    const meta = remote.syncMeta();
    expect(meta.lastRemoteRevision).toBe("1");
    expect(meta.lastSyncedFingerprint).toBe(remote.currentFingerprint());
    expect(storage.getItem(SYNC_META_KEY)).not.toBeNull();
    expect((await remote.sync()).status).toBe("up-to-date");
  });

  it("pushes local edits after the baseline", async () => {
    const server = new FakeSaveServer();
    const storage = new FakeStorage();
    const remote = new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage });
    createSave(makeCampaign(), "First", storage);
    expect((await remote.sync()).status).toBe("pushed");
    createSave(makeCampaign(2001), "Second", storage);
    const result = await remote.sync();
    expect(result.status).toBe("pushed");
    expect(server.bundle?.saves.length).toBe(2);
  });

  it("pulls the remote snapshot when only the remote advanced", async () => {
    const server = new FakeSaveServer();
    const storage = storageWithSave("Mine");
    const remote = new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage });
    await remote.sync();
    // A second client (sharing the server) adds a save on top of the same set.
    const otherStorage = new FakeStorage();
    importSaveBundle(exportSaveBundle(storage), otherStorage);
    createSave(makeCampaign(2001), "From Another Device", otherStorage);
    await new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage: otherStorage }).forcePush();
    expect(server.revision).toBe(2);
    const result = await remote.sync();
    expect(result.status).toBe("pulled");
    expect(listSaves(storage).map((row) => row.name).sort()).toEqual(["From Another Device", "Mine"]);
  });

  it("reports a conflict when both sides changed and touches neither side", async () => {
    const server = new FakeSaveServer();
    const storage = storageWithSave("Mine");
    const remote = new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage });
    await remote.sync();
    // Remote advances by adding a save.
    const otherStorage = new FakeStorage();
    importSaveBundle(exportSaveBundle(storage), otherStorage);
    createSave(makeCampaign(2001), "Remote New", otherStorage);
    await new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage: otherStorage }).forcePush();
    // Local changes too.
    createSave(makeCampaign(2002), "Local New", storage);
    const result = await remote.sync();
    expect(result.status).toBe("conflict");
    expect(listSaves(storage).some((row) => row.name === "Local New")).toBe(true);
    expect(listSaves(storage).some((row) => row.name === "Remote New")).toBe(false);
    expect(server.bundle?.saves.some((entry) => entry.value.includes("Local New"))).toBe(false);
    // Resolve by keeping local.
    const pushed = await remote.forcePush();
    expect(pushed.status).toBe("pushed");
    expect(server.bundle?.saves.some((entry) => entry.value.includes("Local New"))).toBe(true);
  });

  it("forcePull resolves a conflict by taking the remote side", async () => {
    const server = new FakeSaveServer();
    const storage = storageWithSave("Mine");
    const remote = new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage });
    await remote.sync();
    const otherStorage = new FakeStorage();
    importSaveBundle(exportSaveBundle(storage), otherStorage);
    createSave(makeCampaign(2001), "Remote New", otherStorage);
    await new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage: otherStorage }).forcePush();
    createSave(makeCampaign(2002), "Local New", storage);
    expect((await remote.sync()).status).toBe("conflict");
    const pulled = await remote.forcePull();
    expect(pulled.status).toBe("pulled");
    expect(listSaves(storage).map((row) => row.name).sort()).toEqual(["Mine", "Remote New"]);
    expect(listSaves(storage).some((row) => row.name === "Local New")).toBe(false);
  });

  it("first sync against a populated server with local data is a safe conflict", async () => {
    const server = new FakeSaveServer();
    const otherStorage = storageWithSave("Server Save");
    await new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage: otherStorage }).forcePush();
    const freshStorage = new FakeStorage();
    createSave(makeCampaign(2001), "Local Save", freshStorage);
    const remote = new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage: freshStorage });
    const result = await remote.sync();
    expect(result.status).toBe("conflict");
    expect(server.bundle?.saves.length).toBe(1);
  });

  it("first sync adopts a populated remote on an empty local device", async () => {
    const server = new FakeSaveServer();
    const otherStorage = storageWithSave("Server Save");
    await new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage: otherStorage }).forcePush();
    const fresh = new FakeStorage();
    const remote = new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage: fresh });
    const result = await remote.sync();
    expect(result.status).toBe("pulled");
    expect(listSaves(fresh).map((row) => row.name)).toEqual(["Server Save"]);
  });

  it("pull replaces the local named-save set so remote deletions propagate", async () => {
    const server = new FakeSaveServer();
    const storage = new FakeStorage();
    const remote = new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage });
    createSave(makeCampaign(1991), "One", storage);
    createSave(makeCampaign(2001), "Two", storage);
    await remote.sync();
    // Remote drops "Two" and adds "Three".
    const otherStorage = new FakeStorage();
    createSave(makeCampaign(1991), "One", otherStorage);
    createSave(makeCampaign(2002), "Three", otherStorage);
    await new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage: otherStorage }).forcePush();
    const result = await remote.sync();
    expect(result.status).toBe("pulled");
    expect(listSaves(storage).map((row) => row.name).sort()).toEqual(["One", "Three"]);
  });

  it("turns a mid-sync compare-and-set rejection into a conflict result", async () => {
    const server = new FakeSaveServer();
    const storage = new FakeStorage();
    const remote = new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage });
    createSave(makeCampaign(), "Only", storage);
    await remote.sync();
    server.bumpBeforePut = true;
    createSave(makeCampaign(), "Second", storage);
    const result = await remote.sync();
    expect(result.status).toBe("conflict");
    expect(remote.syncMeta().lastRemoteRevision).toBe("1");
    expect(server.bundle?.saves.length).toBe(1);
  });

  it("forcePull with an empty remote clears the local named saves", async () => {
    const server = new FakeSaveServer();
    const storage = storageWithSave("Temporary");
    const remote = new RemoteBundleStorage({ endpoint: "https://example.test/saves", http: server.handle, storage });
    const result = await remote.forcePull();
    expect(result.status).toBe("pulled");
    expect(listSaves(storage)).toEqual([]);
    expect((await remote.sync()).status).toBe("up-to-date");
  });
});

function parsePayloadShape(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { saveId?: unknown; name?: unknown; campaignId?: unknown; campaignJson?: unknown };
    return typeof parsed.saveId === "string" && typeof parsed.name === "string" && typeof parsed.campaignId === "string" && typeof parsed.campaignJson === "string";
  } catch {
    return false;
  }
}
