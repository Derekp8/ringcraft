# Project Ringcraft — M13 verification-reconciled candidate

Project Ringcraft is a deterministic, rules-first private adaptation of the 1991 *All Star Wrestling* tabletop system. Version **1.2.0** contains the M5 career core, M6 private polish, M7 playtest tooling, M8 accessibility hardening, the M9 private-handoff workflow, and opt-in M10–M13 extensions.

This branch follows the August 20 structural repair and reconciles the mixed verification snapshots that were uploaded together. The canonical directory tree, deterministic fixtures, replay documents, automated tests, and browser QA now agree with the current source. It is still a review candidate—not a public release. Independent second-human table transcription, human accessibility review, and human playtest sign-off remain external QA gates.

## Clean install and run

Requirements: Node.js 24 (the verified runtime) or a current Node.js LTS release.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. The application areas are:

- **Exhibition:** retained singles/tag match setup and replay.
- **Creator:** seeded M4 wrestler creation and versioned wrestler export.
- **Progression:** retained full M4 advancement lab for QA.
- **Career:** solo/persistent-team setup, batch reference-roster import, match offers and scouting, scheduling, titles, ratings, injuries, automatic progression awards, manual WP spending, saves, recovery, and campaign logs.

## Verify

```bash
npm run check
npm run fixtures:verify
npm run visual:qa
```

The reconciled tree discovers **460 tests across 28 files**, all passing. `docs/repository-structure-repair.md` preserves the original structural-repair findings; `docs/verification-evidence-reconciliation.md` records the follow-up diagnosis and measured verification results.

The following gates pass on the reconciliation branch:

- `npm ci` — 74 locked packages installed without changing `package-lock.json`.
- `npm run typecheck` — both emit-free project checks and `tsc -b` pass.
- `npm run build` — 45 modules compile into a production Vite bundle.

`npm run fixtures:verify` re-derives the M5 campaign fixtures, the 1,058-decision M10 corpus (`35dd5b20`), the M10 campaign, M11 match/playtest/trend fixtures, save-manager fixture, and all replay documents with zero drift. The current ruthless seed-1991 replay pins `c14n-fnv1a64-v1:03e0fea1cb9c5be1`; the tag replay remains `c14n-fnv1a64-v1:1b26c32a342f08c8`. `npm run visual:qa` passes all 22 reviewed browser captures.

To regenerate the included deterministic examples:

```bash
npm run fixtures:m5
npm run fixtures:verify
```

## Pre-commit typecheck hook

A zero-dependency pre-commit hook (`.githooks/pre-commit`) runs the same
typecheck passes that `npm run check` and CI run — the per-project emit-free
pass and the build-mode `tsc -b` — so build-only type errors fail the commit
instead of the pipeline. It skips when no `.ts`/`.tsx` file is staged
(docs/PNG/JSON-only commits stay fast). Activate once per clone:

```bash
git config core.hooksPath "$(git rev-parse --show-prefix).githooks"
```

The hook is a plain shell script (no husky/lint-staged), so `npm ci` never runs
an install lifecycle; `.gitattributes` forces its LF checkout so the shebang
survives `core.autocrlf`.

## Career saves and recovery

The Career surface autosaves every accepted campaign transaction and supported match checkpoint. Named save files are managed from the Career dashboard and the Resume/import card:

- `asw91-project-ringcraft-autosave-v1-<timestamp>` — versioned autosave snapshots (the newest `N` = 5 are kept, each with a timestamp and campaign hash; the **Autosave history** list on the dashboard restores any kept snapshot). The legacy `asw91-project-ringcraft-autosave-v1` single key is read as a fallback and migrated on the first versioned write;
- `asw91-campaign-save-<id>` — named save files with timestamps, live previews, and duplicate/rename/delete/update-in-place controls (Update shows an overwrite preview diffing the stored snapshot against the live campaign — date, record, WP, titles, injuries, bookings, champions, event count — mirroring what restoring the save instead would change, then refreshes the save at its current name). Legacy `asw91-campaign-slot-1` through `asw91-campaign-slot-3` keys are migrated into named saves on first load.

**Export save bundle** downloads every named save as one portable `asw91-campaign-save-bundle-v1` JSON document; **Import save bundle** restores all of them into any browser. The bundle round-trips named saves byte-identically and is schema-checked, so it doubles as the cross-browser backup format for the whole save manager (valid entries are restored; invalid ones are counted and skipped, never recomputed). Import also **merges by campaign identity**: a save whose `campaignId` already exists is never duplicated — the strictly newer `updatedAt` wins and is written in place, keeping the existing save's key/name/createdAt. `BundleStorage` is the same storage contract backed by one bundle string instead of many localStorage keys, and `RemoteBundleStorage` is a third backend that syncs the bundle to a configurable server endpoint with deterministic compare-and-set conflict detection (`sync` pushes/pulls/reports conflict; `forcePush`/`forcePull` resolve) — see `docs/save-schema-and-migration.md`.

Browser storage location and quota are browser/profile specific. Use **Export campaign JSON** as the durable backup and handoff format. **Import campaign JSON** validates the schema, pinned data pack/hash, rules version, roster, schedule, ordered events, in-progress match, PRNG state, and canonical identity before replacing the autosave. Replacing the active campaign, deleting a save, and loading over the current campaign require confirmation.

The initial campaign schema is `asw91-campaign-v1`. No earlier campaign schema exists, so the migration registry currently contains a validated v1 identity migration. Existing `asw91-wrestler-v1` and `asw91-reference-roster-v1` inputs remain supported for new careers. Incompatible, corrupt, truncated, unsupported, or data-hash-mismatched campaign files are rejected; they are never silently recomputed under current data.

## M5 implemented scope

- Immutable `classic-1991-m5-v1` campaign rules data for ratings, prior-rank bonuses, title hierarchy/shot dice/modifiers, Fame/WP mappings, monthly `ceil(1D6/2)` defenses, and 30-day obligations.
- Stable seeded campaign, entrant, team, title, schedule, vacancy, injury, and event identity.
- Explicit atomic date advancement, defense-date reservation, availability/double-booking validation, match configuration, checkpointing, and exactly-once result commit.
- Monthly singles/tag rating tables with recorded RP, previous rank, WP, D6 tiebreaks, champion guarantees, history, and post-commit reset.
- D10 singles and D6 tag title-shot traversal, prior-shot state, accept/decline, mandatory defenses, extra-shot gate, retentions/changes, higher-title vacancy, stripping, and configured ranked-contender or four-seed tournament vacancy resolution.
- Persistent two-person teams with stable membership, individual records/injuries/Fame, team history and rating state, and full per-member WP awards using the M4 team-average comparison.
- Critical Hold 99/100 campaign layoffs inherited from the full match engine, exact return dates, eligibility blocking, and title-obligation interaction. Exhibition injury state remains match-local; Old Injury remains a drawback.
- Optional post-match injury checks (`d20-check` campaign option): beaten-down or knocked-out participants roll a recorded D20 after each committed match; 1 = broken extremity (1D6 weeks), 2-3 = sprain (ceil(1D6/2) weeks). Independently versioned (`classic-1991-post-match-injury-v1`), off by default, and documented as an adjudicated extension in the register rather than a source transcription.
- Player and headless non-player matches both use the existing full deterministic engine. The headless policy chooses only among enumerated legal visible-state actions and stores its input log for replay.
- Versioned local saves, autosave plus a named save manager (timestamps, previews, duplicate/rename/delete/update-in-place, plus a single-bundle export/import backend for all named saves), canonical JSON round trips, explicit import rejection, compact match replays, and phase-boundary recovery.

## M6 implemented scope

- Pure presentation derivations for official post-match reports, month-end summaries, career dossiers, and blocked-action explanations.
- Guided onboarding with keyboard navigation, Escape dismissal, focus containment, return-focus behavior, and a local dismissal preference.
- Career dashboard report cards for post-match results, month-end rank movement, dossier totals, deterministic JSON/CSV dossier export, and corrective blocked-action guidance.
- Arena-navy/gold visual identity with responsive layouts, large-text/high-contrast/reduced-motion modes, semantic status labels, and labeled controls.
- M6 presentation tests and browser profiles preserve the campaign schema, rules version, data hash, event log, PRNG state, and replay hashes.

## M7 implemented scope

- Structured local playtest notes with session goal, friction tags, free-text notes, campaign binding, local persistence, and clear controls.
- Deterministic `asw91-playtest-report-v1` JSON reports containing campaign identity/hash, dossier summary, latest match summary, bounded recent events, and tester notes.
- Read-only shortcuts for the completed and in-progress M5 fixture saves, using the existing campaign import validation path and replacement safeguards.
- Active-match and Career-dashboard playtest panels with responsive and accessibility coverage; no telemetry, network calls, accounts, or cloud persistence.

## M8 implemented scope

- Shared native Playwright acceptance helpers for accessible names, landmarks/headings, keyboard traversal, visible focus, dialog focus behavior, live regions, and text-based statuses.
- All-surface coverage across Exhibition, Creator, Progression, Career setup/dashboard, active match/recovery, onboarding, and Playtest panels.
- Human review checklist documenting keyboard-only, screen-reader, zoom/reflow, forced-colors, reduced-motion, and focus-restoration checks that automation cannot certify.

## M9 implemented scope

- Deterministic allowlisted archive builder for `asw91-project-ringcraft-m9-private-handoff-1.2.0.zip`.
- Clean-room archive verifier for install, tests, build, fixture hashes, and browser QA, with explicit Windows Edge versus Linux Chromium evidence.
- External machine-readable build/verification evidence and handoff documentation; local state and generated runtimes remain excluded.

## M10 implemented scope

- Four-step AI difficulty ladder (`asw91-ai-policy-v1`): `novice` (seeded mistake injection), `standard` (v1 greedy, byte-identical to the pre-M10 policy, zero RNG consumed), `veteran` (1-ply lookahead over a pure positional evaluation), and `ruthless` (2-ply modeling the opponent's response) within a fixed ≤ 40-clone node budget.
- Difficulty is stored per match configuration (`aiDifficulty`) and per campaign, flows through scheduling, `createMatch`, saves, and replays, and is a visible labeled setting in Exhibition and Career setup plus a dashboard label — never a hidden modifier.
- Bounded search dry-run helper `resolveDecisionOnce` (discarded clones, copied RNG) with search-scoped event hashing skipped so lookahead stays cheap; search clones never mutate live state or the dice stream.
- The current M10 corpus contains 1,058 decisions across all 12 decision kinds and replays with fixture hash `35dd5b20`. Historical M9–M11 audit records retain their original older snapshot identities and are not current verification claims.

## M11 implemented scope

- Optional singles cage and ladder varieties with deterministic escape/retrieval finishes, replay fixtures, and seeded balance/trend reports.
- A private playtest dashboard presents the pinned M11 report without changing campaign or match state.

## M12 implemented scope

- Opt-in contracts and finance, popularity, chemistry, contract negotiation, and curve-fair renewal policies.
- Extension-off campaigns omit the M12 fields; the documented intent is to preserve the core campaign identity when these systems are disabled.

## M13 implemented scope

- Opt-in feud heat, title-shot terms, and month-end booking suggestions, including deterministic title-shot and feud-chain replay evidence.
- Singles and tag feud setup is exposed in Career; suggestions remain advisory and do not auto-schedule matches.

## Architecture

`src/core` remains presentation-independent. React renders core state and submits intents; it does not calculate rankings, title eligibility, defense obligations, injuries, WP/Fame, save compatibility, or match outcomes.

- `campaign-rules.ts` — immutable M5 tables, title definitions, versions, and data hash.
- `campaign.ts` — event-sourced career transactions, scheduling, rankings, titles, injuries, AI/headless play, progression integration, and validation.
- `campaign-serialization.ts` — save validation, migration registry, import/export, and canonical round-trip verification.
- `career-rules.ts`, `creation.ts`, `progression.ts`, `serialization.ts` — retained M4 data/creation/progression/record boundaries.
- `engine.ts`, `validator.ts`, `ai.ts` — shared full match resolution, shared legality, and the M10 difficulty ladder / bounded lookahead (`asw91-ai-policy-v1`).
- `hash.ts`, `prng.ts` — canonical identity and recorded seeded dice.
- `src/ui/App.tsx` — exhibition, creator, progression, career, recovery, logs, M6/M7 panels, and accessibility controls.
- `src/ui/campaign-presentation.ts` — pure campaign-derived presentation data; it does not mutate campaign state or consume PRNG values.
- `src/ui/panels.tsx` — onboarding, report, month-end, dossier, and blocked-action panels.
- `src/ui/playtest-presentation.ts` — pure playtest note normalization and deterministic report derivation.
- `src/ui/playtest-fixtures.ts` — validated shortcuts for the existing M5 fixture saves.
- `src/ui/playtest-panel.tsx` — local notes, friction tags, status, and report export controls.
- `docs/m8-accessibility-review-checklist.md` — automated versus human accessibility review boundary.
- `scripts/m9-packaging-contracts.ts` — deterministic archive allowlist and exclusion contracts.
- `scripts/build-m9-handoff.mjs` — clean allowlisted archive entrypoint.
- `scripts/verify-m9-handoff.mjs` — clean-room extraction and verification entrypoint.
- `tests/` — 28 discovered suites spanning the retained core, career, presentation, packaging, AI, match varieties, save/sync, finance, negotiation, and feud/booking work.
- `fixtures/m5/` — completed save, in-progress save, compact replay, and orientation notes.
- `fixtures/m10/`, `fixtures/m11/`, `fixtures/saves/`, `fixtures/replays/` — deterministic AI, match-variety, playtest, persistence, and replay evidence.
- `scripts/` — visual QA, fixture generation, clean-room packaging, and fixture/replay verification.

## Twelve-month correctness gate

Two deterministic scripted careers ran for 365 days each with a save/reload checkpoint at every month boundary:

| Career | Full-engine matches/replays | Title changes | Stripping events | Ranking tables | Monthly reloads | Final hash |
|---|---:|---:|---:|---:|---:|---|
| Solo | 28/28 | 3 | 5 | 24 | 12 | `c14n-fnv1a64-v1:af6ff3ca602fc41a` |
| Tag | 49/49 | 3 | 4 | 24 | 12 | `c14n-fnv1a64-v1:a4635a8085b77a8c` |

Across 730 calendar days, all 77 completed matches replayed identically and all 24 monthly save/reload checkpoints preserved canonical state. These runs establish correctness and reachability, not balance or pacing.

## Troubleshooting

- **`npm ci` fails:** confirm Node/npm can access the npm registry and that `package-lock.json` was not changed. Do not substitute an updated lockfile during verification.
- **Visual QA cannot launch Chromium:** run on Linux x64 with enough temporary disk space; the script expands its pinned serverless Chromium payload under `output/qa/`, which is intentionally excluded from the handoff ZIP except for reviewed screenshots.
- **Campaign import rejected:** preserve the error text. Check `schemaVersion`, `dataPackVersion`, and `dataHash`; do not edit or strip event/PRNG fields to force a load.
- **No match can be scheduled:** review current injuries, existing bookings, and championship obligations in Career. Block reasons are emitted by the core transaction and shown in the event/message surface.
- **Browser save unavailable after profile cleanup:** import the last exported campaign JSON. Browser-local slots cannot survive deletion of the browser profile.

## Boundaries

- No configured production cloud service, accounts, telemetry, installers, platform certification, public branding, or commercial-release work. Remote save synchronization is an opt-in client/backend contract with no production endpoint configured.
- Match play remains singles and two-person tag. Three-plus-wrestler matches, battle royals, managers, weapons, promos, booking grades, and GM mode remain out of scope.
- M10 uses a bounded four-level policy through two-ply lookahead. M11–M13 add optional digital extensions for match varieties, contracts/finance, and feuds/booking; they are not transcriptions of the 1991 source rules.
- FNV-1a 64-bit canonical hashes are deterministic identity/replay checks, not adversarial security primitives.
- Independent source-table transcription and adjudication sign-off remain pending. The manual and audited GDD named in the historical M9 manifest are not present in the uploaded GitHub repository and must be restored from the authorized source package before an M9 archive can be rebuilt.

See `FREEBUFF-HANDOFF.md`, `docs/m5-implementation-audit.md`, `docs/m6-implementation-audit.md`, `docs/m7-implementation-audit.md`, `docs/m8-implementation-audit.md`, `docs/m8-accessibility-review-checklist.md`, `docs/m5-traceability-matrix.md`, `docs/save-schema-and-migration.md`, `docs/adjudication-register.md`, and `docs/known-limitations.md` for the full handoff record.
