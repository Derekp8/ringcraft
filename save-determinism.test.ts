import { describe, expect, it } from "vitest";
import { canonicalHash64 } from "../src/core";
import {
  SAVE_DETERMINISM_POLICY,
  SAVE_DETERMINISM_SCHEMA,
  buildSaveDeterminismFixture,
  bundleMergeObservationHash,
  autosaveRingObservationHash,
  remoteSyncObservationHash,
  fixtureContentHash,
  runAutosaveRingScenario,
  runBundleMergeScenario,
  runRemoteSyncScenario,
  verifySaveDeterminismFixture,
} from "../scripts/save-determinism";
import fixture from "../fixtures/saves/save-determinism-v1.json";
import type { SaveDeterminismFixture } from "../scripts/save-determinism";

const pinned = fixture as SaveDeterminismFixture;

describe("save-manager determinism fixture (bundle merge + autosave ring + remote sync)", () => {
  it("declares the fixture schema and policy", () => {
    expect(pinned.schema).toBe(SAVE_DETERMINISM_SCHEMA);
    expect(pinned.policy).toBe(SAVE_DETERMINISM_POLICY);
    expect(pinned.campaigns.length).toBeGreaterThanOrEqual(3);
    for (const campaign of pinned.campaigns) {
      expect(typeof campaign.campaignId).toBe("string");
      expect(campaign.campaignJson.length).toBeGreaterThan(0);
    }
  });

  it("re-verifies the pinned fixture against the live code", async () => {
    const result = await verifySaveDeterminismFixture(pinned);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("pins the bundle-merge rule: newer merges in place, older is kept out, bad entries skipped", () => {
    const observation = pinned.bundleMerge.observation;
    expect(observation.applyTotals).toEqual({ imported: 2, merged: 2, keptLocal: 1, skipped: 2 });
    expect(observation.plan.totals).toEqual(observation.applyTotals);
    const byOutcome = Object.fromEntries(observation.plan.rows.map((row) => [row.key, row.outcome]));
    expect(byOutcome["asw91-campaign-save-save-a1"]).toBeUndefined(); // initial saves are not plan rows
    expect(byOutcome["asw91-campaign-save-incoming-a2"]).toBe("merged");
    expect(byOutcome["asw91-campaign-save-incoming-b2"]).toBe("keptLocal");
    expect(byOutcome["asw91-campaign-save-incoming-c1"]).toBe("imported");
    expect(byOutcome["asw91-campaign-save-incoming-d2"]).toBe("merged");
    // The merged alpha save keeps its original storage key and name.
    const merged = observation.finalSaves.find((row) => row.key === "asw91-campaign-save-save-a1");
    expect(merged?.name).toBe("Alpha Draft");
    expect(merged?.updatedAt).toBe("2026-01-20T00:00:00.000Z");
    expect(observation.finalSaves.length).toBe(4);
  });

  it("pins the autosave ring: retention cap, timestamp-collision suffix, prune, delete, promote", () => {
    const observation = pinned.autosaveRing.observation;
    expect(observation.writes).toHaveLength(5);
    expect(observation.writes[2].meta.key).toBe("asw91-project-ringcraft-autosave-v1-2026-01-08T00:00:00.000Z-000003");
    expect(observation.writes[4].pruned).toBe(1);
    expect(observation.writes[4].ringAfter).toHaveLength(4);
    expect(observation.delete.ringAfter).toHaveLength(3);
    expect(observation.promote.name).toBe("Save Determinism Alpha - 1991-01-01");
    expect(observation.promote.namedSavesAfter).toBe(1);
    // Promotion preserves the snapshot's campaign identity and hash.
    const source = observation.writes[3].meta;
    expect(observation.promote.campaignId).toBe(source.campaignId);
    expect(observation.promote.campaignHash).toBe(source.campaignHash);
    // The retention-cap leg mirrors the dashboard's "Keep last N snapshots"
    // slider: `pruneAutosaves` is called directly with the lowered cap.
    expect(observation.capPrunes.map((step) => step.removed)).toEqual([0, 1, 1]);
    expect(observation.capPrunes[0].ringAfter).toHaveLength(3);
    // Lowering to 1 leaves exactly the newest snapshot (the last write).
    expect(observation.capPrunes[2].ringAfter).toEqual([observation.writes[4].meta.key]);
  });

  it("pins the remote-sync arc: push, server-advanced, conflict touching nothing, force-pull adopt", () => {
    const observation = pinned.remoteSync.observation;
    const statuses = observation.steps.map((step) => `${step.op}:${step.status}`);
    expect(statuses).toEqual(["sync:pushed", "putForce:server-advanced", "sync:conflict", "forcePull:pulled"]);
    // First sync pushes the local save onto an empty server (revision 1).
    expect(observation.steps[0].serverRevisionAfter).toBe("1");
    expect(observation.steps[0].localFingerprintAfter).toBe(observation.steps[0].remoteFingerprintAfter);
    expect(observation.steps[0].message).toBe("Pushed local saves to the remote endpoint.");
    // The concurrent writer replaces the remote bundle (revision 2) behind the device's back.
    expect(observation.steps[1].serverRevisionAfter).toBe("2");
    // The server-side putForce has no SyncResult, so its message is null.
    expect(observation.steps[1].message).toBeNull();
    // The local edit makes the next sync a conflict that touches nothing:
    // the local fingerprint is unchanged from the conflict step's own local side
    // and the server stays at revision 2.
    expect(observation.steps[2].status).toBe("conflict");
    expect(observation.steps[2].serverRevisionAfter).toBe("2");
    expect(observation.steps[2].message).toBe("Save conflict: local and remote both changed since the last sync. Choose force push (keep local) or force pull (take remote).");
    // Force pull adopts the remote bundle wholesale, converging local and remote.
    expect(observation.steps[3].localFingerprintAfter).toBe(observation.steps[3].remoteFingerprintAfter);
    expect(observation.steps[3].localFingerprintAfter).toBe(observation.steps[1].remoteFingerprintAfter);
    expect(observation.steps[3].message).toBe("Pulled remote saves into local storage.");
    // The server's final named-save set is exactly the concurrent writer's bundle.
    expect(observation.finalServerSaves.map((row) => row.key)).toEqual(["asw91-campaign-save-remote-a2", "asw91-campaign-save-remote-c1"]);
    expect(observation.finalServerSaves[0].name).toBe("Alpha Reshuffle");
    expect(observation.finalServerSaves[1].name).toBe("Charlie Premiere");
  });

  it("pins the persisted sync-meta baseline: the last sync result's fingerprint and remote revision", () => {
    const observation = pinned.remoteSync.observation;
    // After the arc, the last successful sync was the force pull: the baseline
    // records the concurrent bundle's fingerprint and the server revision 2 it
    // was observed at (the live syncedAt timestamp is excluded by design).
    expect(observation.syncMeta.lastRemoteRevision).toBe("2");
    expect(observation.syncMeta.lastSyncedFingerprint).toBe(observation.steps[3].localFingerprintAfter);
    expect(observation.syncMeta.lastSyncedFingerprint).toBe(observation.steps[1].remoteFingerprintAfter);
  });

  it("re-derives the pinned observations and hashes byte-identically", async () => {
    const merge = runBundleMergeScenario(pinned.campaigns, pinned.bundleMerge.initialSaves, pinned.bundleMerge.bundleEntries);
    expect(JSON.stringify(merge)).toBe(JSON.stringify(pinned.bundleMerge.observation));
    expect(bundleMergeObservationHash(merge)).toBe(pinned.bundleMerge.observationHash);

    const ring = runAutosaveRingScenario(pinned.campaigns, pinned.autosaveRing.writes, pinned.autosaveRing.deleteKey, pinned.autosaveRing.promoteKey, pinned.autosaveRing.capPruneSteps);
    expect(JSON.stringify(ring)).toBe(JSON.stringify(pinned.autosaveRing.observation));
    expect(autosaveRingObservationHash(ring)).toBe(pinned.autosaveRing.observationHash);

    const remote = await runRemoteSyncScenario(pinned.campaigns, pinned.remoteSync.localSave, pinned.remoteSync.localSecondSave, pinned.remoteSync.concurrentBundle);
    expect(JSON.stringify(remote)).toBe(JSON.stringify(pinned.remoteSync.observation));
    expect(remoteSyncObservationHash(remote)).toBe(pinned.remoteSync.observationHash);
  });

  it("regenerates the same fixture content hash (fresh build determinism)", async () => {
    const fresh = await buildSaveDeterminismFixture("2026-01-01T00:00:00.000Z");
    expect(fixtureContentHash(fresh)).toBe(pinned.fixtureHash);
    expect(canonicalHash64(fresh.bundleMerge.observation)).toBe(pinned.bundleMerge.observationHash);
    expect(canonicalHash64(fresh.autosaveRing.observation)).toBe(pinned.autosaveRing.observationHash);
    expect(canonicalHash64(fresh.remoteSync.observation)).toBe(pinned.remoteSync.observationHash);
  });

  it("locates a single flipped pinned merge outcome by exact field and value", async () => {
    const mutated = structuredClone(pinned) as SaveDeterminismFixture;
    mutated.bundleMerge.observation.applyTotals.merged = 3;
    const result = await verifySaveDeterminismFixture(mutated);
    expect(result.ok).toBe(false);
    const locating = result.errors.find((error) => error.includes("applyTotals.merged"));
    expect(locating).toBeDefined();
    expect(locating).toContain("bundle-merge diverged at applyTotals.merged");
    expect(locating).toContain("pinned 3");
    expect(locating).toContain("got 2");
  });

  it("locates a flipped final-save campaign hash to its exact array element", async () => {
    const mutated = structuredClone(pinned) as SaveDeterminismFixture;
    mutated.bundleMerge.observation.finalSaves[0].campaignHash = "c14n-fnv1a64-v1:0000000000000000";
    const result = await verifySaveDeterminismFixture(mutated);
    expect(result.ok).toBe(false);
    const locating = result.errors.find((error) => error.includes("finalSaves[0].campaignHash"));
    expect(locating).toBeDefined();
    expect(locating).toContain("pinned \"c14n-fnv1a64-v1:0000000000000000\"");
    expect(locating).toContain("got \"c14n-fnv1a64-v1:");
  });

  it("locates a flipped autosave-ring pinned outcome by exact field and value", async () => {
    const mutated = structuredClone(pinned) as SaveDeterminismFixture;
    mutated.autosaveRing.observation.promote.name = "Mutated Promote";
    const result = await verifySaveDeterminismFixture(mutated);
    expect(result.ok).toBe(false);
    const locating = result.errors.find((error) => error.includes("promote.name"));
    expect(locating).toBeDefined();
    expect(locating).toContain("autosave-ring diverged at promote.name");
    expect(locating).toContain("pinned \"Mutated Promote\"");
  });

  it("locates a flipped retention-cap prune by exact step and field", async () => {
    const mutated = structuredClone(pinned) as SaveDeterminismFixture;
    mutated.autosaveRing.observation.capPrunes[1].removed = 0;
    const result = await verifySaveDeterminismFixture(mutated);
    expect(result.ok).toBe(false);
    const locating = result.errors.find((error) => error.includes("capPrunes[1].removed"));
    expect(locating).toBeDefined();
    expect(locating).toContain("autosave-ring diverged at capPrunes[1].removed");
    expect(locating).toContain("pinned 0");
    expect(locating).toContain("got 1");
  });

  it("locates a flipped remote-sync step status by exact step index and field", async () => {
    const mutated = structuredClone(pinned) as SaveDeterminismFixture;
    mutated.remoteSync.observation.steps[2].status = "pulled";
    const result = await verifySaveDeterminismFixture(mutated);
    expect(result.ok).toBe(false);
    const locating = result.errors.find((error) => error.includes("steps[2].status"));
    expect(locating).toBeDefined();
    expect(locating).toContain("remote-sync diverged at steps[2].status");
    expect(locating).toContain("pinned \"pulled\"");
    expect(locating).toContain("got \"conflict\"");
  });

  it("locates a flipped remote-sync server revision to its exact step", async () => {
    const mutated = structuredClone(pinned) as SaveDeterminismFixture;
    mutated.remoteSync.observation.steps[1].serverRevisionAfter = "9";
    const result = await verifySaveDeterminismFixture(mutated);
    expect(result.ok).toBe(false);
    const locating = result.errors.find((error) => error.includes("steps[1].serverRevisionAfter"));
    expect(locating).toBeDefined();
    expect(locating).toContain("pinned \"9\"");
    expect(locating).toContain("got \"2\"");
  });

  it("locates a flipped remote-sync final server save by exact row and field", async () => {
    const mutated = structuredClone(pinned) as SaveDeterminismFixture;
    mutated.remoteSync.observation.finalServerSaves[1].name = "Mutated Remote Save";
    const result = await verifySaveDeterminismFixture(mutated);
    expect(result.ok).toBe(false);
    const locating = result.errors.find((error) => error.includes("finalServerSaves[1].name"));
    expect(locating).toBeDefined();
    expect(locating).toContain("remote-sync diverged at finalServerSaves[1].name");
    expect(locating).toContain("pinned \"Mutated Remote Save\"");
  });

  it("locates a flipped sync-meta baseline by exact field and value", async () => {
    const mutated = structuredClone(pinned) as SaveDeterminismFixture;
    mutated.remoteSync.observation.syncMeta.lastRemoteRevision = "9";
    const result = await verifySaveDeterminismFixture(mutated);
    expect(result.ok).toBe(false);
    const locating = result.errors.find((error) => error.includes("syncMeta.lastRemoteRevision"));
    expect(locating).toBeDefined();
    expect(locating).toContain("remote-sync diverged at syncMeta.lastRemoteRevision");
    expect(locating).toContain("pinned \"9\"");
    expect(locating).toContain("got \"2\"");
  });
});
