import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

/**
 * Tiny in-repo mock of the remote save-sync endpoint contract (see
 * `src/ui/remote-save-storage.ts`). Serves the same wire protocol the
 * `RemoteBundleStorage` backend expects, so the browser QA gate (and any local
 * tooling) can exercise a real sync / conflict / force flow end to end:
 *
 * - GET: 404 when no bundle has ever been pushed (the backend's "empty
 *   remote" signal); 200 `{ schema, revision, bundle }` once populated.
 * - PUT: compare-and-set — 200 `{ revision }` when `expectedRevision` matches
 *   the current revision (or `force` is true); 409 `{ error, currentRevision,
 *   bundle }` otherwise.
 * - CORS preflight so the browser page can call it cross-origin.
 *
 * Run standalone with `node scripts/mock-save-sync-server.mjs [--port N]
 * [--seed-bundle <path>] [--auth-token <token>]`, or embed with
 * `const mock = await createMockSaveSyncServer({ seedBundle, authToken })`.
 *
 * `--seed-bundle <path>` starts the server pre-populated with an
 * `asw91-campaign-save-bundle-v1` JSON document (served at revision 1), so a
 * fresh client with no local saves immediately pulls it and a client with its
 * own saves immediately meets a conflict — no first-sync push needed.
 *
 * `--auth-token <token>` requires `Authorization: Bearer <token>` on every
 * GET/PUT (401 otherwise), mirroring an endpoint that needs credentials so the
 * sync panel's auth field can be exercised end to end.
 */

export const MOCK_SAVE_BUNDLE_SCHEMA = "asw91-campaign-save-bundle-v1";

const HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, accept, authorization",
  "access-control-allow-methods": "GET, PUT, OPTIONS",
};

/**
 * Starts a mock save-sync endpoint on 127.0.0.1 (ephemeral port by default).
 * Pass `seedBundle` to start pre-populated: GET serves it at revision 1 without
 * any prior PUT, so manual testing can exercise pull/conflict immediately.
 * Pass `authToken` to require `Authorization: Bearer <authToken>` on every
 * GET/PUT (401 otherwise).
 */
export async function createMockSaveSyncServer({ port = 0, host = "127.0.0.1", seedBundle = null, authToken = null } = {}) {
  const state = seedBundle ? { revision: 1, bundle: seedBundle } : { revision: 0, bundle: null };
  const server = createServer((req, res) => {
    for (const [key, value] of Object.entries(HEADERS)) res.setHeader(key, value);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (authToken !== null && req.headers.authorization !== `Bearer ${authToken}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      if (req.method === "GET") {
        if (!state.bundle) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ schema: MOCK_SAVE_BUNDLE_SCHEMA, revision: String(state.revision), bundle: state.bundle }));
        return;
      }
      if (req.method === "PUT") {
        const current = state.bundle ? String(state.revision) : null;
        if (body.force !== true && body.expectedRevision !== current) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "conflict", currentRevision: current, bundle: state.bundle }));
          return;
        }
        state.revision += 1;
        state.bundle = body.bundle;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ revision: String(state.revision) }));
        return;
      }
      res.writeHead(405);
      res.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return {
    state,
    host,
    port: address.port,
    /** Full endpoint URL (path is always `/saves`). */
    get endpoint() {
      return `http://${this.host}:${this.port}/saves`;
    },
    /**
     * Simulates a concurrent writer: force-accepts a bundle over HTTP (bumping
     * the revision even if the content is unchanged) so a subsequent `sync()`
     * sees a remote that advanced behind the app's back.
     */
    async putForce(bundle) {
      const response = await fetch(this.endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schema: MOCK_SAVE_BUNDLE_SCHEMA, expectedRevision: String(state.revision), force: true, bundle }),
      });
      if (response.status !== 200) throw new Error(`Mock sync server force-PUT failed with HTTP ${response.status}.`);
      const body = await response.json();
      return { revision: body.revision };
    },
    close() {
      server.close();
    },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const portArg = process.argv.indexOf("--port");
  const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 4174;
  const seedArg = process.argv.indexOf("--seed-bundle");
  let seedBundle = null;
  if (seedArg >= 0) {
    const seedPath = process.argv[seedArg + 1];
    if (!seedPath) {
      console.error("mock-save-sync-server: --seed-bundle requires a bundle JSON file path.");
      process.exit(1);
    }
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(seedPath, "utf8"));
    } catch (error) {
      console.error(`mock-save-sync-server: cannot read a bundle from ${seedPath}: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    if (typeof parsed !== "object" || parsed === null || parsed.schema !== MOCK_SAVE_BUNDLE_SCHEMA || !Array.isArray(parsed.saves)) {
      console.error(`mock-save-sync-server: ${seedPath} is not an ${MOCK_SAVE_BUNDLE_SCHEMA} document (expected { schema, exportedAt, saves[] }).`);
      process.exit(1);
    }
    seedBundle = parsed;
  }
  const authArg = process.argv.indexOf("--auth-token");
  const authToken = authArg >= 0 ? process.argv[authArg + 1] ?? null : null;
  const mock = await createMockSaveSyncServer({ port, seedBundle, authToken });
  console.log(`Mock save-sync server listening at ${mock.endpoint}`);
  if (authToken) {
    console.log(`Requiring Authorization: Bearer ${authToken} on every GET/PUT (401 without it).`);
  }
  if (seedBundle) {
    console.log(`Seeded with ${seedBundle.saves.length} save(s) at revision 1 — GET serves them immediately, so an empty client pulls and a client with local saves meets a conflict.`);
  }
  console.log("GET  -> 404 until a bundle exists; then { schema, revision, bundle }");
  console.log("PUT  -> compare-and-set (409 on stale expectedRevision; force bypasses)");
}
