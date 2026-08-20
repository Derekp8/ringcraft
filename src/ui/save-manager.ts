import { campaignEntrantLabel, hashCampaignState, importCampaignJson, serializeCampaign } from "../core";
import type { CampaignState } from "../core";
import { buildCareerDossier } from "./campaign-presentation";

export const CAMPAIGN_SAVE_PREFIX = "asw91-campaign-save-";
export const CAMPAIGN_LEGACY_SLOT_PREFIX = "asw91-campaign-slot-";
export const SAVE_BUNDLE_SCHEMA = "asw91-campaign-save-bundle-v1" as const;

export interface CampaignSavePreview {
  campaignName: string;
  currentDate: string;
  playerDivision: "singles" | "tag";
  playerLabel: string;
  wins: number;
  draws: number;
  losses: number;
  matches: number;
  titlesHeld: string[];
  wpBalance: number;
}

export interface CampaignSaveMeta {
  saveId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  campaignId: string;
  preview: CampaignSavePreview;
}

export interface CampaignSave extends CampaignSaveMeta {
  campaignJson: string;
}

/** One named-save entry inside a portable JSON bundle. */
export interface CampaignSaveBundleEntry {
  key: string;
  value: string;
}

/**
 * A single downloadable document containing every named save. The bundle is a
 * storage-agnostic snapshot of the `asw91-campaign-save-*` keys, so it can be
 * re-imported into any `SaveStorage` (localStorage or `BundleStorage`).
 */
export interface CampaignSaveBundle {
  schema: typeof SAVE_BUNDLE_SCHEMA;
  exportedAt: string;
  saves: CampaignSaveBundleEntry[];
}

export interface ImportSaveBundleResult {
  /** Brand-new campaign saves written to the storage. */
  imported: number;
  /** Incoming saves that replaced an existing save for the same campaign in place (kept the existing key/name/createdAt, adopted the incoming snapshot and `updatedAt`). */
  merged: number;
  /** Valid incoming saves not applied because an equal-or-newer save for the same campaign already exists. */
  keptLocal: number;
  /** Invalid or non-save entries ignored. */
  skipped: number;
}

/**
 * Per-entry outcome of a save-bundle import, mirroring the merge rules of
 * `importSaveBundle` exactly but computed without touching storage so the UI
 * can show a preview before anything is applied.
 */
export type SaveBundleImportOutcome = "imported" | "merged" | "keptLocal" | "skipped";

/** One planned bundle entry: what would happen, plus why, plus the raw entry to apply. */
export interface SaveBundleImportRow {
  /** The incoming bundle entry key. */
  key: string;
  /** What applying the bundle would do with this entry. */
  outcome: SaveBundleImportOutcome;
  /** Preview of the incoming save, when the entry parsed as a valid save. */
  preview: CampaignSavePreview | null;
  /** Preview of the existing same-campaign save, when one exists (merge/keptLocal rows), so the merge decision is visible. */
  existingPreview: CampaignSavePreview | null;
  /** The incoming entry's `updatedAt`. */
  incomingUpdatedAt: string;
  /** Name of the existing same-campaign save this entry would collide with, if any. */
  existingName: string | null;
  /** `updatedAt` of the existing same-campaign save, if any. */
  existingUpdatedAt: string | null;
  /** Human-readable explanation for the preview. */
  reason: string;
  /** The raw incoming entry value (applied on confirm for `imported`/`merged`). */
  value: string;
  /** The incoming campaign identity (used to re-find the existing save at apply time). */
  campaignId: string | null;
}

/**
 * Pure player-visible diff between a stored save's preview and an incoming
 * one, for the merge preview: lists date, record, WP balance, and titles the
 * same way `diffCampaignSnapshots` words the overwrite preview, so a reviewer
 * can see exactly what the merge would adopt before Apply. Empty list means no
 * tracked difference.
 */
export function diffSavePreviews(stored: CampaignSavePreview | null, incoming: CampaignSavePreview | null): string[] {
  if (!stored || !incoming) return [];
  const changes: string[] = [];
  if (stored.currentDate !== incoming.currentDate) changes.push(`Date: ${stored.currentDate} -> ${incoming.currentDate}`);
  if (stored.wins !== incoming.wins || stored.draws !== incoming.draws || stored.losses !== incoming.losses || stored.matches !== incoming.matches) {
    changes.push(`Record: ${stored.wins}W/${stored.draws}D/${stored.losses}L (${stored.matches} matches) -> ${incoming.wins}W/${incoming.draws}D/${incoming.losses}L (${incoming.matches} matches)`);
  }
  if (stored.wpBalance !== incoming.wpBalance) changes.push(`WP balance: ${stored.wpBalance} -> ${incoming.wpBalance}`);
  const storedTitles = [...stored.titlesHeld].sort().join("|");
  const incomingTitles = [...incoming.titlesHeld].sort().join("|");
  if (storedTitles !== incomingTitles) {
    changes.push(`Titles held: ${stored.titlesHeld.length ? stored.titlesHeld.join(", ") : "none"} -> ${incoming.titlesHeld.length ? incoming.titlesHeld.join(", ") : "none"}`);
  }
  return changes;
}

/** A dry-run of `importSaveBundle`: every outcome computed up front, nothing written. */
export interface SaveBundleImportPlan {
  schema: typeof SAVE_BUNDLE_SCHEMA;
  exportedAt: string;
  rows: SaveBundleImportRow[];
  totals: ImportSaveBundleResult;
}

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export function defaultStorage(): SaveStorage {
  const storage = globalThis.localStorage;
  if (!storage) throw new Error("Save storage is unavailable in this environment.");
  return storage;
}

function payloadKey(saveId: string): string {
  return `${CAMPAIGN_SAVE_PREFIX}${saveId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateSaveId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function deriveSaveName(campaign: CampaignState): string {
  return `${campaign.name} - ${campaign.currentDate}`;
}

export function buildCampaignSavePreview(campaign: CampaignState): CampaignSavePreview {
  const dossier = buildCareerDossier(campaign);
  return {
    campaignName: campaign.name,
    currentDate: campaign.currentDate,
    playerDivision: campaign.playerDivision,
    playerLabel: dossier.entrant,
    wins: dossier.record.wins,
    draws: dossier.record.draws,
    losses: dossier.record.losses,
    matches: dossier.record.matches,
    titlesHeld: dossier.titles.current,
    wpBalance: dossier.wp.balance,
  };
}

function parsePayload(raw: string): CampaignSave | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CampaignSave>;
    if (typeof parsed.saveId !== "string" || typeof parsed.name !== "string" || typeof parsed.campaignId !== "string" || typeof parsed.campaignJson !== "string") return null;
    if (typeof parsed.createdAt !== "string" || typeof parsed.updatedAt !== "string" || typeof parsed.preview !== "object" || parsed.preview === null) return null;
    return parsed as CampaignSave;
  } catch {
    return null;
  }
}

function readPayload(key: string, storage: SaveStorage): CampaignSave | null {
  const raw = storage.getItem(key);
  return raw === null ? null : parsePayload(raw);
}

/** Finds the existing named save with the same campaign identity, if any. */
function findSaveByCampaignId(campaignId: string, storage: SaveStorage): { key: string; record: CampaignSave } | null {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(CAMPAIGN_SAVE_PREFIX)) continue;
    const record = readPayload(key, storage);
    if (record && record.campaignId === campaignId) return { key, record };
  }
  return null;
}

function toMeta(record: CampaignSave): CampaignSaveMeta {
  const { campaignJson: _campaignJson, ...meta } = record;
  return meta;
}

function collectKeys(storage: SaveStorage, prefix: string): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/**
 * Converts legacy numeric slot keys (`asw91-campaign-slot-N`) into named saves.
 * Corrupt legacy values are left untouched so no data is destroyed.
 */
export function migrateLegacySlots(storage: SaveStorage = defaultStorage()): number {
  let migrated = 0;
  for (const key of collectKeys(storage, CAMPAIGN_LEGACY_SLOT_PREFIX)) {
    try {
      const state = importCampaignJson(storage.getItem(key) ?? "").state;
      const slotNumber = key.slice(CAMPAIGN_LEGACY_SLOT_PREFIX.length) || "legacy";
      createSave(state, `Slot ${slotNumber}`, storage);
      storage.removeItem(key);
      migrated += 1;
    } catch {
      // Leave the corrupt legacy key in place; it is not destroyed.
    }
  }
  return migrated;
}

export function listSaves(storage: SaveStorage = defaultStorage()): CampaignSaveMeta[] {
  migrateLegacySlots(storage);
  const records: CampaignSaveMeta[] = [];
  for (const key of collectKeys(storage, CAMPAIGN_SAVE_PREFIX)) {
    const record = readPayload(key, storage);
    if (record) records.push(toMeta(record));
  }
  return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.saveId.localeCompare(right.saveId));
}

export function readSave(saveId: string, storage: SaveStorage = defaultStorage()): CampaignSave | null {
  return readPayload(payloadKey(saveId), storage);
}

export function loadCampaignState(saveId: string, storage: SaveStorage = defaultStorage()): CampaignState {
  const record = readSave(saveId, storage);
  if (!record) throw new Error(`Save "${saveId}" does not exist.`);
  return importCampaignJson(record.campaignJson).state;
}

export function createSave(campaign: CampaignState, name?: string, storage: SaveStorage = defaultStorage()): CampaignSaveMeta {
  const normalized = (name ?? "").trim();
  const record: CampaignSave = {
    saveId: generateSaveId(),
    name: normalized || deriveSaveName(campaign),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    campaignId: campaign.campaignId,
    preview: buildCampaignSavePreview(campaign),
    campaignJson: serializeCampaign(campaign),
  };
  storage.setItem(payloadKey(record.saveId), JSON.stringify(record));
  return toMeta(record);
}

export function duplicateSave(saveId: string, name?: string, storage: SaveStorage = defaultStorage()): CampaignSaveMeta {
  const source = readSave(saveId, storage);
  if (!source) throw new Error(`Save "${saveId}" does not exist.`);
  const record: CampaignSave = {
    ...source,
    saveId: generateSaveId(),
    name: (name ?? "").trim() || `${source.name} (copy)`,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  storage.setItem(payloadKey(record.saveId), JSON.stringify(record));
  return toMeta(record);
}

/**
 * Overwrites an existing save in place with the current campaign snapshot.
 * The save keeps its id, name, and creation timestamp; the campaign payload,
 * preview, and update timestamp are refreshed. Pass `name` to also rename.
 */
export function overwriteSave(saveId: string, campaign: CampaignState, name?: string, storage: SaveStorage = defaultStorage()): CampaignSaveMeta {
  const source = readSave(saveId, storage);
  if (!source) throw new Error(`Save "${saveId}" does not exist.`);
  const record: CampaignSave = {
    ...source,
    name: (name ?? "").trim() || source.name,
    updatedAt: nowIso(),
    campaignId: campaign.campaignId,
    preview: buildCampaignSavePreview(campaign),
    campaignJson: serializeCampaign(campaign),
  };
  storage.setItem(payloadKey(record.saveId), JSON.stringify(record));
  return toMeta(record);
}

export function renameSave(saveId: string, name: string, storage: SaveStorage = defaultStorage()): CampaignSaveMeta {
  const source = readSave(saveId, storage);
  if (!source) throw new Error(`Save "${saveId}" does not exist.`);
  const normalized = name.trim();
  if (!normalized) throw new Error("Save name cannot be empty.");
  const record: CampaignSave = { ...source, name: normalized, updatedAt: nowIso() };
  storage.setItem(payloadKey(record.saveId), JSON.stringify(record));
  return toMeta(record);
}

export function deleteSave(saveId: string, storage: SaveStorage = defaultStorage()): void {
  storage.removeItem(payloadKey(saveId));
}

/** Serializes every named save into a single portable JSON bundle string. */
export function exportSaveBundle(storage: SaveStorage = defaultStorage()): string {
  migrateLegacySlots(storage);
  const saves: CampaignSaveBundleEntry[] = [];
  for (const key of collectKeys(storage, CAMPAIGN_SAVE_PREFIX)) {
    const value = storage.getItem(key);
    if (value !== null) saves.push({ key, value });
  }
  const bundle: CampaignSaveBundle = { schema: SAVE_BUNDLE_SCHEMA, exportedAt: nowIso(), saves };
  return JSON.stringify(bundle, null, 2);
}

/**
 * Dry-runs a save-bundle import without touching storage: every entry is
 * classified exactly as `importSaveBundle` would apply it (imported / merged /
 * keptLocal / skipped, with a reason for the preview). Callers can show the
 * per-campaign outcomes first and only then call `applySaveBundlePlan`.
 */
export function planSaveBundleImport(json: string, storage: SaveStorage = defaultStorage()): SaveBundleImportPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Save bundle is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("Save bundle must be a JSON object.");
  const bundle = parsed as Partial<CampaignSaveBundle>;
  if (bundle.schema !== SAVE_BUNDLE_SCHEMA) throw new Error(`Unsupported save bundle schema ${JSON.stringify(bundle.schema)}.`);
  if (!Array.isArray(bundle.saves)) throw new Error("Save bundle is missing its saves array.");
  const rows: SaveBundleImportRow[] = [];
  const totals: ImportSaveBundleResult = { imported: 0, merged: 0, keptLocal: 0, skipped: 0 };
  // Simulate the import sequentially (like `applySaveBundlePlan` against the
  // real storage): entries later in the same bundle see the earlier ones, so
  // the preview matches exactly what applying will do. Nothing is written.
  const simulated = new Map<string, CampaignSave>();
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(CAMPAIGN_SAVE_PREFIX)) continue;
    const record = readPayload(key, storage);
    if (record) simulated.set(record.campaignId, record);
  }
  for (const rawEntry of bundle.saves) {
    if (typeof rawEntry !== "object" || rawEntry === null) {
      totals.skipped += 1;
      rows.push({ key: "", outcome: "skipped", preview: null, existingPreview: null, incomingUpdatedAt: "", existingName: null, existingUpdatedAt: null, reason: "Not a save entry.", value: "", campaignId: null });
      continue;
    }
    const entry = rawEntry as { key?: unknown; value?: unknown };
    if (typeof entry.key !== "string" || !entry.key.startsWith(CAMPAIGN_SAVE_PREFIX) || typeof entry.value !== "string") {
      totals.skipped += 1;
      rows.push({ key: String(entry.key ?? ""), outcome: "skipped", preview: null, existingPreview: null, incomingUpdatedAt: "", existingName: null, existingUpdatedAt: null, reason: "Not a save entry.", value: "", campaignId: null });
      continue;
    }
    const incoming = parsePayload(entry.value);
    if (!incoming) {
      totals.skipped += 1;
      rows.push({ key: entry.key, outcome: "skipped", preview: null, existingPreview: null, incomingUpdatedAt: "", existingName: null, existingUpdatedAt: null, reason: "Unreadable save payload.", value: "", campaignId: null });
      continue;
    }
    const existing = simulated.get(incoming.campaignId) ?? null;
    if (!existing) {
      totals.imported += 1;
      simulated.set(incoming.campaignId, incoming);
      rows.push({ key: entry.key, outcome: "imported", preview: incoming.preview, existingPreview: null, incomingUpdatedAt: incoming.updatedAt, existingName: null, existingUpdatedAt: null, reason: `New save - will add "${incoming.name}" (${incoming.preview.currentDate}).`, value: entry.value, campaignId: incoming.campaignId });
      continue;
    }
    if (incoming.updatedAt > existing.updatedAt) {
      totals.merged += 1;
      simulated.set(incoming.campaignId, { ...existing, updatedAt: incoming.updatedAt, preview: incoming.preview, campaignJson: incoming.campaignJson });
      rows.push({ key: entry.key, outcome: "merged", preview: incoming.preview, existingPreview: existing.preview, incomingUpdatedAt: incoming.updatedAt, existingName: existing.name, existingUpdatedAt: existing.updatedAt, reason: `Newer snapshot will update "${existing.name}" in place (${incoming.updatedAt} > ${existing.updatedAt}).`, value: entry.value, campaignId: incoming.campaignId });
    } else {
      totals.keptLocal += 1;
      rows.push({ key: entry.key, outcome: "keptLocal", preview: incoming.preview, existingPreview: existing.preview, incomingUpdatedAt: incoming.updatedAt, existingName: existing.name, existingUpdatedAt: existing.updatedAt, reason: `Kept "${existing.name}" - the incoming snapshot is not newer (${incoming.updatedAt}).`, value: "", campaignId: incoming.campaignId });
    }
  }
  return { schema: bundle.schema, exportedAt: bundle.exportedAt ?? "", rows, totals };
}

/**
 * Applies a previously computed plan to a storage, writing exactly the
 * `imported` and `merged` rows (re-finding the existing same-campaign save at
 * apply time so the merge is still correct if storage changed since preview).
 */
export function applySaveBundlePlan(plan: SaveBundleImportPlan, storage: SaveStorage = defaultStorage()): ImportSaveBundleResult {
  let imported = 0;
  let merged = 0;
  let keptLocal = 0;
  let skipped = 0;
  for (const row of plan.rows) {
    if (row.outcome === "skipped") {
      skipped += 1;
      continue;
    }
    if (row.outcome === "keptLocal" || row.campaignId === null) {
      keptLocal += 1;
      continue;
    }
    if (row.outcome === "imported") {
      storage.setItem(row.key, row.value);
      imported += 1;
      continue;
    }
    const existing = findSaveByCampaignId(row.campaignId, storage);
    const incoming = parsePayload(row.value);
    if (!existing || !incoming) {
      storage.setItem(row.key, row.value);
      imported += 1;
      continue;
    }
    if (incoming.updatedAt > existing.record.updatedAt) {
      const mergedRecord: CampaignSave = {
        ...existing.record,
        campaignId: incoming.campaignId,
        updatedAt: incoming.updatedAt,
        preview: incoming.preview,
        campaignJson: incoming.campaignJson,
      };
      storage.setItem(existing.key, JSON.stringify(mergedRecord));
      merged += 1;
    } else {
      keptLocal += 1;
    }
  }
  return { imported, merged, keptLocal, skipped };
}

/**
 * Re-imports a save bundle into a storage, restoring every named save while
 * merging intelligently: a valid incoming save whose `campaignId` matches an
 * existing save is never duplicated — the strictly newer `updatedAt` wins. The
 * winner is written in place (the existing save keeps its key/name/createdAt
 * and adopts the incoming snapshot and `updatedAt`), and a valid incoming save
 * that is equal-or-older is kept out (`keptLocal`). Corrupt or non-save
 * entries are skipped and counted, never silently recomputed; an unsupported
 * schema or unparsable document throws. Implemented as plan-then-apply so the
 * merge preview and the applied import can never disagree.
 */
export function importSaveBundle(json: string, storage: SaveStorage = defaultStorage()): ImportSaveBundleResult {
  return applySaveBundlePlan(planSaveBundleImport(json, storage), storage);
}

/**
 * A second `SaveStorage` backend that holds every named save behind a single
 * JSON bundle string instead of many localStorage keys. Construct from a
 * bundle with `BundleStorage.fromBundle` and round-trip back with `toBundle`.
 */
export class BundleStorage implements SaveStorage {
  private readonly entries = new Map<string, string>();
  get length(): number { return this.entries.size; }
  getItem(key: string): string | null { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string): void { this.entries.set(key, value); }
  removeItem(key: string): void { this.entries.delete(key); }
  key(index: number): string | null { return [...this.entries.keys()][index] ?? null; }
  static fromBundle(json: string): BundleStorage {
    const storage = new BundleStorage();
    importSaveBundle(json, storage);
    return storage;
  }
  toBundle(): string { return exportSaveBundle(this); }
}

/** Versioned autosave snapshots: the last `N` (default 5) are kept, newest first. */
export const AUTOSAVE_SNAPSHOT_SCHEMA = "asw91-project-ringcraft-autosave-snapshot-v1" as const;
export const AUTOSAVE_KEY_PREFIX = "asw91-project-ringcraft-autosave-v1-";
export const LEGACY_AUTOSAVE_KEY = "asw91-project-ringcraft-autosave-v1";
export const DEFAULT_AUTOSAVE_MAX_SNAPSHOTS = 5;

/** One versioned autosave snapshot: a validated campaign plus write metadata. */
export interface AutosaveSnapshot {
  schema: typeof AUTOSAVE_SNAPSHOT_SCHEMA;
  savedAt: string;
  campaignId: string;
  campaignHash: string;
  campaignJson: string;
}

export interface AutosaveSnapshotMeta {
  key: string;
  savedAt: string;
  campaignId: string;
  campaignHash: string;
}

export function parseAutosaveSnapshot(raw: string): AutosaveSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as Partial<AutosaveSnapshot>;
    if (parsed.schema !== AUTOSAVE_SNAPSHOT_SCHEMA) return null;
    if (typeof parsed.savedAt !== "string" || typeof parsed.campaignId !== "string" || typeof parsed.campaignHash !== "string" || typeof parsed.campaignJson !== "string") return null;
    return parsed as AutosaveSnapshot;
  } catch {
    return null;
  }
}

/** Lists autosave snapshots newest first, skipping corrupt or foreign entries. */
export function listAutosaves(storage: SaveStorage = defaultStorage()): AutosaveSnapshotMeta[] {
  const metas: AutosaveSnapshotMeta[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(AUTOSAVE_KEY_PREFIX)) continue;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    const snapshot = parseAutosaveSnapshot(raw);
    if (!snapshot) continue;
    metas.push({ key, savedAt: snapshot.savedAt, campaignId: snapshot.campaignId, campaignHash: snapshot.campaignHash });
  }
  return metas.sort((left, right) => right.savedAt.localeCompare(left.savedAt) || right.key.localeCompare(left.key));
}

/** localStorage key that remembers the monotonic autosave write sequence. */
const AUTOSAVE_SEQUENCE_KEY = "asw91-project-ringcraft-autosave-seq";

/**
 * Returns a monotonic autosave key for this write. Keys embed a persisted
 * write sequence (zero-padded so lexicographic order equals write order), so
 * the newest-first ring ordering never depends on `savedAt` uniqueness: two
 * snapshots written in the same instant (or under a frozen test clock) stay
 * correctly ordered, and pruned keys are never reused as newer snapshots.
 */
function uniqueAutosaveKey(storage: SaveStorage, savedAt: string): string {
  let sequence = 0;
  const raw = storage.getItem(AUTOSAVE_SEQUENCE_KEY);
  if (raw !== null) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) sequence = parsed;
  }
  sequence += 1;
  storage.setItem(AUTOSAVE_SEQUENCE_KEY, String(sequence));
  return `${AUTOSAVE_KEY_PREFIX}${savedAt}-${String(sequence).padStart(6, "0")}`;
}

/**
 * Writes a new versioned autosave snapshot for the campaign, prunes to the
 * newest `maxSnapshots` (default 5), and removes the pre-versioning single-key
 * autosave (superseded by the snapshot ring). Returns the new snapshot's meta.
 */
export function writeAutosave(campaign: CampaignState, storage: SaveStorage = defaultStorage(), options: { now?: () => string; maxSnapshots?: number } = {}): AutosaveSnapshotMeta {
  const savedAt = (options.now ?? nowIso)();
  const snapshot: AutosaveSnapshot = {
    schema: AUTOSAVE_SNAPSHOT_SCHEMA,
    savedAt,
    campaignId: campaign.campaignId,
    campaignHash: hashCampaignState(campaign),
    campaignJson: serializeCampaign(campaign),
  };
  const key = uniqueAutosaveKey(storage, savedAt);
  storage.setItem(key, JSON.stringify(snapshot));
  storage.removeItem(LEGACY_AUTOSAVE_KEY);
  pruneAutosaves(storage, options.maxSnapshots ?? DEFAULT_AUTOSAVE_MAX_SNAPSHOTS);
  return { key, savedAt, campaignId: snapshot.campaignId, campaignHash: snapshot.campaignHash };
}

/** Removes autosave snapshots beyond the newest `maxSnapshots`; returns how many were removed. */
export function pruneAutosaves(storage: SaveStorage = defaultStorage(), maxSnapshots = DEFAULT_AUTOSAVE_MAX_SNAPSHOTS): number {
  const metas = listAutosaves(storage);
  let removed = 0;
  for (const meta of metas.slice(maxSnapshots)) {
    storage.removeItem(meta.key);
    removed += 1;
  }
  return removed;
}

/** Removes one specific autosave snapshot by its storage key. */
export function deleteAutosave(key: string, storage: SaveStorage = defaultStorage()): void {
  if (!key.startsWith(AUTOSAVE_KEY_PREFIX)) throw new Error(`"${key}" is not an autosave snapshot key.`);
  storage.removeItem(key);
}

/** Promotes a specific autosave snapshot into a named save (name derived when omitted). */
export function saveAutosaveAsNamedSave(key: string, name?: string, storage: SaveStorage = defaultStorage()): CampaignSaveMeta {
  return createSave(loadAutosaveSnapshot(key, storage), name, storage);
}

/** Schema tag for an archival bundle of the whole autosave snapshot ring. */
export const AUTOSAVE_BUNDLE_SCHEMA = "asw91-autosave-bundle-v1" as const;

/** One autosave snapshot inside an archival bundle, faithful to the ring entry. */
export interface AutosaveBundleEntry {
  key: string;
  savedAt: string;
  campaignId: string;
  campaignHash: string;
  campaignJson: string;
}

/** A single downloadable document containing every autosave snapshot in the ring. */
export interface AutosaveBundle {
  schema: typeof AUTOSAVE_BUNDLE_SCHEMA;
  exportedAt: string;
  autosaves: AutosaveBundleEntry[];
}

/**
 * Serializes the whole autosave snapshot ring into a single archival bundle
 * string, newest first (the ring's canonical ordering). Unlike the named-save
 * bundle, every snapshot is kept verbatim — snapshots of the same campaign are
 * never merged away — so the archive preserves the ring's full depth.
 */
export function exportAutosaveBundle(storage: SaveStorage = defaultStorage()): string {
  const autosaves: AutosaveBundleEntry[] = [];
  for (const meta of listAutosaves(storage)) {
    const raw = storage.getItem(meta.key);
    if (raw === null) continue;
    const snapshot = parseAutosaveSnapshot(raw);
    if (!snapshot) continue;
    autosaves.push({ key: meta.key, savedAt: snapshot.savedAt, campaignId: snapshot.campaignId, campaignHash: snapshot.campaignHash, campaignJson: snapshot.campaignJson });
  }
  const bundle: AutosaveBundle = { schema: AUTOSAVE_BUNDLE_SCHEMA, exportedAt: nowIso(), autosaves };
  return JSON.stringify(bundle, null, 2);
}

/** Loads the newest valid autosave snapshot, falling back to the legacy single-key autosave. */
export function readLatestAutosave(storage: SaveStorage = defaultStorage()): CampaignState | null {
  const latest = listAutosaves(storage)[0];
  if (latest) return loadAutosaveSnapshot(latest.key, storage);
  const legacy = storage.getItem(LEGACY_AUTOSAVE_KEY);
  if (legacy) {
    try {
      return importCampaignJson(legacy).state;
    } catch {
      return null;
    }
  }
  return null;
}

/** Loads a specific autosave snapshot by its storage key, validating the campaign. */
export function loadAutosaveSnapshot(key: string, storage: SaveStorage = defaultStorage()): CampaignState {
  const raw = storage.getItem(key);
  if (raw === null) throw new Error(`Autosave snapshot "${key}" does not exist.`);
  const snapshot = parseAutosaveSnapshot(raw);
  if (!snapshot) throw new Error(`Autosave snapshot "${key}" is corrupt.`);
  return importCampaignJson(snapshot.campaignJson).state;
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
