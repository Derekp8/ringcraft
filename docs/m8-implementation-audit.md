# M8 implementation audit — Accessibility and Acceptance Hardening

## Verdict

M8 accessibility and acceptance hardening is implemented on top of M7. Native Playwright checks now cover accessible names, landmarks, headings, keyboard traversal, visible focus, dialog focus containment, live-region presence, and text-based status cues across all application surfaces.

No campaign rules, schema, data hash, PRNG behavior, fixtures, replays, or event-sourced campaign state were changed.

## Implemented surfaces

| Area | Evidence |
|---|---|
| Shared acceptance helpers | `scripts/visual-qa.mjs` checks names, landmarks/headings, full keyboard traversal, dialogs, live regions, event announcements, and non-color status |
| All-surface coverage | Exhibition, Creator, Progression, Career setup/dashboard, active match/recovery, onboarding, and Playtest panel profiles run the shared checks |
| Focus behavior | Full visible-control traversal requires contained, advancing, non-body, `:focus-visible` focus; onboarding checks wrapping, Escape, and return focus |
| Human review boundary | `docs/m8-accessibility-review-checklist.md` separates automated evidence from pending screen-reader, zoom, forced-colors, and keyboard-only review |

## Compatibility boundary

M8 introduced no new dependency, network behavior, telemetry, storage key, campaign field, schema version, or rules behavior. Existing M7 notes and report formats remain unchanged.

## Verification

- `npm.cmd run check`: 104/104 tests passed; TypeScript and Vite production build passed.
- `npm.cmd run fixtures:verify`: completed campaign, replay, and recovered continuation hashes verified unchanged.
- `npm.cmd run visual:qa`: passed all existing M7 profiles plus M8 native accessibility acceptance checks. Windows uses the installed Edge fallback when bundled Linux Chromium is unavailable.

## Remaining external gates

Human assistive-technology review, independent source transcription/adjudication, and playtest-led balance/pacing review remain external gates. Automated acceptance is not formal accessibility certification.
