# Project Ringcraft 1.2.0 — M9 private-handoff candidate

## Milestone verdict

M5 — Career and Persistence, M6 — Private Polish, M7 — Playtest Readiness, and M8 — Accessibility and Acceptance Hardening are implemented as a private candidate on top of the verified M0–M4 architecture. M9 adds a deterministic allowlisted archive builder, clean-room verifier, and external evidence record. The rules core, campaign schema, data hash, fixtures, replays, full-engine twelve-month careers, production build, and browser visual QA pass. This package is not described as release-ready or formally source-perfect because independent second-human transcription and adjudication sign-off remain outstanding.

## Setup and verification

Verified runtime: Node.js 24.14.0 with the included npm lockfile.

```bash
npm ci
npm run check
npm run fixtures:verify
npm run visual:qa
```

Developer run:

```bash
npm run dev
```

Do not regenerate or update `package-lock.json` during acceptance. `npm run fixtures:m5` intentionally regenerates the three deterministic files under `fixtures/m5/`; it is not needed for normal verification.

## Architecture and folder map

| Path | Purpose |
|---|---|
| `src/core/campaign-rules.ts` | immutable M5 rules/version/data hash |
| `src/core/campaign.ts` | event-sourced career transactions, full-engine integration, rankings/titles/injuries/teams |
| `src/core/campaign-serialization.ts` | v1 validation, migration registry, canonical import/export |
| `src/core/` retained modules | M0–M4 rules, legality, creation, progression, engine, replay, PRNG |
| `src/ui/App.tsx` | labs, playable Career surface, and M6/M7/M8 presentation panels |
| `src/ui/campaign-presentation.ts` | pure M6 campaign-derived presentation data |
| `src/ui/panels.tsx` | M6 onboarding, report, month-end, dossier, and guidance panels |
| `src/ui/playtest-presentation.ts` | pure M7 notes/report derivations |
| `src/ui/playtest-fixtures.ts` | validated M5 fixture shortcuts |
| `src/ui/playtest-panel.tsx` | M7 local notes and report export panel |
| `scripts/m9-packaging-contracts.ts` | deterministic archive allowlist and exclusion contracts |
| `scripts/build-m9-handoff.mjs` | clean allowlisted archive entrypoint |
| `scripts/verify-m9-handoff.mjs` | clean-room extraction and verification entrypoint |
| `tests/` | 61 retained tests, 23 M5 tests, 12 M6 tests, 8 M7 tests, and 4 M9 tests |
| `fixtures/m5/` | completed save, in-progress save, compact replay |
| `scripts/` | visual QA and fixture generation/continuation verification |
| `output/qa/` | reviewed representative screenshots only in the handoff package |
| `docs/` | milestone audits, traceability, adjudications, limitations, save policy |
| `reference/` | supplied 1991 manual and audited GDD |

React submits intents and renders core state. It does not calculate campaign legality or outcomes. All accepted career mutations pass through atomic clone/validate/commit transactions with intent/inputs, dice, explanations/formulas, pre-state hash, and post-state hash. Player and headless matches share the retained deterministic match engine and legal-action enumeration.

## Status table

| Area | Status | Evidence / note |
|---|---|---|
| M0–M4 regressions | Verified | 61 retained tests pass |
| M5 rules/schema/core | Implemented and verified | 23 focused tests, traceability matrix |
| Solo and persistent two-person team careers | Implemented and verified | UI paths plus 365-day campaigns |
| Ratings/title/defense/vacancy/injury loops | Implemented and verified | exact data tests, forced injury, stripping and title changes |
| Player and headless full-engine matches | Implemented and verified | exactly-once commit and 77/77 long-run replays |
| Save/reload/export/import/recovery | Implemented and verified | initial v1 migration, fixtures, canonical round trip |
| Browser and accessibility profiles | Verified candidate coverage | automated desktop/narrow/accessibility/recovery QA |
| Independent source transcription/adjudication | Unavailable external step | explicitly pending; no acceptance claim |
| M6 private polish | Implemented and verified | presentation-only layer; M6 audit |
| M7 playtest readiness | Implemented and verified | local notes, report export, fixture shortcuts; M7 audit |
| M8 accessibility hardening | Implemented and verified | native keyboard/semantic acceptance checks; M8 audit/checklist |
| M9 private handoff | Implemented and locally verified | allowlisted archive, clean-room verifier, external evidence |
| Cloud/accounts/public release/commercial work | Out of scope | private project boundary |

## Exact verification record

- Automated tests: **108/108 passed** across six files in the final M9 local gate.
- Build: TypeScript and Vite 8.2.1 passed; 32 transformed modules; application JavaScript 385.65 kB (114.38 kB gzip).
- Long campaigns: 730 days, 77 completed full-engine matches, 77 replay checks, 24 monthly save/reload checkpoints, 48 historical ranking tables, six title changes, and nine stripping events.
- Solo: 28 matches, 28 replays, three title changes, five stripping events; final `c14n-fnv1a64-v1:af6ff3ca602fc41a`.
- Tag: 49 matches, 49 replays, three title changes, four stripping events; final `c14n-fnv1a64-v1:a4635a8085b77a8c`.
- Fixture continuation: completed match `c14n-fnv1a64-v1:b5cc3ccccd2e25ee`; recovered/continued campaign `c14n-fnv1a64-v1:bd2c470ca5bf286a`.
- Visual QA: exhibition, creator, progression, career setup/dashboard/offer/match/recovery/post-match, onboarding tour, help-toggle, playtest notes/report export, fixture shortcuts, native M8 keyboard/semantic checks, Rules Lab, desktop, 390-pixel narrow, large text, high contrast, reduced motion, and accessibility profiles passed.
- M9 verification: `npm ci`, 108/108 tests, production build, fixture recovery, and visual QA passed in the clean-room extraction; this Windows host used the Edge fallback, while Linux portable Chromium remains the canonical browser target.

These simulations establish correctness and reachability, not balance or pacing.

## Save, schema, data, hash, and replay compatibility

| Boundary | Version / policy |
|---|---|
| Package | `1.2.0` |
| Campaign save | `asw91-campaign-v1` (initial boundary) |
| Wrestler input | `asw91-wrestler-v1` |
| Reference-roster input | `asw91-reference-roster-v1` |
| M5 data pack | `classic-1991-m5-v1` |
| Campaign rules candidate | `1.2.0-m5-candidate` |
| Canonical identity | `c14n-fnv1a64-v1` |
| File/archive integrity | SHA-256 |

Campaign imports pin schema, rules, data pack/hash, roster, teams, titles, schedule, injuries, rankings, events, active match, and PRNG state. Unsupported/corrupt/truncated/mismatched files are rejected. No data is silently recomputed under a newer pack. Completed replay storage is the original match configuration plus ordered inputs and expected final hash; `npm run fixtures:verify` proves replay and checkpoint continuation.

## Defects and limitations

All implementation defects found during M5–M8 were corrected and received regressions. M9 packaging contracts and clean-room verification are also covered. No known open defect blocks the included flow.

Known candidate limitations include browser-local persistence, three numeric save slots, two-person tag only, heuristic (not deep-search) AI, free-text event filtering with 30 rendered rows, and automated rather than human assistive-technology QA. Independent source transcription/adjudication remains the principal external correctness risk. See `docs/known-limitations.md`.

## Remaining external gates

Preserve the campaign schema/data hash until a deliberately versioned migration exists. Human assistive-technology review, independent source transcription/adjudication, private content production, localization, and playtest-led balance/pacing work remain open. Keep balance/pacing observations separate from rules changes and retain all deterministic tests/replays.

## Archive identity

Expected archive name: `asw91-project-ringcraft-m9-private-handoff-1.2.0.zip`.

The exact final ZIP byte size and SHA-256 are reported in the delivery response after the immutable archive is built and clean-room verified. A ZIP cannot contain its own final SHA-256 value: inserting that value changes the archive bytes and therefore changes the hash. `HANDOFF-MANIFEST.json` instead pins SHA-256 for critical payload files; the external delivery checksum pins the container.
