# M6 implementation audit — Private Polish

## Verdict

M6 private polish is implemented on top of the verified M5 candidate. The work is presentation-only: campaign rules, campaign serialization, schema version, data pack/hash, PRNG state, event sourcing, and replay inputs remain unchanged.

## Implemented surfaces

| Area | Evidence |
|---|---|
| Onboarding | `src/ui/panels.tsx` `TutorialOverlay`, local dismissal key, keyboard navigation, Escape dismissal, focus containment, and return-focus behavior |
| Post-match summary | `buildPostMatchReport` and `PostMatchReport`, including result method, player outcome, ranking note, title impact, injuries, WP, and replay hash |
| Month-end summary | `buildMonthEndSummary` and `MonthEndBanner`, including rank movement, title notes, injury notes, and local dismissal |
| Blocked-action guidance | `explainBlockedActions` and `BlockedGuidance`, covering offers, calendar advancement, title shots, vacancies, due matches, and WP spending |
| Career dossier | `buildCareerDossier` and `DossierPanel`, with deterministic JSON and CSV exports |
| Accessibility and identity | Arena-navy/gold presentation, responsive layout, large text, high contrast, reduced motion, semantic status labels, and labeled interactive controls |
| QA tooling | M6 visual profiles for the tour, help toggle, dashboard panels, post-match report, narrow layout, and accessibility checks |

## Compatibility boundary

The M6 layer does not import or call campaign mutation functions from its derivation module, does not consume PRNG values, and does not write to `CampaignState`. UI preferences use only `localStorage` keys `asw91-project-ringcraft-tutorial-v1` and `asw91-project-ringcraft-monthnote-v1`. Existing fixture hashes and campaign continuation remain unchanged.

## Verification

- `npm.cmd run check`: 96/96 tests passed; TypeScript and Vite production build passed.
- `npm.cmd run fixtures:verify`: verified completed campaign, replay hash, and recovered continuation.
- `npm.cmd run visual:qa`: passed exhibition, creator, progression, career setup/dashboard/match/recovery/post-match, tour, help-toggle, Rules Lab, narrow, and accessibility profiles. Windows uses the installed Edge fallback when the bundled Linux Chromium payload is unavailable.

## Remaining external gates

Automated accessibility checks do not replace human assistive-technology review. Independent second-human source transcription and adjudication remain the principal correctness gate. Playtest balance and pacing observations must remain separate from rules changes.
