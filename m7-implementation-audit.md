# M7 implementation audit — Playtest Readiness Kit

## Verdict

M7 playtest readiness is implemented on top of M6. It remains presentation-only and does not change campaign rules, schema, data hash, PRNG behavior, fixtures, replays, or event-sourced campaign state.

## Implemented surfaces

| Area | Evidence |
|---|---|
| Structured notes | `src/ui/playtest-panel.tsx` provides goal, friction tags, notes, local save/clear, and campaign binding |
| Deterministic report | `src/ui/playtest-presentation.ts` emits `asw91-playtest-report-v1` JSON with dossier, latest match, recent events, hashes, and notes |
| Fixture shortcuts | `src/ui/playtest-fixtures.ts` loads the existing completed and in-progress M5 fixtures through `importCampaignJson` |
| Career integration | Dashboard and active-match surfaces expose the playtest panel; setup exposes both fixture shortcuts with replacement safeguards |
| Accessibility | Explicit labels, friction-tag fieldset/legend, live status, keyboard controls, responsive panel styling, and existing a11y modes |
| QA tooling | Browser checks cover fixture loading, recovery panel, note entry, tag selection, local reload persistence, report download, narrow layout, and accessibility controls |

## Compatibility boundary

Notes use `asw91-project-ringcraft-playtest-notes-v1` in browser-local storage. Reports use `asw91-playtest-report-v1`. Neither is included in `CampaignState`, canonical serialization, event logs, replay inputs, or campaign hashes. Campaign JSON remains the exact reproduction artifact.

## Verification

- `npm.cmd run check`: 104/104 tests passed; TypeScript and Vite production build passed.
- `npm.cmd run fixtures:verify`: completed campaign, replay, and recovered continuation hashes verified unchanged.
- `npm.cmd run visual:qa`: passed playtest notes, report export, fixture shortcut, active recovery, M6, accessibility, narrow, and existing application profiles. Windows uses the installed Edge fallback when bundled Linux Chromium is unavailable.

## Remaining external gates

Human assistive-technology review and independent source transcription/adjudication remain external gates. The playtest-led balance/pacing evidence gate is closed by the M11 seeded playtest balance report (`fixtures/m11/playtest-balance-report-v1.json`), which extends the M7 report's deterministic-report lineage to a 336-match seeded batch with win-share, match-length, and finish-method analytics (see `docs/m11-implementation-audit.md`); human playtest sign-off on its findings remains an external human gate. M7 collects private evidence but does not transmit telemetry or alter rules.
