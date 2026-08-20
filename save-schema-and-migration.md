# Campaign save schema and migration policy

> **Reader's map.** The save layer has two storage-layer contracts beyond the base manager, each documented in its own section: the **campaign-aware bundle import merge rule** (next section) and the **remote sync backend** (third storage section). They are independent of each other but originally shipped together in a single commit (`49d3890`), so future readers can find either contract on its own instead of digging through one combined change. The base write/recovery contract, autosave ring, named-save manager, and preview gates live in the Write and recovery contract section below.

## Initial boundary

M5 establishes `asw91-campaign-v1` as the first campaign-save schema. There is no M0–M4 campaign format to migrate. M4 `asw91-wrestler-v1` records and `asw91-reference-roster-v1` batches are inputs to campaign creation, not prior campaign saves.

The registry in `src/core/campaign-serialization.ts` contains a validated v1 identity migration. Every future schema must add an explicit registry entry and fixture; unsupported versions are rejected.

## Pinned compatibility metadata

Every campaign save contains:

- `schemaVersion: asw91-campaign-v1`;
- the match `rulesetVersion`;
- `campaignRulesetVersion: 1.2.0-m5-candidate`;
- `dataPackVersion: classic-1991-m5-v1`;
- immutable `dataHash` for M5 rules data;
- seeded PRNG algorithm/state, including scripted-roll cursor when present;
- complete M4 wrestler records and persistent team identities;
- current and historical rankings, titles, shots, vacancies, injuries, schedule, match history, and applied-result IDs;
- active match state at supported checkpoints;
- ordered campaign events with intent/input, dice, formulas/detail, and pre/post hashes.

Completed matches retain compact deterministic replay data: the original `MatchConfiguration`, ordered player/policy inputs, official result, and expected final match hash. They do not duplicate the full immutable final `MatchState` event list.

## Write and recovery contract

The React Career surface writes a versioned autosave snapshot after every accepted campaign transaction and every submitted player decision/checkpoint. The snapshot ring keeps the newest `N` (default 5) with timestamps: the newest restores the current campaign on load, and the **Autosave history** list on the dashboard can restore any kept snapshot (each restores the exact campaign, replay, PRNG state, and hash). Ring maintenance is explicit on the dashboard: the **Keep last N snapshots** control sets `N` (clamped 1–50, persisted under `asw91-project-ringcraft-autosave-max`; every write trims to it, so lowering it prunes the oldest snapshots immediately and reports how many were removed), each row's **Prune** deletes that one snapshot after a destructive-confirmation dialog, and **Export as save** promotes a snapshot's exact campaign into a named save — prompting for an optional name (derived from the snapshot when empty) and giving the new save its own id, while the snapshot stays in the ring until pruned or evicted. **Export all** serializes the whole ring into a single archival `asw91-autosave-bundle-v1` JSON bundle (every snapshot verbatim, newest first — same-campaign snapshots are never merged away, unlike the named-save bundle's campaign-aware import). The pre-versioning single-key autosave is read as a fallback until the first versioned write migrates it. Named save files are explicit snapshots managed from the save manager (timestamps, previews, duplicate/rename/delete/update-in-place — Update refreshes an existing save's campaign snapshot at its current name while keeping its id and creation timestamp). **Update opens an overwrite preview first**: a pure diff between the stored snapshot and the live campaign (date, record, WP balance, titles held, injuries added/cleared, open/completed bookings, champions, match-checkpoint state, and the event-count delta with the stored → current hash equation), and the write only happens on explicit Confirm. The same dialog also mirrors the restore direction — a second labeled section lists what **restoring this save instead would change** (current → stored) with the same discard warning and roll-forward hint the restore preview shows, so the player sees both what the update records and what the stored snapshot holds relative to the live campaign before overwriting it. Loading a named save or restoring an autosave snapshot **over a live campaign opens the same preview in the reverse direction** (current → stored): it leads with a snapshot summary (the snapshot's date, record, and campaign hash) and lists exactly what the restore will roll back (date, record, titles, injuries, bookings, champions, event delta) with the current → stored hash equation, and applies only on explicit Confirm — the same confirm-gate UX as the overwrite preview. When the stored snapshot is older, the preview adds a warning that **restoring discards N events since this snapshot** (N is the event-count delta between the live campaign and the snapshot) plus a **roll-forward hint** naming the snapshot's date, noting the restore rolls the campaign back, and pointing out that rolling forward again is possible by restoring a newer snapshot or named save — or by exporting the current campaign as a named save first to keep it. **Importing a campaign JSON file over a live campaign opens the same preview in the import direction** (current → imported): it leads with the imported file's record and campaign hash, lists the rollback diff the replace would apply, and applies only on explicit Confirm. **Export save bundle** serializes every named save into a single portable `asw91-campaign-save-bundle-v1` document; **Import save bundle** restores them into any storage (the same backend contract as `BundleStorage`, a `SaveStorage` whose keys live behind one bundle string) under the **campaign-aware merge rule** documented in its own section below: valid entries are restored byte-identically, invalid ones are counted as skipped, same-campaign duplicates are merged in place or kept local by `updatedAt`, and the import opens a preview first — nothing is written until explicit Apply, and nothing is ever recomputed. A match result is not official until `commitScheduledMatchResult` verifies the match replay and atomically records an application ID. The `appliedMatchIds` guard prevents refresh, retry, or replay from applying the same result twice.

An in-progress save restores the exact match, input log, PRNG state, campaign hash, and schedule status. `fixtures/m5/example-in-progress-save.json` is loaded and continued by `npm run fixtures:verify`.

Browser keys:

| Purpose | Key |
|---|---|
| Autosave | `asw91-project-ringcraft-autosave-v1-<timestamp>-<sequence>` snapshots (newest `N` = 5 kept; the zero-padded sequence keeps write order even when two snapshots share a timestamp, each `asw91-project-ringcraft-autosave-snapshot-v1` with `savedAt`/campaign hash); legacy `asw91-project-ringcraft-autosave-v1` read as a fallback and migrated on the first versioned write |
| Named save files | `asw91-campaign-save-<id>`; legacy `asw91-campaign-slot-1`, `-2`, `-3` are migrated on first load |
| Save bundle | a single `asw91-campaign-save-bundle-v1` JSON document containing every named save, exportable/importable from the save manager; `BundleStorage` keeps the same entries behind one bundle string |
| Sync metadata | `asw91-campaign-sync-meta-v1` — the last successful sync baseline (bundle content fingerprint and server revision); written by the remote sync backend and never part of the save bundle |

Local storage replacement is synchronous at this project scale. Browser implementations own the physical path/quota; JSON export is the portable backup.

## Campaign-aware bundle import merge rule

`Import save bundle` restores an `asw91-campaign-save-bundle-v1` document into any `SaveStorage` (localStorage or `BundleStorage`) by classifying every valid entry against the *current* storage, sequentially and deterministically by `campaignId` (entries later in the same bundle see the earlier ones, so two same-campaign entries inside one bundle merge exactly as they would against storage):

| Outcome | Condition | Effect |
|---|---|---|
| `imported` | No existing save has the incoming `campaignId` | The entry is added under its own key. |
| `merged` | An existing save has the same `campaignId` and `incoming.updatedAt > existing.updatedAt` | The strictly-newer snapshot wins and is written **in place**: the existing save keeps its key/name/createdAt and adopts the incoming snapshot and `updatedAt`. |
| `keptLocal` | An existing save has the same `campaignId` and `incoming.updatedAt <= existing.updatedAt` | Nothing is written; the existing save is kept. |
| `skipped` | Not an object entry, an unprefixed or non-string key, or an unreadable payload | Nothing is written; the entry is counted as skipped. |

The rule is deterministic and strictly monotone in `updatedAt` (ISO strings; a tie keeps local). It never recomputes or overwrites unrelated data.

**Preview/apply split** (`planSaveBundleImport` / `applySaveBundlePlan` in `src/ui/save-manager.ts`): the plan dry-runs the exact classification against a simulated copy of storage (no writes) and returns per-row outcomes plus `imported`/`merged`/`keptLocal`/`skipped` totals; apply writes exactly the `imported` and `merged` rows, re-finding the existing same-campaign save at apply time — if it vanished since preview, the entry is imported as new. The save manager shows the plan with per-campaign reasons and diff hints and only calls apply on explicit Apply — the same confirm-gate UX as the overwrite/restore previews.

> **Split note:** this merge rule and the remote sync backend below are independent contracts that originally shipped together in a single commit (`49d3890`); each is documented separately here so it can be read and versioned on its own.

## Remote sync backend (third storage)

`RemoteBundleStorage` (`src/ui/remote-save-storage.ts`) is a third `SaveStorage` backend that keeps every named save behind a server endpoint instead of browser keys. It wraps any local `SaveStorage` (localStorage by default), serves all five `SaveStorage` methods synchronously from the wrapped storage, and reconciles that storage with the server through bundle snapshots:

- `GET {endpoint}` → `200 { schema: "asw91-campaign-save-bundle-v1", revision, bundle }`, or `404` when nothing has been synced yet (an empty remote).
- `PUT {endpoint}` → body `{ schema, expectedRevision, force?, bundle }` → `200 { revision }`, or `409` with the server's current revision when `expectedRevision` no longer matches the server's (compare-and-set). An empty server's expected revision is `null`; `force: true` bypasses the check (used by explicit force push).

Conflict detection is deterministic and never clobbers. Each side tracks a content fingerprint (`fnv1a32` over `{ schema, saves }` — the export timestamp is excluded, so the fingerprint is stable across exports) and the last-seen server revision, stored under `asw91-campaign-sync-meta-v1` inside the wrapped storage. `sync()`:

- pushes when only the local side changed since the last sync (compare-and-set against the last revision);
- pulls when only the remote side changed (replacing the local named-save set with exactly the remote snapshot, so remote deletions propagate);
- returns `conflict` without touching either side when both changed since the last sync, when a compare-and-set push is rejected (a concurrent writer), or when a first sync meets a populated server next to local data;
- adopts the remote on a first sync when the local device has no named saves (nothing local to lose);
- reports `up-to-date` when neither side changed.

`forcePush` (keep local) and `forcePull` (take remote) resolve a conflict explicitly. The endpoint contract is deliberately minimal and transport-agnostic; the HTTP client is injectable (`HttpClient`), with `defaultHttpClient()` using `globalThis.fetch` for real deployments.

**Auth token (optional).** `RemoteBundleStorage` accepts an `authToken` option (and the sync panel exposes a password field for it). When set, every outbound `GET`/`PUT` carries `Authorization: Bearer <token>` — the header is attached by the backend before the (possibly injected) `HttpClient` sees the request, so tests can assert it without a network and `defaultHttpClient()` forwards it to the wire. The token is **kept in memory for the session only** — the app never writes it to localStorage with the endpoint, so the credential is not persisted on disk. An endpoint that requires credentials returns `401` without it; the backend surfaces that as a failed sync (`Remote sync failed: ...`).

**Scheduled auto-sync (optional).** The sync panel has an **Auto-sync** toggle (off by default, preference persisted in localStorage like the endpoint). When enabled, the app reconciles the named-save bundle in the background every 60 seconds via `sync()` — enabling it fires one sync immediately so the panel gives instant feedback, and the loop never overlaps itself (a tick is skipped while a previous sync is still in flight). Auto-sync is deliberately conservative: it never touches either side on a conflict (it just surfaces the conflict status and the force push/pull choice), and a failure is reported in the panel as `Auto-sync failed: ...` without stopping the loop. Results surface in the same status line as manual syncs, prefixed `Auto-sync:`; the `sync-baseline` line keeps updating from the sync meta. The loop is driven by `createAutoSyncTimer` (`src/ui/auto-sync.ts`), a DOM-free timer unit-tested with fake timers (`tests/auto-sync.test.ts`).

### Mock server usage

`scripts/mock-save-sync-server.mjs` is an in-repo endpoint implementing the exact wire contract above, so local tooling and the browser QA gate can exercise a real sync / conflict / force flow end to end without standing up a service:

- **Standalone:** `npm run mock:sync-server` (or `node scripts/mock-save-sync-server.mjs [--port N] [--seed-bundle <path>] [--auth-token <token>]`) listens on `127.0.0.1` (default port **4174**) and prints the endpoint; the path is always `/saves`. It answers the CORS preflight (`OPTIONS` → `204`, allowing the `authorization` header) so a browser page can call it cross-origin. `--seed-bundle <path>` loads an `asw91-campaign-save-bundle-v1` JSON document into the server at startup (served at revision 1), so a fresh client with no local saves immediately pulls it and a client with its own saves immediately meets a conflict — no first-sync push needed for manual pull/conflict testing. `--auth-token <token>` requires `Authorization: Bearer <token>` on every `GET`/`PUT` (`401` otherwise), so the sync panel's auth field can be exercised end to end against a credentials-requiring endpoint.
- **Embedded:** `const mock = await createMockSaveSyncServer()` binds an ephemeral port and returns `{ endpoint, state, putForce, close }`. `mock.state` exposes the server's `revision`/`bundle`; `mock.putForce(bundle)` simulates a concurrent writer by force-accepting a bundle and bumping the revision, so the next `sync()` sees a remote that advanced behind the app's back.
- **QA gate:** the visual QA gate starts the mock server and drives the full arc — first-sync push, a simulated concurrent write, `Sync` reporting conflict, `Force push` resolving it, a re-diverged remote, and `Force pull` — asserting the status classes and the last-synced baseline line.
- **Standalone E2E suite:** `tests/mock-save-sync-server.test.ts` pins the wire contract — GET `404`-when-empty, compare-and-set `PUT`, `409` on stale `expectedRevision`, CORS preflight, `401` on a protected endpoint without the configured bearer token, and the full `RemoteBundleStorage` lifecycle against the running server.

### Worked wire-protocol example

One named save (`Career QA checkpoint`) on two devices syncing against a mock server at `http://127.0.0.1:4174/saves`. Revisions are opaque strings; an empty server's expected revision is `null`. The bundle fingerprint is the canonical `fnv1a32` over `{ schema, saves }` (`F(x)` below).

1. **Device A first sync** — `GET` → `404 { "error": "not found" }` (empty remote); local has the save, so it pushes:
   `PUT { schema: "asw91-campaign-save-bundle-v1", expectedRevision: null, force: false, bundle }` → `200 { "revision": "1" }`.
   Baseline: fingerprint `F(A)`, revision `"1"`; status `pushed`.
2. **Device B, fresh device** — `GET` → `200 { schema, revision: "1", bundle }`; no local saves and no baseline → adopts the remote without a `PUT`.
   Baseline: `F(A)`, `"1"`; status `pulled`.
3. **Device B edits** — `GET` → `200` revision `"1"` (matches its baseline); local changed → compare-and-set:
   `PUT { expectedRevision: "1", force: false, bundle: F(B) }` → `200 { "revision": "2" }`.
   Baseline: `F(B)`, `"2"`; status `pushed`.
4. **Concurrent writer** — `mock.putForce(oldBundle)` force-accepts and bumps the server to revision `"3"` behind both devices' backs.
5. **Device A syncs with its own local edit** — `GET` → `200` revision `"3"` ≠ baseline `"2"`, and local changed → **conflict**: `sync()` reports `conflict` and **neither side is touched** (no `PUT`, no local write).
6. **Device A resolves with force push** — `PUT { expectedRevision: null, force: true, bundle: F(A') }` → `200 { "revision": "4" }`. Remote now carries A's saves; baseline `F(A')`, `"4"`.
   *(Choosing force pull instead would `GET` the `"3"` bundle and replace the local named-save set with it — baseline `F(remote)`, `"3"`.)*

A stale compare-and-set surfaces as the same conflict through a different channel: a push whose `expectedRevision` no longer matches returns `409 { "error": "conflict", currentRevision, bundle }`, which the backend turns into `SaveSyncConflictError` and reports as a `conflict` status — again without writing either side.

## Import rejection and migration policy

Import performs JSON parsing, envelope checks, campaign validation, registered migration, and post-migration revalidation. It rejects:

- corrupt or truncated JSON;
- non-object roots or missing required collections;
- unsupported schema versions;
- incompatible data-pack versions or data hashes;
- invalid roster/team/title/schedule/injury/event state;
- a migration that produces invalid state.

No save is silently recomputed under the current rules data. A future migration that changes representation must return visible notices, preserve semantic state and next PRNG outcome, and ship with before/after fixtures and continuation/replay tests. A rules change that alters dice consumption or semantic outcomes requires a new rules/data version and must not masquerade as a representation-only migration.

## Canonical identity

`serializeCampaign(state, false)` produces canonical key ordering. `verifyCampaignRoundTrip` requires the imported state to have the same campaign hash and canonical bytes. Undefined values follow JSON semantics: omitted in objects and `null` in arrays. Intent lookup and legality use canonical semantic equality so object-key order cannot invalidate a recovered input.

The `c14n-fnv1a64-v1:` hash is a deterministic identity/replay checksum, not a security signature. Archive/file integrity uses SHA-256 separately.

## Fixture evidence

| Fixture | Purpose |
|---|---|
| `example-career-save.json` | completed campaign and official compact match replay |
| `example-in-progress-save.json` | recoverable active match checkpoint |
| `example-match-replay.json` | developer-facing config/input/expected-hash contract |

Run `npm run fixtures:m5` to regenerate them from seed 51991 and `npm run fixtures:verify` to load, replay, recover, continue, and commit.
