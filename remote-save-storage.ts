import { fnv1a32 } from "../core";
import { CAMPAIGN_SAVE_PREFIX, SAVE_BUNDLE_SCHEMA, exportSaveBundle, importSaveBundle } from "./save-manager";
import type { CampaignSaveBundle, SaveStorage } from "./save-manager";

/** Reserved key inside the wrapped storage that records the last successful sync baseline. */
export const SYNC_META_SCHEMA = "asw91-campaign-sync-meta-v1" as const;
export const SYNC_META_KEY = "asw91-campaign-sync-meta-v1";

export interface HttpResponse {
  status: number;
  body: unknown;
}

export interface HttpRequest {
  method: "GET" | "PUT";
  body?: string;
  /** Extra headers to send (e.g. the `authorization` bearer token). */
  headers?: Record<string, string>;
}

/**
 * The minimal HTTP surface a remote save endpoint must satisfy. Injectable so
 * tests can exercise the backend without a network; the default implementation
 * uses `globalThis.fetch`.
 */
export type HttpClient = (endpoint: string, request: HttpRequest) => Promise<HttpResponse>;

export function defaultHttpClient(): HttpClient {
  return async (endpoint, request) => {
    if (typeof globalThis.fetch !== "function") throw new Error("Remote save sync requires a fetch-capable environment.");
    const response = await globalThis.fetch(endpoint, {
      method: request.method,
      headers: { "content-type": "application/json", accept: "application/json", ...request.headers },
      body: request.body,
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  };
}

export interface SyncMeta {
  schema: typeof SYNC_META_SCHEMA;
  /** Content fingerprint of the local bundle at the last successful sync. */
  lastSyncedFingerprint: string | null;
  /** Server revision token observed at the last successful sync; `null` means never synced. */
  lastRemoteRevision: string | null;
  /** ISO timestamp of the last successful sync, or `null` when never synced. */
  syncedAt: string | null;
}

export type SyncStatus = "up-to-date" | "pushed" | "pulled" | "conflict";

export interface SyncResult {
  status: SyncStatus;
  /** Content fingerprint of the local bundle after the operation. */
  localFingerprint: string;
  /** Content fingerprint of the remote bundle observed during the operation, if any. */
  remoteFingerprint: string | null;
  /** Server revision observed during the operation, if any. */
  remoteRevision: string | null;
  message: string;
}

/**
 * Thrown when a compare-and-set push is rejected because the server moved to a
 * newer revision between the sync's GET and PUT (a concurrent writer).
 */
export class SaveSyncConflictError extends Error {
  readonly currentRevision: string | null;
  constructor(currentRevision: string | null) {
    super(`Remote save conflict: the server is at revision ${currentRevision ?? "unknown"}.`);
    this.name = "SaveSyncConflictError";
    this.currentRevision = currentRevision;
  }
}

/**
 * Deterministic identity of a save bundle's content. Uses the project's
 * canonical `fnv1a32` over `{ schema, saves }` so it is stable across exports
 * (the `exportedAt` timestamp is intentionally excluded) and across object key
 * ordering. Two bundles with the same named saves always compare equal.
 */
export function bundleContentFingerprint(bundle: CampaignSaveBundle): string {
  return fnv1a32({ schema: bundle.schema, saves: bundle.saves });
}

function emptyMeta(): SyncMeta {
  return { schema: SYNC_META_SCHEMA, lastSyncedFingerprint: null, lastRemoteRevision: null, syncedAt: null };
}

function readMeta(storage: SaveStorage): SyncMeta {
  const raw = storage.getItem(SYNC_META_KEY);
  if (!raw) return emptyMeta();
  try {
    const parsed = JSON.parse(raw) as Partial<SyncMeta>;
    if (parsed.schema !== SYNC_META_SCHEMA) return emptyMeta();
    return {
      schema: SYNC_META_SCHEMA,
      lastSyncedFingerprint: typeof parsed.lastSyncedFingerprint === "string" ? parsed.lastSyncedFingerprint : null,
      lastRemoteRevision: typeof parsed.lastRemoteRevision === "string" ? parsed.lastRemoteRevision : null,
      syncedAt: typeof parsed.syncedAt === "string" ? parsed.syncedAt : null,
    };
  } catch {
    return emptyMeta();
  }
}

/**
 * The last successful sync baseline recorded in a storage (never touches the
 * server): the bundle fingerprint, the server revision, and when it happened.
 * Returns the empty baseline (`null` fields) when never synced.
 */
export function readSyncMeta(storage: SaveStorage): SyncMeta {
  return readMeta(storage);
}

/** Records a successful sync baseline, stamped with the current time. */
function writeMeta(storage: SaveStorage, fingerprint: string | null, revision: string | null): void {
  storage.setItem(SYNC_META_KEY, JSON.stringify({
    schema: SYNC_META_SCHEMA,
    lastSyncedFingerprint: fingerprint,
    lastRemoteRevision: revision,
    syncedAt: new Date().toISOString(),
  }));
}

function localBundle(storage: SaveStorage): CampaignSaveBundle {
  return JSON.parse(exportSaveBundle(storage)) as CampaignSaveBundle;
}

/** Wraps an `HttpClient` so every request carries `Authorization: Bearer <token>`. */
function withBearerAuth(http: HttpClient, token: string): HttpClient {
  return (endpoint, request) => http(endpoint, {
    ...request,
    headers: { ...request.headers, authorization: `Bearer ${token}` },
  });
}

/**
 * Replaces the storage's named-save set with exactly the bundle's entries, so
 * a pull faithfully adopts the remote snapshot (remote deletions propagate).
 * Corrupt remote entries are skipped and counted by `importSaveBundle`.
 */
function replaceBundle(storage: SaveStorage, bundle: CampaignSaveBundle): void {
  const incoming = new Set(bundle.saves.map((entry) => entry.key));
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  for (const key of keys) {
    if (key.startsWith(CAMPAIGN_SAVE_PREFIX) && !incoming.has(key)) storage.removeItem(key);
  }
  importSaveBundle(JSON.stringify(bundle), storage);
}

interface RemoteSnapshot {
  revision: string | null;
  bundle: CampaignSaveBundle | null;
  fingerprint: string | null;
}

async function fetchRemote(http: HttpClient, endpoint: string): Promise<RemoteSnapshot> {
  const response = await http(endpoint, { method: "GET" });
  if (response.status === 404) return { revision: null, bundle: null, fingerprint: null };
  if (response.status !== 200) throw new Error(`Remote save endpoint returned HTTP ${response.status} on GET.`);
  const body = response.body as { schema?: unknown; revision?: unknown; bundle?: unknown };
  if (body.schema !== SAVE_BUNDLE_SCHEMA) throw new Error(`Unsupported remote save schema ${JSON.stringify(body.schema)}.`);
  if (typeof body.revision !== "string") throw new Error("Remote save endpoint did not return a revision.");
  const bundle = body.bundle;
  if (typeof bundle !== "object" || bundle === null || !Array.isArray((bundle as CampaignSaveBundle).saves)) throw new Error("Remote save endpoint returned an invalid bundle.");
  const snapshot = bundle as CampaignSaveBundle;
  return { revision: body.revision, bundle: snapshot, fingerprint: bundleContentFingerprint(snapshot) };
}

async function pushRemote(http: HttpClient, endpoint: string, expectedRevision: string | null, bundle: CampaignSaveBundle, force: boolean): Promise<string> {
  const response = await http(endpoint, {
    method: "PUT",
    body: JSON.stringify({ schema: SAVE_BUNDLE_SCHEMA, expectedRevision, force, bundle }),
  });
  if (response.status === 409) {
    const body = response.body as { currentRevision?: unknown };
    throw new SaveSyncConflictError(typeof body?.currentRevision === "string" ? body.currentRevision : null);
  }
  if (response.status !== 200) throw new Error(`Remote save endpoint returned HTTP ${response.status} on PUT.`);
  const body = response.body as { revision?: unknown };
  if (typeof body.revision !== "string") throw new Error("Remote save endpoint did not return a revision after push.");
  return body.revision;
}

/**
 * A third `SaveStorage` backend that keeps the named-save bundle behind a
 * server endpoint instead of browser keys. It wraps any local `SaveStorage`
 * (localStorage by default), serves all five `SaveStorage` methods
 * synchronously from the wrapped storage, and reconciles that storage with the
 * server through `sync()`:
 *
 * - only the local side changed  → push (compare-and-set against the last revision);
 * - only the remote side changed → pull (adopt the remote snapshot);
 * - both changed since the last sync (or a first sync meets a populated server
 *   next to local data) → `conflict`, touching nothing;
 * - neither changed → `up-to-date`.
 *
 * `forcePush` / `forcePull` resolve a conflict explicitly by choosing a side.
 * The sync baseline (`asw91-campaign-sync-meta-v1`) lives inside the wrapped
 * storage so it persists across sessions and is never part of the bundle.
 */
export class RemoteBundleStorage implements SaveStorage {
  readonly endpoint: string;
  private readonly http: HttpClient;
  private readonly storage: SaveStorage;

  constructor(options: { endpoint: string; http?: HttpClient; storage?: SaveStorage; authToken?: string }) {
    this.endpoint = options.endpoint;
    const http = options.http ?? defaultHttpClient();
    const token = options.authToken?.trim() ?? "";
    // When an auth token is configured, wrap the transport so every outbound
    // GET/PUT carries `Authorization: Bearer <token>`. The header is part of the
    // request the injected client sees, so tests can assert it without a
    // network; the default fetch client forwards it to the wire.
    this.http = token ? withBearerAuth(http, token) : http;
    const wrapped = options.storage ?? (globalThis.localStorage as SaveStorage | undefined);
    if (!wrapped) throw new Error("Remote save sync requires a wrapped storage; pass `storage` when localStorage is unavailable.");
    this.storage = wrapped;
  }

  get length(): number { return this.storage.length; }
  getItem(key: string): string | null { return this.storage.getItem(key); }
  setItem(key: string, value: string): void { this.storage.setItem(key, value); }
  removeItem(key: string): void { this.storage.removeItem(key); }
  key(index: number): string | null { return this.storage.key(index); }

  /** Content fingerprint of the current local named-save set. */
  currentFingerprint(): string {
    return bundleContentFingerprint(localBundle(this.storage));
  }

  /** The last successful sync baseline recorded in the wrapped storage. */
  syncMeta(): SyncMeta {
    return readMeta(this.storage);
  }

  async sync(): Promise<SyncResult> {
    const meta = readMeta(this.storage);
    const local = localBundle(this.storage);
    const localFingerprint = bundleContentFingerprint(local);
    const remote = await fetchRemote(this.http, this.endpoint);

    if (remote.revision === meta.lastRemoteRevision) {
      if (localFingerprint === meta.lastSyncedFingerprint) {
        return { status: "up-to-date", localFingerprint, remoteFingerprint: remote.fingerprint, remoteRevision: remote.revision, message: "Local saves and the remote endpoint are already in sync." };
      }
      return this.pushInternal(localFingerprint, local, meta.lastRemoteRevision);
    }

    if (localFingerprint === meta.lastSyncedFingerprint) {
      return this.pullInternal(remote);
    }

    // No baseline and no local saves against a populated remote: adopt the
    // remote (a fresh device has nothing local to lose).
    if (meta.lastSyncedFingerprint === null && local.saves.length === 0 && remote.bundle !== null) {
      return this.pullInternal(remote);
    }

    return {
      status: "conflict",
      localFingerprint,
      remoteFingerprint: remote.fingerprint,
      remoteRevision: remote.revision,
      message: "Save conflict: local and remote both changed since the last sync. Choose force push (keep local) or force pull (take remote).",
    };
  }

  private async pushInternal(localFingerprint: string, local: CampaignSaveBundle, expectedRevision: string | null): Promise<SyncResult> {
    try {
      const revision = await pushRemote(this.http, this.endpoint, expectedRevision, local, false);
      writeMeta(this.storage, localFingerprint, revision);
      return { status: "pushed", localFingerprint, remoteFingerprint: localFingerprint, remoteRevision: revision, message: "Pushed local saves to the remote endpoint." };
    } catch (error) {
      if (error instanceof SaveSyncConflictError) {
        return {
          status: "conflict",
          localFingerprint,
          remoteFingerprint: null,
          remoteRevision: error.currentRevision,
          message: "Push conflict: the remote advanced while syncing. Choose force push (keep local) or force pull (take remote).",
        };
      }
      throw error;
    }
  }

  private async pullInternal(remote: RemoteSnapshot): Promise<SyncResult> {
    if (remote.bundle === null) {
      replaceBundle(this.storage, { schema: SAVE_BUNDLE_SCHEMA, exportedAt: new Date().toISOString(), saves: [] });
      const fingerprint = bundleContentFingerprint({ schema: SAVE_BUNDLE_SCHEMA, exportedAt: "", saves: [] });
      writeMeta(this.storage, fingerprint, null);
      return { status: "pulled", localFingerprint: fingerprint, remoteFingerprint: null, remoteRevision: null, message: "Remote endpoint is empty; cleared local named saves." };
    }
    const fingerprint = bundleContentFingerprint(remote.bundle);
    replaceBundle(this.storage, remote.bundle);
    writeMeta(this.storage, fingerprint, remote.revision);
    return { status: "pulled", localFingerprint: fingerprint, remoteFingerprint: fingerprint, remoteRevision: remote.revision, message: "Pulled remote saves into local storage." };
  }

  /** Overwrites the remote with the current local bundle, regardless of revision. */
  async forcePush(): Promise<SyncResult> {
    const local = localBundle(this.storage);
    const localFingerprint = bundleContentFingerprint(local);
    const revision = await pushRemote(this.http, this.endpoint, null, local, true);
    writeMeta(this.storage, localFingerprint, revision);
    return { status: "pushed", localFingerprint, remoteFingerprint: localFingerprint, remoteRevision: revision, message: "Force-pushed local saves over the remote endpoint." };
  }

  /** Overwrites the local named-save set with the remote bundle, regardless of revision. */
  async forcePull(): Promise<SyncResult> {
    const remote = await fetchRemote(this.http, this.endpoint);
    if (remote.bundle === null) {
      replaceBundle(this.storage, { schema: SAVE_BUNDLE_SCHEMA, exportedAt: new Date().toISOString(), saves: [] });
      const fingerprint = bundleContentFingerprint({ schema: SAVE_BUNDLE_SCHEMA, exportedAt: "", saves: [] });
      writeMeta(this.storage, fingerprint, null);
      return { status: "pulled", localFingerprint: fingerprint, remoteFingerprint: null, remoteRevision: null, message: "Remote endpoint is empty; cleared local named saves." };
    }
    const fingerprint = bundleContentFingerprint(remote.bundle);
    replaceBundle(this.storage, remote.bundle);
    writeMeta(this.storage, fingerprint, remote.revision);
    return { status: "pulled", localFingerprint: fingerprint, remoteFingerprint: fingerprint, remoteRevision: remote.revision, message: "Pulled remote saves into local storage." };
  }
}
