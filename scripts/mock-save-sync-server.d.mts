/** Wire schema tag served by the mock endpoint. */
export declare const MOCK_SAVE_BUNDLE_SCHEMA: "asw91-campaign-save-bundle-v1";

/** One named-save entry inside a bundle, matching the save-manager shape. */
export interface MockBundleEntry {
  key: string;
  value: string;
}

/** The bundle document the endpoint stores and serves. */
export interface MockSaveBundle {
  schema: string;
  exportedAt: string;
  saves: MockBundleEntry[];
}

/** Live server-side state; tests can inspect it to assert revision counts. */
export interface MockSaveSyncServerState {
  revision: number;
  bundle: MockSaveBundle | null;
}

export interface MockSaveSyncServer {
  state: MockSaveSyncServerState;
  host: string;
  port: number;
  /** Full endpoint URL (path is always `/saves`). */
  readonly endpoint: string;
  /** Force-accepts a bundle over HTTP, bumping the revision (simulates a concurrent writer). */
  putForce(bundle: MockSaveBundle): Promise<{ revision: string }>;
  close(): void;
}

/**
 * Starts a mock save-sync endpoint on 127.0.0.1 implementing the remote-save
 * GET/PUT wire contract (404 when empty, compare-and-set PUT, CORS preflight).
 * Pass `seedBundle` to start pre-populated: GET serves it at revision 1 without
 * any prior PUT, so manual testing can exercise pull/conflict immediately.
 * Pass `authToken` to require `Authorization: Bearer <authToken>` on every
 * GET/PUT (401 otherwise).
 */
export declare function createMockSaveSyncServer(options?: { port?: number; host?: string; seedBundle?: MockSaveBundle; authToken?: string | null }): Promise<MockSaveSyncServer>;
