import { describe, expect, it } from "vitest";
import { hashCampaignState } from "../src/core";
import { loadCompletedM5Fixture } from "../src/ui/playtest-fixtures";
import {
  AUTOSAVE_KEY_PREFIX,
  CAMPAIGN_SAVE_PREFIX,
  applySaveBundlePlan,
  buildCampaignSavePreview,
  createSave,
  importSaveBundle,
  listAutosaves,
  loadAutosaveSnapshot,
  loadCampaignState,
  planSaveBundleImport,
  readSave,
  writeAutosave,
} from "../src/ui/save-manager";
import type { CampaignSave, SaveStorage } from "../src/ui/save-manager";

class MemoryStorage implements SaveStorage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
}

function bundle(record: CampaignSave): string {
  return JSON.stringify({
    schema: "asw91-campaign-save-bundle-v1",
    exportedAt: "2099-01-01T00:00:00.000Z",
    saves: [{ key: `${CAMPAIGN_SAVE_PREFIX}${record.saveId}`, value: JSON.stringify(record) }],
  });
}

describe("QA remediation: save bundle validation", () => {
  it("never replaces a valid local save with newer corrupt campaign JSON", () => {
    const storage = new MemoryStorage();
    const campaign = loadCompletedM5Fixture();
    const meta = createSave(campaign, "Local good save", storage);
    const before = readSave(meta.saveId, storage)!;
    const incoming: CampaignSave = { ...before, updatedAt: "2099-01-01T00:00:00.000Z", campaignJson: "{" };

    const plan = planSaveBundleImport(bundle(incoming), storage);
    expect(plan.totals).toEqual({ imported: 0, merged: 0, keptLocal: 0, skipped: 1 });
    expect(plan.rows[0].reason).toContain("Campaign payload failed validation");
    expect(importSaveBundle(bundle(incoming), storage).skipped).toBe(1);
    expect(hashCampaignState(loadCampaignState(meta.saveId, storage))).toBe(hashCampaignState(campaign));
  });

  it("rejects an outer campaignId that differs from the validated inner campaign", () => {
    const source = new MemoryStorage();
    const campaign = loadCompletedM5Fixture();
    const meta = createSave(campaign, "Source", source);
    const incoming = { ...readSave(meta.saveId, source)!, campaignId: "forged-campaign", updatedAt: "2099-01-01T00:00:00.000Z" };
    const plan = planSaveBundleImport(bundle(incoming), new MemoryStorage());
    expect(plan.totals.skipped).toBe(1);
    expect(plan.rows[0].reason).toContain("does not match inner campaign");
  });

  it("derives preview data from the validated campaign instead of trusting bundle metadata", () => {
    const source = new MemoryStorage();
    const campaign = loadCompletedM5Fixture();
    const meta = createSave(campaign, "Source", source);
    const record = readSave(meta.saveId, source)!;
    const forged: CampaignSave = {
      ...record,
      preview: { ...record.preview, campaignName: "FORGED", wins: 999, wpBalance: 999999 },
    };
    const plan = planSaveBundleImport(bundle(forged), new MemoryStorage());
    expect(plan.totals.imported).toBe(1);
    expect(plan.rows[0].preview).toEqual(buildCampaignSavePreview(campaign));
    expect(plan.rows[0].preview?.campaignName).not.toBe("FORGED");
  });

  it("rejects malformed timestamps before conflict precedence is evaluated", () => {
    const source = new MemoryStorage();
    const campaign = loadCompletedM5Fixture();
    const meta = createSave(campaign, "Source", source);
    const incoming = { ...readSave(meta.saveId, source)!, updatedAt: "tomorrow-ish" };
    const plan = planSaveBundleImport(bundle(incoming), new MemoryStorage());
    expect(plan.totals.skipped).toBe(1);
    expect(plan.rows[0].reason).toContain("timestamps");
  });

  it("applies the exact validated plan without trusting later raw payload mutation", () => {
    const source = new MemoryStorage();
    const target = new MemoryStorage();
    const campaign = loadCompletedM5Fixture();
    const meta = createSave(campaign, "Source", source);
    const plan = planSaveBundleImport(bundle(readSave(meta.saveId, source)!), target);
    expect(plan.totals.imported).toBe(1);
    expect(applySaveBundlePlan(plan, target)).toEqual({ imported: 1, merged: 0, keptLocal: 0, skipped: 0 });
    expect(hashCampaignState(loadCampaignState(meta.saveId, target))).toBe(hashCampaignState(campaign));
  });
});

describe("QA remediation: autosave integrity and monotonic ordering", () => {
  it("enforces the stored campaign hash when restoring an autosave", () => {
    const storage = new MemoryStorage();
    const campaign = loadCompletedM5Fixture();
    const meta = writeAutosave(campaign, storage, { now: () => "2026-08-21T12:00:00.000Z" });
    const raw = JSON.parse(storage.getItem(meta.key)!);
    raw.campaignHash = "c14n-fnv1a64-v1:0000000000000000";
    storage.setItem(meta.key, JSON.stringify(raw));
    expect(() => loadAutosaveSnapshot(meta.key, storage)).toThrow(/integrity mismatch/);
  });

  it("rejects an autosave whose wrapper campaignId differs from its campaign payload", () => {
    const storage = new MemoryStorage();
    const campaign = loadCompletedM5Fixture();
    const meta = writeAutosave(campaign, storage, { now: () => "2026-08-21T12:00:00.000Z" });
    const raw = JSON.parse(storage.getItem(meta.key)!);
    raw.campaignId = "foreign-campaign";
    storage.setItem(meta.key, JSON.stringify(raw));
    expect(() => loadAutosaveSnapshot(meta.key, storage)).toThrow(/campaign identity mismatch/);
  });

  it("uses monotonic write sequence rather than wall-clock order", () => {
    const storage = new MemoryStorage();
    const campaign = loadCompletedM5Fixture();
    const first = writeAutosave(campaign, storage, { now: () => "2026-08-21T12:00:00.000Z", maxSnapshots: 5 });
    const second = writeAutosave(campaign, storage, { now: () => "2026-08-21T11:00:00.000Z", maxSnapshots: 5 });
    const third = writeAutosave(campaign, storage, { now: () => "2026-08-21T10:00:00.000Z", maxSnapshots: 5 });
    const ordered = listAutosaves(storage);
    expect(ordered.map((row) => row.key)).toEqual([third.key, second.key, first.key]);
  });

  it("prunes by true write order even while the clock moves backward", () => {
    const storage = new MemoryStorage();
    const campaign = loadCompletedM5Fixture();
    const first = writeAutosave(campaign, storage, { now: () => "2026-08-21T12:00:00.000Z", maxSnapshots: 2 });
    const second = writeAutosave(campaign, storage, { now: () => "2026-08-21T11:00:00.000Z", maxSnapshots: 2 });
    const third = writeAutosave(campaign, storage, { now: () => "2026-08-21T10:00:00.000Z", maxSnapshots: 2 });
    expect(storage.getItem(first.key)).toBeNull();
    expect(storage.getItem(second.key)).not.toBeNull();
    expect(storage.getItem(third.key)).not.toBeNull();
    expect(listAutosaves(storage).map((row) => row.key)).toEqual([third.key, second.key]);
    expect([...Array(storage.length)].map((_, index) => storage.key(index)).filter((key) => key?.startsWith(AUTOSAVE_KEY_PREFIX))).toHaveLength(2);
  });
});
