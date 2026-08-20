import {
  autoAllocateCreationPoints,
  canonicalHash64,
  createCampaign,
  createCreationSession,
  finalizeCreationSession,
  hashCampaignState,
  importCampaignJson,
  rollCreationHistory,
  rollCreationStature,
  serializeCampaign,
  setCreationIdentity,
  setCreationSide,
} from "../src/core";
import type { CampaignState, WrestlerCareerRecord } from "../src/core";
import {
  AUTOSAVE_KEY_PREFIX,
  CAMPAIGN_SAVE_PREFIX,
  SAVE_BUNDLE_SCHEMA,
  buildCampaignSavePreview,
  deleteAutosave,
  importSaveBundle,
  listAutosaves,
  listSaves,
  loadCampaignState,
  planSaveBundleImport,
  pruneAutosaves,
  saveAutosaveAsNamedSave,
  writeAutosave,
} from "../src/ui/save-manager";
import type { CampaignSave, CampaignSaveBundle, ImportSaveBundleResult, SaveStorage } from "../src/ui/save-manager";
import { RemoteBundleStorage, bundleContentFingerprint } from "../src/ui/remote-save-storage";
import type { HttpClient } from "../src/ui/remote-save-storage";

export const SAVE_DETERMINISM_SCHEMA = "asw91-save-determinism-fixture-v1" as const;
export const SAVE_DETERMINISM_POLICY = "asw91-save-manager-v1" as const;
/** Fixed timestamp stamped into the generated bundle so the import input is fully pinned. */
export const BUNDLE_EXPORTED_AT = "2026-01-31T00:00:00.000Z";

/** In-memory `SaveStorage` used by both the generator and the verifier. */
export class MemoryStorage implements SaveStorage {
  private readonly map = new Map<string, string>();
  get length(): number { return this.map.size; }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
}

/** One deterministic campaign payload, stored once and referenced by key. */
export interface CampaignRecord {
  key: string;
  campaignId: string;
  name: string;
  currentDate: string;
  campaignJson: string;
}

/** A named-save record to seed the storage before a bundle import. */
export interface InitialSaveDescriptor {
  /** The full storage key (already prefixed). */
  key: string;
  saveId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  campaignKey: string;
}

/** One entry of the imported bundle: a valid save, a non-object, or a bad-key entry. */
export type BundleEntryDescriptor =
  | { entry: "save"; key: string; campaignKey: string; saveId: string; name: string; createdAt: string; updatedAt: string }
  | { entry: "null" }
  | { entry: "bad-key"; key: string };

export interface PlanRowProjection {
  key: string;
  outcome: "imported" | "merged" | "keptLocal" | "skipped";
  incomingUpdatedAt: string;
  existingName: string | null;
  existingUpdatedAt: string | null;
  reason: string;
}

export interface FinalSaveProjection {
  key: string;
  name: string;
  campaignId: string;
  updatedAt: string;
  campaignHash: string;
}

export interface BundleMergeObservation {
  plan: { rows: PlanRowProjection[]; totals: ImportSaveBundleResult };
  /** The actual write outcome of `importSaveBundle` (must equal the plan totals). */
  applyTotals: ImportSaveBundleResult;
  /** Every named save present after the import, sorted by key. */
  finalSaves: FinalSaveProjection[];
}

export interface RingWriteDescriptor {
  savedAt: string;
  campaignKey: string;
  maxSnapshots: number;
}

export interface RingWriteObservation {
  savedAt: string;
  maxSnapshots: number;
  meta: { key: string; campaignId: string; campaignHash: string };
  ringAfter: string[];
  pruned: number;
}

/** One retention-cap step: the dashboard's "Keep last N snapshots" control calls `pruneAutosaves` directly with the new cap. */
export interface RingCapPruneDescriptor {
  cap: number;
}

export interface RingCapPruneObservation {
  cap: number;
  removed: number;
  ringAfter: string[];
}

export interface AutosaveRingObservation {
  writes: RingWriteObservation[];
  delete: { key: string; ringAfter: string[] };
  promote: { key: string; name: string; campaignId: string; campaignHash: string; namedSavesAfter: number };
  /** Immediate-prune steps: `pruneAutosaves(storage, cap)` run directly, as the retention slider does on cap change. */
  capPrunes: RingCapPruneObservation[];
}

export interface BundleMergeScenarioFixture {
  initialSaves: InitialSaveDescriptor[];
  bundleEntries: BundleEntryDescriptor[];
  observation: BundleMergeObservation;
  observationHash: string;
}

export interface AutosaveRingScenarioFixture {
  writes: RingWriteDescriptor[];
  deleteKey: string;
  promoteKey: string;
  capPruneSteps: RingCapPruneDescriptor[];
  observation: AutosaveRingObservation;
  observationHash: string;
}

/** One step of the scripted remote-sync arc: the operation and its deterministic outcome. */
export interface RemoteSyncStepObservation {
  op: "sync" | "putForce" | "forcePull";
  status: string;
  /** The `SyncResult.message` the backend surfaced for this step (`null` for a server-side `putForce`, which has no result). */
  message: string | null;
  /** Server revision token after the step (`null` when the server is empty). */
  serverRevisionAfter: string | null;
  /** Content fingerprint (`fnv1a32`) of the local bundle after the step. */
  localFingerprintAfter: string | null;
  /** Content fingerprint of the remote bundle observed during the step. */
  remoteFingerprintAfter: string | null;
}

/**
 * The last successful sync baseline persisted by the backend (`SyncMeta`). The
 * deterministic fields — the content fingerprint and the server revision — are
 * pinned; `syncedAt` is a live timestamp and is excluded exactly like the
 * fixture's own `generatedAt` and the bundle's `exportedAt`.
 */
export interface RemoteSyncMetaObservation {
  lastSyncedFingerprint: string | null;
  lastRemoteRevision: string | null;
}

export interface RemoteSyncObservation {
  steps: RemoteSyncStepObservation[];
  /** The persisted `SyncMeta` baseline after the arc (`asw91-campaign-sync-meta-v1`). */
  syncMeta: RemoteSyncMetaObservation;
  /** Every named save on the server after the arc, sorted by key. */
  finalServerSaves: FinalSaveProjection[];
}

export interface ConcurrentBundleDescriptor {
  exportedAt: string;
  entries: BundleEntryDescriptor[];
}

export interface RemoteSyncScenarioFixture {
  localSave: InitialSaveDescriptor;
  localSecondSave: InitialSaveDescriptor;
  concurrentBundle: ConcurrentBundleDescriptor;
  observation: RemoteSyncObservation;
  observationHash: string;
}

export interface SaveDeterminismFixture {
  schema: typeof SAVE_DETERMINISM_SCHEMA;
  policy: typeof SAVE_DETERMINISM_POLICY;
  campaigns: CampaignRecord[];
  bundleMerge: BundleMergeScenarioFixture;
  autosaveRing: AutosaveRingScenarioFixture;
  remoteSync: RemoteSyncScenarioFixture;
  fixtureHash: string;
  generatedAt: string;
}

const CAMPAIGN_SPECS = [
  { key: "alpha", name: "Save Determinism Alpha", seed: 11 },
  { key: "bravo", name: "Save Determinism Bravo", seed: 22 },
  { key: "charlie", name: "Save Determinism Charlie", seed: 33 },
  { key: "delta", name: "Save Determinism Delta", seed: 44 },
] as const;

export const BUNDLE_INITIAL_SAVES: InitialSaveDescriptor[] = [
  {
    key: `${CAMPAIGN_SAVE_PREFIX}save-a1`, saveId: "save-a1", name: "Alpha Draft",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-10T00:00:00.000Z", campaignKey: "alpha",
  },
  {
    key: `${CAMPAIGN_SAVE_PREFIX}save-b1`, saveId: "save-b1", name: "Bravo Draft",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-15T00:00:00.000Z", campaignKey: "bravo",
  },
];

/**
 * The merge-rule corpus: a newer alpha snapshot merges in place, an older bravo
 * snapshot is kept out, charlie and delta import fresh, a second delta entry
 * merges into the first in-bundle entry (sequential simulation), and a null
 * entry plus a foreign-key entry are skipped.
 */
export const BUNDLE_ENTRIES: BundleEntryDescriptor[] = [
  {
    entry: "save", key: `${CAMPAIGN_SAVE_PREFIX}incoming-a2`, campaignKey: "alpha", saveId: "incoming-a2",
    name: "Alpha Reshuffle", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-20T00:00:00.000Z",
  },
  {
    entry: "save", key: `${CAMPAIGN_SAVE_PREFIX}incoming-b2`, campaignKey: "bravo", saveId: "incoming-b2",
    name: "Bravo Reshuffle", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-05T00:00:00.000Z",
  },
  {
    entry: "save", key: `${CAMPAIGN_SAVE_PREFIX}incoming-c1`, campaignKey: "charlie", saveId: "incoming-c1",
    name: "Charlie Premiere", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-12T00:00:00.000Z",
  },
  {
    entry: "save", key: `${CAMPAIGN_SAVE_PREFIX}incoming-d1`, campaignKey: "delta", saveId: "incoming-d1",
    name: "Delta Premiere", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-13T00:00:00.000Z",
  },
  {
    entry: "save", key: `${CAMPAIGN_SAVE_PREFIX}incoming-d2`, campaignKey: "delta", saveId: "incoming-d2",
    name: "Delta Refinement", createdAt: "2026-01-04T00:00:00.000Z", updatedAt: "2026-01-14T00:00:00.000Z",
  },
  { entry: "null" },
  { entry: "bad-key", key: "not-a-save-key" },
];

/**
 * The autosave-ring corpus: five writes under a retention cap of four (with a
 * same-timestamp collision that exercises the monotonic-sequence key ordering
 * and one prune), then a targeted delete and a promotion to a named save.
 * Keys are `prefix + savedAt + "-" + zero-padded write sequence`, so write
 * order is the ring's newest-first order even under identical timestamps.
 */
export const RING_WRITES: RingWriteDescriptor[] = [
  { savedAt: "2026-01-01T00:00:00.000Z", campaignKey: "alpha", maxSnapshots: 4 },
  { savedAt: "2026-01-08T00:00:00.000Z", campaignKey: "bravo", maxSnapshots: 4 },
  { savedAt: "2026-01-08T00:00:00.000Z", campaignKey: "charlie", maxSnapshots: 4 },
  { savedAt: "2026-01-15T00:00:00.000Z", campaignKey: "alpha", maxSnapshots: 4 },
  { savedAt: "2026-01-22T00:00:00.000Z", campaignKey: "bravo", maxSnapshots: 4 },
];
export const RING_DELETE_KEY = `${AUTOSAVE_KEY_PREFIX}2026-01-08T00:00:00.000Z-000002`;
export const RING_PROMOTE_KEY = `${AUTOSAVE_KEY_PREFIX}2026-01-15T00:00:00.000Z-000004`;

/**
 * The retention-cap corpus: after the writes, delete, and promotion leave a
 * three-snapshot ring, the retention slider is lowered 3 -> 2 -> 1, exercising
 * `pruneAutosaves` directly (the immediate-prune path the UI uses on cap
 * change) — a no-op at the current cap, then two deterministic prunes.
 */
export const RING_CAP_PRUNE_STEPS: RingCapPruneDescriptor[] = [
  { cap: 3 },
  { cap: 2 },
  { cap: 1 },
];

/**
 * The remote-sync corpus: a local device with one named save, a concurrent
 * writer's bundle (a newer alpha snapshot plus a remote-only charlie save), and
 * the second local save that makes the follow-up sync a conflict. The scripted
 * arc is push -> server-advanced -> conflict -> force-pull.
 */
export const REMOTE_SYNC_LOCAL_SAVE: InitialSaveDescriptor = {
  key: `${CAMPAIGN_SAVE_PREFIX}local-a1`, saveId: "local-a1", name: "Alpha Draft",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-10T00:00:00.000Z", campaignKey: "alpha",
};
export const REMOTE_SYNC_LOCAL_SECOND_SAVE: InitialSaveDescriptor = {
  key: `${CAMPAIGN_SAVE_PREFIX}local-b2`, saveId: "local-b2", name: "Bravo Second",
  createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-18T00:00:00.000Z", campaignKey: "bravo",
};
export const REMOTE_SYNC_CONCURRENT_BUNDLE: ConcurrentBundleDescriptor = {
  exportedAt: "2026-01-31T00:00:00.000Z",
  entries: [
    {
      entry: "save", key: `${CAMPAIGN_SAVE_PREFIX}remote-a2`, campaignKey: "alpha", saveId: "remote-a2",
      name: "Alpha Reshuffle", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-20T00:00:00.000Z",
    },
    {
      entry: "save", key: `${CAMPAIGN_SAVE_PREFIX}remote-c1`, campaignKey: "charlie", saveId: "remote-c1",
      name: "Charlie Premiere", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-12T00:00:00.000Z",
    },
  ],
};

function makeRecord(seed: number, index: number): WrestlerCareerRecord {
  let session = createCreationSession(seed + index);
  session = setCreationIdentity(session, { name: `Determinism Wrestler ${index}`, epithet: "D", affiliation: "Determinism Roster" });
  session = setCreationSide(session, index % 2 ? "rulebreaker" : "fan-favorite");
  session = rollCreationStature(session);
  session = rollCreationHistory(session);
  session = autoAllocateCreationPoints(session);
  return finalizeCreationSession(session).finalized!;
}

function makeCampaign(config: { name: string; seed: number }): CampaignState {
  const roster = Array.from({ length: 4 }, (_, index) => makeRecord(config.seed, index));
  return createCampaign({
    name: config.name,
    seed: config.seed,
    startDate: "1991-01-01",
    roster,
    playerEntrantId: roster[0].id,
    playerDivision: "singles",
  });
}

export function buildCampaignRecords(): CampaignRecord[] {
  return CAMPAIGN_SPECS.map((spec) => {
    const campaign = makeCampaign(spec);
    return {
      key: spec.key,
      campaignId: campaign.campaignId,
      name: campaign.name,
      currentDate: campaign.currentDate,
      campaignJson: serializeCampaign(campaign),
    };
  });
}

/** Builds a `CampaignSave` payload from a campaign's serialized JSON (never from a live state). */
export function makeSaveRecord(campaignJson: string, saveId: string, name: string, createdAt: string, updatedAt: string): CampaignSave {
  const campaign = importCampaignJson(campaignJson).state;
  return {
    saveId,
    name,
    createdAt,
    updatedAt,
    campaignId: campaign.campaignId,
    preview: buildCampaignSavePreview(campaign),
    campaignJson,
  };
}

function saveKeys(storage: SaveStorage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  return keys;
}

function planRowProjection(row: { key: string; outcome: PlanRowProjection["outcome"]; incomingUpdatedAt: string; existingName: string | null; existingUpdatedAt: string | null; reason: string }): PlanRowProjection {
  return { key: row.key, outcome: row.outcome, incomingUpdatedAt: row.incomingUpdatedAt, existingName: row.existingName, existingUpdatedAt: row.existingUpdatedAt, reason: row.reason };
}

function finalSavesProjection(storage: SaveStorage): FinalSaveProjection[] {
  return saveKeys(storage)
    .filter((key) => key.startsWith(CAMPAIGN_SAVE_PREFIX))
    .sort()
    .map((key) => {
      const raw = storage.getItem(key);
      const record = raw === null ? null : JSON.parse(raw) as CampaignSave | null;
      if (!record) return null;
      return {
        key,
        name: record.name,
        campaignId: record.campaignId,
        updatedAt: record.updatedAt,
        campaignHash: hashCampaignState(importCampaignJson(record.campaignJson).state),
      };
    })
    .filter((row): row is FinalSaveProjection => row !== null);
}

function buildBundleJson(campaigns: CampaignRecord[], entries: BundleEntryDescriptor[]): string {
  const saves = entries.map((descriptor): unknown => {
    if (descriptor.entry === "save") {
      const campaign = campaigns.find((row) => row.key === descriptor.campaignKey);
      if (!campaign) throw new Error(`Unknown campaign key ${descriptor.campaignKey}.`);
      const record = makeSaveRecord(campaign.campaignJson, descriptor.saveId, descriptor.name, descriptor.createdAt, descriptor.updatedAt);
      return { key: descriptor.key, value: JSON.stringify(record) };
    }
    if (descriptor.entry === "bad-key") return { key: descriptor.key, value: "{}" };
    return null;
  });
  return JSON.stringify({ schema: SAVE_BUNDLE_SCHEMA, exportedAt: BUNDLE_EXPORTED_AT, saves }, null, 2);
}

/** Runs the bundle-merge rule against pinned inputs and returns the observation. */
export function runBundleMergeScenario(campaigns: CampaignRecord[], initialSaves: InitialSaveDescriptor[], bundleEntries: BundleEntryDescriptor[]): BundleMergeObservation {
  const storage = new MemoryStorage();
  for (const descriptor of initialSaves) {
    const campaign = campaigns.find((row) => row.key === descriptor.campaignKey);
    if (!campaign) throw new Error(`Unknown campaign key ${descriptor.campaignKey}.`);
    storage.setItem(descriptor.key, JSON.stringify(makeSaveRecord(campaign.campaignJson, descriptor.saveId, descriptor.name, descriptor.createdAt, descriptor.updatedAt)));
  }
  const bundle = buildBundleJson(campaigns, bundleEntries);
  const plan = planSaveBundleImport(bundle, storage);
  const rows = plan.rows.map(planRowProjection);
  const totals = plan.totals;
  const applyTotals = importSaveBundle(bundle, storage);
  return { plan: { rows, totals }, applyTotals, finalSaves: finalSavesProjection(storage) };
}

function ringMetaProjection(meta: { key: string; campaignId: string; campaignHash: string }): RingWriteObservation["meta"] {
  return { key: meta.key, campaignId: meta.campaignId, campaignHash: meta.campaignHash };
}

/**
 * Runs the autosave-ring scenario against pinned inputs and returns the
 * observation: write-time trimming, a targeted delete, a promotion to a named
 * save, then the retention-cap steps (`pruneAutosaves` called directly, as the
 * dashboard's retention slider does on cap change).
 */
export function runAutosaveRingScenario(campaigns: CampaignRecord[], writes: RingWriteDescriptor[], deleteKey: string, promoteKey: string, capPruneSteps: RingCapPruneDescriptor[]): AutosaveRingObservation {
  const storage = new MemoryStorage();
  const observations: RingWriteObservation[] = [];
  for (const descriptor of writes) {
    const campaign = campaigns.find((row) => row.key === descriptor.campaignKey);
    if (!campaign) throw new Error(`Unknown campaign key ${descriptor.campaignKey}.`);
    const state = importCampaignJson(campaign.campaignJson).state;
    const before = listAutosaves(storage).length;
    const meta = writeAutosave(state, storage, { now: () => descriptor.savedAt, maxSnapshots: descriptor.maxSnapshots });
    const ringAfter = listAutosaves(storage).map((row) => row.key);
    observations.push({
      savedAt: descriptor.savedAt,
      maxSnapshots: descriptor.maxSnapshots,
      meta: ringMetaProjection(meta),
      ringAfter,
      pruned: before + 1 - ringAfter.length,
    });
  }
  deleteAutosave(deleteKey, storage);
  const deleteAfter = listAutosaves(storage).map((row) => row.key);
  const promoted = saveAutosaveAsNamedSave(promoteKey, undefined, storage);
  const capPrunes: RingCapPruneObservation[] = [];
  for (const step of capPruneSteps) {
    const removed = pruneAutosaves(storage, step.cap);
    capPrunes.push({ cap: step.cap, removed, ringAfter: listAutosaves(storage).map((row) => row.key) });
  }
  return {
    writes: observations,
    delete: { key: deleteKey, ringAfter: deleteAfter },
    promote: {
      key: promoteKey,
      name: promoted.name,
      campaignId: promoted.campaignId,
      campaignHash: hashCampaignState(loadCampaignState(promoted.saveId, storage)),
      namedSavesAfter: listSaves(storage).length,
    },
    capPrunes,
  };
}

export function bundleMergeObservationHash(observation: BundleMergeObservation): string {
  return canonicalHash64(observation);
}

export function autosaveRingObservationHash(observation: AutosaveRingObservation): string {
  return canonicalHash64(observation);
}

/**
 * In-memory stand-in for the remote save-sync endpoint, mirroring the wire
 * contract of `scripts/mock-save-sync-server.mjs` exactly (GET 404 when empty,
 * compare-and-set PUT with string revisions, `force` bypass, and a `putForce`
 * for a concurrent writer), so the pinned sequence is the same contract the
 * browser QA gate exercises — without opening a socket.
 */
class FakeSyncEndpoint {
  private revision = 0;
  private bundle: CampaignSaveBundle | null = null;

  get currentRevision(): string | null {
    return this.bundle === null ? null : String(this.revision);
  }

  /** Force-accepts a bundle and bumps the revision (the mock server's `putForce`). */
  putForce(bundle: CampaignSaveBundle): void {
    this.revision += 1;
    this.bundle = bundle;
  }

  /** An `HttpClient` implementing the GET/PUT contract against this state. */
  readonly http: HttpClient = async (_endpoint, request) => {
    if (request.method === "GET") {
      if (this.bundle === null) return { status: 404, body: { error: "not found" } };
      return { status: 200, body: { schema: SAVE_BUNDLE_SCHEMA, revision: String(this.revision), bundle: this.bundle } };
    }
    const body = JSON.parse(request.body ?? "{}") as { expectedRevision?: unknown; force?: unknown; bundle?: unknown };
    const current = this.currentRevision;
    if (body.force !== true && body.expectedRevision !== current) {
      return { status: 409, body: { error: "conflict", currentRevision: current, bundle: this.bundle } };
    }
    this.revision += 1;
    this.bundle = (body.bundle as CampaignSaveBundle | undefined) ?? null;
    return { status: 200, body: { revision: String(this.revision) } };
  };
}

/** Builds a `CampaignSaveBundle` object from descriptors (the concurrent writer's bundle). */
function makeBundleObject(campaigns: CampaignRecord[], exportedAt: string, entries: BundleEntryDescriptor[]): CampaignSaveBundle {
  const saves: Array<{ key: string; value: string }> = [];
  for (const descriptor of entries) {
    if (descriptor.entry !== "save") continue;
    const campaign = campaigns.find((row) => row.key === descriptor.campaignKey);
    if (!campaign) throw new Error(`Unknown campaign key ${descriptor.campaignKey}.`);
    const record = makeSaveRecord(campaign.campaignJson, descriptor.saveId, descriptor.name, descriptor.createdAt, descriptor.updatedAt);
    saves.push({ key: descriptor.key, value: JSON.stringify(record) });
  }
  return { schema: SAVE_BUNDLE_SCHEMA, exportedAt, saves };
}

/**
 * Runs the scripted remote-sync arc against the live `RemoteBundleStorage`
 * backend: first sync pushes (revision 1), a concurrent writer replaces the
 * remote bundle (revision 2), a local edit makes the next sync a conflict that
 * touches nothing, and force pull resolves it by adopting the remote bundle.
 */
export async function runRemoteSyncScenario(
  campaigns: CampaignRecord[],
  localSave: InitialSaveDescriptor,
  localSecondSave: InitialSaveDescriptor,
  concurrentBundle: ConcurrentBundleDescriptor,
): Promise<RemoteSyncObservation> {
  const endpoint = new FakeSyncEndpoint();
  const storage = new MemoryStorage();
  const localRecord = (descriptor: InitialSaveDescriptor) => {
    const campaign = campaigns.find((row) => row.key === descriptor.campaignKey);
    if (!campaign) throw new Error(`Unknown campaign key ${descriptor.campaignKey}.`);
    return makeSaveRecord(campaign.campaignJson, descriptor.saveId, descriptor.name, descriptor.createdAt, descriptor.updatedAt);
  };
  storage.setItem(localSave.key, JSON.stringify(localRecord(localSave)));
  const backend = new RemoteBundleStorage({ endpoint: "http://127.0.0.1:4174/saves", http: endpoint.http, storage });
  const steps: RemoteSyncStepObservation[] = [];

  const push = await backend.sync();
  steps.push({ op: "sync", status: push.status, message: push.message, serverRevisionAfter: push.remoteRevision, localFingerprintAfter: push.localFingerprint, remoteFingerprintAfter: push.remoteFingerprint });

  const concurrent = makeBundleObject(campaigns, concurrentBundle.exportedAt, concurrentBundle.entries);
  endpoint.putForce(concurrent);
  steps.push({ op: "putForce", status: "server-advanced", message: null, serverRevisionAfter: endpoint.currentRevision, localFingerprintAfter: backend.currentFingerprint(), remoteFingerprintAfter: bundleContentFingerprint(concurrent) });

  storage.setItem(localSecondSave.key, JSON.stringify(localRecord(localSecondSave)));
  const conflict = await backend.sync();
  steps.push({ op: "sync", status: conflict.status, message: conflict.message, serverRevisionAfter: conflict.remoteRevision, localFingerprintAfter: conflict.localFingerprint, remoteFingerprintAfter: conflict.remoteFingerprint });

  const pull = await backend.forcePull();
  steps.push({ op: "forcePull", status: pull.status, message: pull.message, serverRevisionAfter: pull.remoteRevision, localFingerprintAfter: pull.localFingerprint, remoteFingerprintAfter: pull.remoteFingerprint });

  // The persisted last-successful-sync baseline the app renders as the
  // "Last synced ... - bundle ... - server revision ..." line. `syncedAt` is a
  // live timestamp and is intentionally not part of the deterministic pin.
  const meta = backend.syncMeta();
  const syncMeta: RemoteSyncMetaObservation = {
    lastSyncedFingerprint: meta.lastSyncedFingerprint,
    lastRemoteRevision: meta.lastRemoteRevision,
  };

  const serverStorage = new MemoryStorage();
  importSaveBundle(JSON.stringify(concurrent), serverStorage);
  return { steps, syncMeta, finalServerSaves: finalSavesProjection(serverStorage) };
}

export function remoteSyncObservationHash(observation: RemoteSyncObservation): string {
  return canonicalHash64(observation);
}

/** Canonical hash over every pinned field of the fixture (excludes only `fixtureHash` and `generatedAt`). */
export function fixtureContentHash(fixture: SaveDeterminismFixture): string {
  const { fixtureHash: _fixtureHash, generatedAt: _generatedAt, ...content } = fixture;
  return canonicalHash64(content);
}

/** Builds the full fixture fresh from the deterministic scenario definitions. */
export async function buildSaveDeterminismFixture(generatedAt: string): Promise<SaveDeterminismFixture> {
  const campaigns = buildCampaignRecords();
  const bundleMergeObservation = runBundleMergeScenario(campaigns, BUNDLE_INITIAL_SAVES, BUNDLE_ENTRIES);
  const autosaveRingObservation = runAutosaveRingScenario(campaigns, RING_WRITES, RING_DELETE_KEY, RING_PROMOTE_KEY, RING_CAP_PRUNE_STEPS);
  const remoteSyncObservation = await runRemoteSyncScenario(campaigns, REMOTE_SYNC_LOCAL_SAVE, REMOTE_SYNC_LOCAL_SECOND_SAVE, REMOTE_SYNC_CONCURRENT_BUNDLE);
  const fixture: SaveDeterminismFixture = {
    schema: SAVE_DETERMINISM_SCHEMA,
    policy: SAVE_DETERMINISM_POLICY,
    campaigns,
    bundleMerge: {
      initialSaves: BUNDLE_INITIAL_SAVES,
      bundleEntries: BUNDLE_ENTRIES,
      observation: bundleMergeObservation,
      observationHash: bundleMergeObservationHash(bundleMergeObservation),
    },
    autosaveRing: {
      writes: RING_WRITES,
      deleteKey: RING_DELETE_KEY,
      promoteKey: RING_PROMOTE_KEY,
      capPruneSteps: RING_CAP_PRUNE_STEPS,
      observation: autosaveRingObservation,
      observationHash: autosaveRingObservationHash(autosaveRingObservation),
    },
    remoteSync: {
      localSave: REMOTE_SYNC_LOCAL_SAVE,
      localSecondSave: REMOTE_SYNC_LOCAL_SECOND_SAVE,
      concurrentBundle: REMOTE_SYNC_CONCURRENT_BUNDLE,
      observation: remoteSyncObservation,
      observationHash: remoteSyncObservationHash(remoteSyncObservation),
    },
    fixtureHash: "",
    generatedAt,
  };
  fixture.fixtureHash = fixtureContentHash(fixture);
  return fixture;
}

export interface SaveDeterminismVerification {
  ok: boolean;
  errors: string[];
  bundleMergeHash: string;
  autosaveRingHash: string;
  remoteSyncHash: string;
  fixtureHash: string;
}

/**
 * Returns the first field-level divergence between two JSON values, or null
 * when they are equal: the dotted/bracketed path (relative to the compared
 * roots) and the pinned vs actual values at that path. Arrays compare by index
 * (length differences report the first missing index) and objects by sorted
 * union of keys, so a single flipped merge outcome is located to its exact
 * field instead of a whole-observation diff.
 */
export function firstDivergence(expected: unknown, actual: unknown, path = ""): { path: string; expected: unknown; actual: unknown } | null {
  if (expected === actual) return null;
  if (typeof expected !== "object" || expected === null || typeof actual !== "object" || actual === null) {
    return { path, expected, actual };
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= expected.length || index >= actual.length) {
        return { path: `${path}[${index}]`, expected: expected[index], actual: actual[index] };
      }
      const inner = firstDivergence(expected[index], actual[index], `${path}[${index}]`);
      if (inner) return inner;
    }
    return null;
  }
  if (!Array.isArray(expected) && !Array.isArray(actual)) {
    const left = expected as Record<string, unknown>;
    const right = actual as Record<string, unknown>;
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      const inLeft = Object.prototype.hasOwnProperty.call(left, key);
      const inRight = Object.prototype.hasOwnProperty.call(right, key);
      if (inLeft !== inRight) {
        return { path: `${path}.${key}`, expected: left[key], actual: right[key] };
      }
      const inner = firstDivergence(left[key], right[key], `${path}.${key}`);
      if (inner) return inner;
    }
    return null;
  }
  return { path, expected, actual };
}

/** Formats a field-level divergence as a locating error line naming the exact scenario field and both values. */
function divergenceError(prefix: string, field: string, expected: unknown, actual: unknown): string | null {
  const divergence = firstDivergence(expected, actual);
  if (!divergence) return null;
  const path = `${field}${divergence.path || ""}`;
  return `${prefix} diverged at ${path}: pinned ${JSON.stringify(divergence.expected)}, got ${JSON.stringify(divergence.actual)}.`;
}

/**
 * Re-runs all three scenarios against the fixture's pinned inputs and checks
 * every pinned value: plan rows/totals, applied totals, final storage
 * projection, ring write metas/orderings/prunes, the delete/promote outcomes,
 * the retention-cap prune steps, all three scenario observation hashes, and the
 * fixture integrity hash. Every structural check is field-level, so a single
 * flipped pinned outcome is named by its exact path (e.g. `applyTotals.merged`)
 * with the pinned and actual values.
 */
export async function verifySaveDeterminismFixture(fixture: SaveDeterminismFixture): Promise<SaveDeterminismVerification> {
  const errors: string[] = [];
  if (fixture.schema !== SAVE_DETERMINISM_SCHEMA) errors.push(`Unsupported fixture schema ${fixture.schema}.`);
  const merge = runBundleMergeScenario(fixture.campaigns, fixture.bundleMerge.initialSaves, fixture.bundleMerge.bundleEntries);
  const pinnedMerge = fixture.bundleMerge.observation;
  const planError = divergenceError("bundle-merge", "plan", pinnedMerge.plan, merge.plan);
  if (planError) errors.push(planError);
  const totalsError = divergenceError("bundle-merge", "applyTotals", pinnedMerge.applyTotals, merge.applyTotals);
  if (totalsError) errors.push(totalsError);
  const finalError = divergenceError("bundle-merge", "finalSaves", pinnedMerge.finalSaves, merge.finalSaves);
  if (finalError) errors.push(finalError);
  if (JSON.stringify(merge.applyTotals) !== JSON.stringify(merge.plan.totals)) errors.push("live apply totals diverged from the live plan totals (preview/apply drift).");

  const ring = runAutosaveRingScenario(fixture.campaigns, fixture.autosaveRing.writes, fixture.autosaveRing.deleteKey, fixture.autosaveRing.promoteKey, fixture.autosaveRing.capPruneSteps);
  const pinnedRing = fixture.autosaveRing.observation;
  const writesError = divergenceError("autosave-ring", "writes", pinnedRing.writes, ring.writes);
  if (writesError) errors.push(writesError);
  const deleteError = divergenceError("autosave-ring", "delete", pinnedRing.delete, ring.delete);
  if (deleteError) errors.push(deleteError);
  const promoteError = divergenceError("autosave-ring", "promote", pinnedRing.promote, ring.promote);
  if (promoteError) errors.push(promoteError);
  const capPrunesError = divergenceError("autosave-ring", "capPrunes", pinnedRing.capPrunes, ring.capPrunes);
  if (capPrunesError) errors.push(capPrunesError);

  const mergeHash = bundleMergeObservationHash(merge);
  if (mergeHash !== fixture.bundleMerge.observationHash) errors.push(`bundle-merge observation hash diverged: pinned ${fixture.bundleMerge.observationHash}, got ${mergeHash}.`);
  const ringHash = autosaveRingObservationHash(ring);
  if (ringHash !== fixture.autosaveRing.observationHash) errors.push(`autosave-ring observation hash diverged: pinned ${fixture.autosaveRing.observationHash}, got ${ringHash}.`);

  const remote = await runRemoteSyncScenario(fixture.campaigns, fixture.remoteSync.localSave, fixture.remoteSync.localSecondSave, fixture.remoteSync.concurrentBundle);
  const pinnedRemote = fixture.remoteSync.observation;
  const remoteStepsError = divergenceError("remote-sync", "steps", pinnedRemote.steps, remote.steps);
  if (remoteStepsError) errors.push(remoteStepsError);
  const remoteMetaError = divergenceError("remote-sync", "syncMeta", pinnedRemote.syncMeta, remote.syncMeta);
  if (remoteMetaError) errors.push(remoteMetaError);
  const remoteFinalError = divergenceError("remote-sync", "finalServerSaves", pinnedRemote.finalServerSaves, remote.finalServerSaves);
  if (remoteFinalError) errors.push(remoteFinalError);
  const remoteHash = remoteSyncObservationHash(remote);
  if (remoteHash !== fixture.remoteSync.observationHash) errors.push(`remote-sync observation hash diverged: pinned ${fixture.remoteSync.observationHash}, got ${remoteHash}.`);

  const contentHash = fixtureContentHash(fixture);
  if (contentHash !== fixture.fixtureHash) errors.push(`fixture integrity hash diverged: pinned ${fixture.fixtureHash}, got ${contentHash}.`);

  return { ok: errors.length === 0, errors, bundleMergeHash: mergeHash, autosaveRingHash: ringHash, remoteSyncHash: remoteHash, fixtureHash: contentHash };
}
