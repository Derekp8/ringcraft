import { afterAll, describe, expect, it } from "vitest";
import { createMockSaveSyncServer, MOCK_SAVE_BUNDLE_SCHEMA } from "../scripts/mock-save-sync-server.mjs";
import { RemoteBundleStorage, readSyncMeta } from "../src/ui/remote-save-storage";
import {
  advanceCampaignDays,
  autoAllocateCreationPoints,
  createCampaign,
  createCreationSession,
  finalizeCreationSession,
  rollCreationHistory,
  rollCreationStature,
  setCreationIdentity,
  setCreationSide,
} from "../src/core";
import type { CampaignState, WrestlerCareerRecord } from "../src/core";
import { createSave, importSaveBundle, readSave } from "../src/ui/save-manager";
import type { CampaignSaveBundle, SaveStorage } from "../src/ui/save-manager";

const instances: Array<{ close(): void }> = [];
afterAll(() => {
  for (const instance of instances) instance.close();
});

async function startMock() {
  const mock = await createMockSaveSyncServer();
  instances.push(mock);
  return mock;
}

function emptyBundle(): CampaignSaveBundle {
  return { schema: MOCK_SAVE_BUNDLE_SCHEMA, exportedAt: "2099-01-01T00:00:00.000Z", saves: [] };
}

function bundleWithOneSave(): CampaignSaveBundle {
  return {
    schema: MOCK_SAVE_BUNDLE_SCHEMA,
    exportedAt: "2099-01-01T00:00:00.000Z",
    saves: [{ key: "asw91-campaign-save-demo", value: "{\"saveId\":\"demo\",\"campaignId\":\"campaign-demo\"}" }],
  };
}

function inMemoryStorage(): SaveStorage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    getItem(key: string) { return map.get(key) ?? null; },
    setItem(key: string, value: string) { map.set(key, value); },
    removeItem(key: string) { map.delete(key); },
    key(index: number) { return [...map.keys()][index] ?? null; },
  };
}

function syncRecord(seed: number, index: number): WrestlerCareerRecord {
  let session = createCreationSession(seed + index);
  session = setCreationIdentity(session, { name: `Sync Wrestler ${index}`, epithet: "T", affiliation: "Sync Test Roster" });
  session = setCreationSide(session, index % 2 ? "rulebreaker" : "fan-favorite");
  session = rollCreationStature(session);
  session = rollCreationHistory(session);
  session = autoAllocateCreationPoints(session);
  return finalizeCreationSession(session).finalized!;
}

function logicalSeed(campaignId: string): number {
  let value = 7000;
  for (const char of campaignId) value = ((value * 33) ^ char.charCodeAt(0)) >>> 0;
  return (value % 100000) + 1;
}

function syncCampaign(logicalCampaignId: string): CampaignState {
  const seed = logicalSeed(logicalCampaignId);
  const roster = Array.from({ length: 4 }, (_, index) => syncRecord(seed, index));
  return createCampaign({
    name: `Sync ${logicalCampaignId}`,
    seed,
    startDate: "1991-01-01",
    roster,
    playerEntrantId: roster[0].id,
    playerDivision: "singles",
  });
}

function savePayload(saveId: string, name: string, logicalCampaignId: string, updatedAt: string, campaignMarker: string): string {
  const markerMatch = campaignMarker.match(/:(\d+)\s*}/);
  const advanceDays = Math.max(0, Number(markerMatch?.[1] ?? 1) - 1);
  const campaign = advanceDays > 0 ? advanceCampaignDays(syncCampaign(logicalCampaignId), advanceDays) : syncCampaign(logicalCampaignId);
  const storage = inMemoryStorage();
  const meta = createSave(campaign, name, storage);
  const record = readSave(meta.saveId, storage)!;
  return JSON.stringify({
    ...record,
    saveId,
    name,
    createdAt: "2099-01-01T00:00:00.000Z",
    updatedAt,
  });
}

describe("mock save-sync server (in-repo endpoint)", () => {
  it("answers GET with 404 until a bundle is pushed, then the versioned bundle", async () => {
    const mock = await startMock();
    const empty = await fetch(mock.endpoint);
    expect(empty.status).toBe(404);

    const bundle = bundleWithOneSave();
    await mock.putForce(bundle);
    const response = await fetch(mock.endpoint);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.schema).toBe(MOCK_SAVE_BUNDLE_SCHEMA);
    expect(body.revision).toBe("1");
    expect(body.bundle).toEqual(bundle);
  });

  it("requires the configured bearer token: 401 without it, full sync with it", async () => {
    const mock = await createMockSaveSyncServer({ authToken: "s3cret" });
    instances.push(mock);

    // Unauthenticated GET is rejected before the bundle contract is reached.
    const unauth = await fetch(mock.endpoint);
    expect(unauth.status).toBe(401);

    // Authenticated GET reaches the normal empty-remote 404 contract.
    const authed = await fetch(mock.endpoint, { headers: { authorization: "Bearer s3cret" } });
    expect(authed.status).toBe(404);

    // The backend sends the header when constructed with an authToken, so the
    // full first-sync push works end to end against the protected endpoint.
    const storage = inMemoryStorage();
    const t1 = "2099-01-01T00:00:00.000Z";
    storage.setItem("asw91-campaign-save-local", savePayload("local", "Local", "campaign-local", t1, "{\"local\":1}"));
    const remote = new RemoteBundleStorage({ endpoint: mock.endpoint, storage, authToken: "s3cret" });
    const result = await remote.sync();
    expect(result.status).toBe("pushed");
    expect(mock.state.bundle?.saves.length).toBe(1);

    // Without the token the same backend cannot even reach the push.
    const unauthed = new RemoteBundleStorage({ endpoint: mock.endpoint, storage: inMemoryStorage() });
    await expect(unauthed.sync()).rejects.toThrow(/401/);
  });

  it("starts pre-populated when seeded, so pull and conflict paths work without a first-sync push", async () => {
    const t1 = "2099-01-01T00:00:00.000Z";
    const seed: CampaignSaveBundle = {
      schema: MOCK_SAVE_BUNDLE_SCHEMA,
      exportedAt: t1,
      saves: [{ key: "asw91-campaign-save-demo", value: savePayload("demo", "Demo", "campaign-demo", t1, "{\"demo\":1}") }],
    };
    const mock = await createMockSaveSyncServer({ seedBundle: seed });
    instances.push(mock);

    // GET serves the seeded bundle at revision 1 without any prior PUT.
    const seeded = await fetch(mock.endpoint);
    expect(seeded.status).toBe(200);
    const body = await seeded.json();
    expect(body.schema).toBe(MOCK_SAVE_BUNDLE_SCHEMA);
    expect(body.revision).toBe("1");
    expect(body.bundle).toEqual(seed);

    // An empty local device adopts the populated remote on first sync (pull).
    const emptyStorage = inMemoryStorage();
    const puller = new RemoteBundleStorage({ endpoint: mock.endpoint, storage: emptyStorage });
    expect((await puller.sync()).status).toBe("pulled");
    expect(emptyStorage.getItem("asw91-campaign-save-demo")).not.toBeNull();

    // A local device with its own saves meets the populated remote: conflict, touching nothing.
    const localOnly = inMemoryStorage();
    localOnly.setItem("asw91-campaign-save-local", savePayload("local", "Local", "campaign-local", t1, "{\"local\":1}"));
    const conflicted = new RemoteBundleStorage({ endpoint: mock.endpoint, storage: localOnly });
    const result = await conflicted.sync();
    expect(result.status).toBe("conflict");
    expect(localOnly.getItem("asw91-campaign-save-local")).not.toBeNull();
    expect(localOnly.getItem("asw91-campaign-save-demo")).toBeNull();

    // Compare-and-set against the seeded revision advances to 2.
    const accepted = await fetch(mock.endpoint, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schema: MOCK_SAVE_BUNDLE_SCHEMA, expectedRevision: "1", force: false, bundle: seed }),
    });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).revision).toBe("2");
  });

  it("enforces compare-and-set: stale expectedRevision gets 409 with the current revision and bundle", async () => {
    const mock = await startMock();
    const bundle = bundleWithOneSave();
    await mock.putForce(bundle);

    const conflict = await fetch(mock.endpoint, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schema: MOCK_SAVE_BUNDLE_SCHEMA, expectedRevision: "0", force: false, bundle }),
    });
    expect(conflict.status).toBe(409);
    const body = await conflict.json();
    expect(body.currentRevision).toBe("1");
    expect(body.bundle).toEqual(bundle);
  });

  it("accepts a matching expectedRevision and bumps the revision", async () => {
    const mock = await startMock();
    const bundle = bundleWithOneSave();
    await mock.putForce(bundle);

    const accepted = await fetch(mock.endpoint, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schema: MOCK_SAVE_BUNDLE_SCHEMA, expectedRevision: "1", force: false, bundle }),
    });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).revision).toBe("2");
  });

  it("serves the full sync lifecycle through RemoteBundleStorage: push, conflict, force-pull", async () => {
    const mock = await startMock();
    const storage = {
      map: new Map<string, string>(),
      get length() { return this.map.size; },
      getItem(key: string) { return this.map.get(key) ?? null; },
      setItem(key: string, value: string) { this.map.set(key, value); },
      removeItem(key: string) { this.map.delete(key); },
      key(index: number) { return [...this.map.keys()][index] ?? null; },
    };
    // Seed one named save so the local bundle is non-empty.
    storage.setItem("asw91-campaign-save-demo", JSON.stringify({ saveId: "demo", name: "Demo", createdAt: "2099-01-01T00:00:00.000Z", updatedAt: "2099-01-01T00:00:00.000Z", campaignId: "campaign-demo", preview: { campaignName: "Demo", currentDate: "1991-01-01", playerDivision: "singles", playerLabel: "Demo", wins: 0, draws: 0, losses: 0, matches: 0, titlesHeld: [], wpBalance: 0 }, campaignJson: "{}" }));

    const backend = new RemoteBundleStorage({ endpoint: mock.endpoint, storage });
    expect((await backend.sync()).status).toBe("pushed");
    expect(mock.state.revision).toBe(1);

    // Both sides change: another local save, and the remote advances behind the gate's back.
    storage.setItem("asw91-campaign-save-second", storage.getItem("asw91-campaign-save-demo")!);
    expect(mock.state.bundle).not.toBeNull();
    await mock.putForce(mock.state.bundle!);
    const conflict = await backend.sync();
    expect(conflict.status).toBe("conflict");

    // Force pull adopts the remote (single save) and drops the local extra.
    expect((await backend.forcePull()).status).toBe("pulled");
    expect(storage.getItem("asw91-campaign-save-second")).toBeNull();
    expect(storage.getItem("asw91-campaign-save-demo")).not.toBeNull();
  });

  it("resolves a sync conflict end to end by campaign-aware merge + force push, converging on the server", async () => {
    const mock = await startMock();
    const storage = inMemoryStorage();
    const t1 = "2099-01-01T00:00:00.000Z";
    const t2 = "2099-01-02T00:00:00.000Z";

    // Baseline local bundle: campaign alpha at snapshot t1.
    const alphaT1 = savePayload("alpha-v1", "Alpha", "campaign-alpha", t1, "{\"alpha\":1}");
    storage.setItem("asw91-campaign-save-alpha", alphaT1);
    const backend = new RemoteBundleStorage({ endpoint: mock.endpoint, storage });

    // 1) Push the local bundle over real HTTP.
    const pushed = await backend.sync();
    expect(pushed.status).toBe("pushed");
    expect(mock.state.revision).toBe(1);
    expect(backend.syncMeta().lastRemoteRevision).toBe("1");

    // The baseline records when the sync happened and is readable standalone.
    expect(backend.syncMeta().syncedAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(backend.syncMeta().syncedAt ?? ""))).toBe(false);
    expect(readSyncMeta(storage).lastRemoteRevision).toBe("1");
    expect(readSyncMeta(storage).lastSyncedFingerprint).toBe(pushed.localFingerprint);
    expect(readSyncMeta(storage).syncedAt).toBe(backend.syncMeta().syncedAt);

    // 2) A concurrent writer advances the server behind the app's back: a newer
    //    snapshot of campaign alpha under a different key, plus a new campaign beta.
    const alphaRemote = savePayload("alpha-v2", "Alpha (device)", "campaign-alpha", t2, "{\"alpha\":2}");
    const beta = savePayload("beta-v1", "Beta", "campaign-beta", t1, "{\"beta\":1}");
    await mock.putForce({
      schema: MOCK_SAVE_BUNDLE_SCHEMA,
      exportedAt: t2,
      saves: [
        { key: "asw91-campaign-save-alpha-remote", value: alphaRemote },
        { key: "asw91-campaign-save-beta", value: beta },
      ],
    });

    // 3) Local also diverges (a new campaign gamma), so both sides changed.
    const gamma = savePayload("gamma-v1", "Gamma", "campaign-gamma", t1, "{\"gamma\":1}");
    storage.setItem("asw91-campaign-save-gamma", gamma);

    // 4) sync() reports the conflict and touches neither side.
    const conflict = await backend.sync();
    expect(conflict.status).toBe("conflict");
    expect(storage.getItem("asw91-campaign-save-alpha")).toBe(alphaT1);
    expect(storage.getItem("asw91-campaign-save-beta")).toBeNull();
    expect(storage.getItem("asw91-campaign-save-gamma")).toBe(gamma);

    // 5) Merge resolution: import the remote bundle campaign-aware (a newer
    //    snapshot of an existing campaign merges in place, disjoint campaigns
    //    import, and local saves are never touched), then force-push the merged
    //    set so neither device loses data.
    const remote = await fetch(mock.endpoint);
    const remoteBody = await remote.json();
    const merged = importSaveBundle(JSON.stringify(remoteBody.bundle), storage);
    expect(merged).toMatchObject({ imported: 1, merged: 1, keptLocal: 0, skipped: 0 });

    // Campaign alpha kept its existing key/name/createdAt but adopted the newer snapshot.
    expect(storage.getItem("asw91-campaign-save-alpha")).not.toBe(alphaT1);
    const alphaAfter = JSON.parse(storage.getItem("asw91-campaign-save-alpha")!) as { updatedAt: string; campaignJson: string };
    expect(alphaAfter.updatedAt).toBe(t2);
    expect(alphaAfter.campaignJson).not.toBe(JSON.parse(alphaT1).campaignJson);
    // Campaign beta imported; campaign gamma untouched.
    expect(storage.getItem("asw91-campaign-save-beta")).not.toBeNull();
    expect(storage.getItem("asw91-campaign-save-gamma")).toBe(gamma);

    const resolved = await backend.forcePush();
    expect(resolved.status).toBe("pushed");
    expect(mock.state.revision).toBe(3);

    // 6) The server now holds the merged three-save bundle, and a follow-up sync
    //    converges to up-to-date.
    const after = await fetch(mock.endpoint);
    const afterBody = await after.json();
    expect(afterBody.bundle.saves).toHaveLength(3);
    const serverAlpha = afterBody.bundle.saves.find((entry: { key: string }) => entry.key === "asw91-campaign-save-alpha");
    expect(JSON.parse(serverAlpha.value).updatedAt).toBe(t2);
    expect((await backend.sync()).status).toBe("up-to-date");
  });

  it("answers CORS preflight so the browser page can call it cross-origin", async () => {
    const mock = await startMock();
    const preflight = await fetch(mock.endpoint, { method: "OPTIONS", headers: { origin: "http://127.0.0.1:4173", "access-control-request-method": "PUT" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("PUT");
  });
});
