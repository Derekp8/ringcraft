# M4 creation and progression implementation audit

## Verdict

The package is a runnable **M0–M4 implementation candidate**. A user can create and finalize a legal wrestler, export/reimport it without loss, select created records in singles or temporary tag teams, replay those matches identically, award and spend WP through atomic transactions, and use the progressed record in another match. M0–M3 behavior remains covered by the retained regression and simulation suite.

This is not formal M0–M4 acceptance. Independent second-human transcription/adjudication sign-off and rights clearance remain unresolved external gates.

## Implemented

- Complete versioned M4 rules data for creation/history, skills, drawbacks, Title Fame, progression, and custom maneuver construction.
- Seeded creator with transaction inputs, ordered dice, equations, before/after hashes, complete validation, exact-spend allocation, finalization, and deterministic replay.
- Source-faithful Hold/Strike builder and carried custom definitions.
- Versioned wrestler/reference-roster JSON with detailed rejection errors.
- Injected dynamic roster and match-local custom maneuver catalog; original fixtures retained.
- Atomic WP/Fame/upgrade/drawback transactions with complete record revalidation and deterministic replay.
- End-to-end exhibition, creator, progression, import/export, accessibility, and responsive UI.

## Verification snapshot

Run on 2026-08-09:

- `npm run check`: **61/61 tests passed**; TypeScript and production Vite build passed.
- Retained two-minute batch: 50 singles and 50 tag matches completed at the configured time-limit draw; all 100 replays matched final canonical hashes.
- Retained ten-minute aggressive smoke: singles produced 6 pins and 4 time-limit draws; tag produced 5 pins and 5 time-limit draws; all 20 replays matched.
- M4 property/adversarial coverage: 48 creation seeds finalized legally; every eighth seed was additionally serialized, imported, injected into a match, and replay-checked.
- `npm run visual:qa`: exhibition singles/tag desktop, tag narrow, accessibility options, Rules Lab, creator desktop/narrow, and progression passed with no runtime console error, horizontal overflow, or missing required surface.

These simulations validate deterministic correctness and reachability, not balance or pacing.

## Defects found and corrected during M4 QA

1. Match hashing initially serialized the full dynamic roster and 102-row maneuver catalog on every event, making the retained simulation gate impractically slow. The selected static data is now committed once in `dataHash`; state hashes serialize only dynamic state and runtime configuration. Replay identity remains covered across all simulations and created matches.
2. Progressed record import initially compared debut total against current attributes. It now compares against immutable creation attributes so a legal attribute upgrade remains importable.
3. Progression initially depended on the current POW when valuing an old Egotist drawback. It now uses immutable creation POW, preventing later POW purchases from retroactively changing removal cost.
4. Creation/progression traces initially exposed formulas and hashes but did not retain every non-random input. Creation events now store input payloads and progression events store full intents; both flows have replay functions and identity tests.
5. The pinned Chromium extractor attempted ownership changes unsupported by the managed filesystem. Visual QA now performs portable no-chown extraction and uses system fontconfig; the full browser gate passes.

## Compatibility and drift

- Rules version advanced from the M0–M3 `1.0` candidate to `1.1.0-m4-candidate` because match configuration, hashes, roster identity, and records gained M4 schema.
- Package version is `1.1.0`.
- Original fixture definitions and M0–M3 dice/resolution semantics were preserved. Retained simulations report the same semantic outcomes as the 1.0 audit.
- Record schema is `asw91-wrestler-v1`; reference roster schema is `asw91-reference-roster-v1`.

## Milestone boundary

M4 is implemented and verified as a software candidate. M5 campaign systems and persistence, M6 release/platform work, independent transcription, adjudication sign-off, and rights clearance are not included. See the traceability, adjudication, and known-limitations records for the exact boundary.
