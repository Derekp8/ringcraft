# M6 private polish — design

Date: 2026-08-12
Project: Project Ringcraft 1.2.0 (M5 Freebuff handoff candidate)
Package: `asw91-player-vs-ai-vertical-slice`
Status: Approved design, pending implementation plan

## Purpose

Deliver the first M6/private-polish slice on top of the verified M5 candidate: onboarding, month-end and post-match summaries, blocked-action guidance, visual identity, accessibility review, and a local playtest dossier. The milestone is orientation and presentation around the already-verified Career loop.

## Hard boundary

All M6 work is **presentation-layer only**:

- No changes to `src/core/campaign.ts`, `src/core/campaign-rules.ts`, `src/core/campaign-serialization.ts`, `src/core/hash.ts`, or the pinned data-packs.
- No schema change: campaign saves stay `asw91-campaign-v1`; fixtures and replays remain byte-identical and hash-compatible.
- No PRNG use and no mutation of `CampaignState`. All new logic is pure derivation from existing state.
- No telemetry, no cloud, no accounts. Export is a local file download only.

## Approach

Modular presentation package (approved as approach A):

| File | Purpose |
|---|---|
| `src/ui/campaign-presentation.ts` | pure derivation functions (no React, no mutation, no PRNG) |
| `src/ui/panels.tsx` | React components that render derived results |
| `src/ui/App.tsx` | wiring only: tutorial mount, banners, dossier card, blocked-reason hints |
| `src/ui/styles.css` | theme tokens and new component/badge/banner/overlay styles |
| `tests/m6-pres.test.ts` | deterministic unit tests over the pure functions |
| `scripts/visual-qa.mjs` | new M6 profiles and automated accessibility checks |

## Pure functions (`campaign-presentation.ts`)

All functions take `CampaignState` (or a scheduled row / match) and return plain data.

### `buildPostMatchReport(campaign)`

For the most recently completed scheduled match with a result:

- Official summary and method (`scheduled.result.summary`, `result.method`).
- Player-relative outcome: win / loss / draw for the player's entrant.
- Opponent label and date.
- Title impact: defense, change, vacancy, or none.
- Ranking aftermath (rank movement vs prior table where available).
- Injuries laid in by the match.
- Sources: scheduled row, the last `commit-match-result` event detail lines, post-commit rankings and title history.

Returns `{ matchId, date, summary, method, playerOutcome, opponentLabel, titleImpact, rankingNotes, injuries, matchHash }` with empty-collection/none defaults rather than undefined holes.

### `buildMonthEndSummary(campaign)`

Latest finalized month for the player's division(s):

- Month label and finalized tables present.
- Player's entrant rank and movement vs the prior published table.
- Division headline items: title changes, strippings, defenses required vs completed.
- Injuries active at the close of that month.

Returns `{ month, playerRankMovement, headline: string[], injuries: string[] }`.

### `buildCareerDossier(campaign)`

Player-relative aggregate derived entirely from state:

- Match record: wins / losses / draws (player-entrant side of each completed scheduled match).
- Title wins, retained defenses, losses, and vacancies won by the player.
- WP awarded to the player by `commit-match-result` events; WP spent by `campaign-progression` events; current balance read from roster/team `careerWp`.
- Injury count and total weeks.
- Title-shot offers accepted / declined.
- Vacancy competitions entered and result.
- Helpers to render a deterministic JSON export string and a CSV export string.

Returns a plain object plus `toJson()` and `toCsv()` string builders. No side effects.

### `explainBlockedActions(campaign)`

Per-action map over the Career dashboard's primary actions:

- `accept-offer`, `advance-day`, `roll-title-shot`, `resolve-vacancy`, `play-due-match`, `spend-wp`.

Each returns `{ blocked: boolean; reasons: string[]; hint: string }` derived from state: active injuries, existing player booking, annual defense obligations, overdue titling, vacant titles, missing ranked contenders, already-applied results. Replaces generic placeholder text with concrete game-world reasons.

### `onboardingContent()`

Static guided-tour content with per-step relevance rules (a step may be skipped when its surface is not applicable, e.g. Career help shows once a career exists). Pure data; the tutorial component handles rendering and localStorage preference.

## UI components (`panels.tsx`)

### `TutorialOverlay`

- `role="dialog"`, `aria-modal`, labelled heading.
- Steps: Welcome, Exhibition, Creator, Progression, Career, Go play.
- Next / Back / Done, progress indicator, Esc closes, focus trap, return focus to the opener.
- Dismissal remembered under UI-only key `asw91-project-ringcraft-tutorial-v1` (a preference, never campaign state, so it cannot touch hashes).
- Re-opened from a persistent top-bar `?` button.

### `PostMatchReport`

- Card on the Career dashboard shown when the last committed event is a match commit.
- Sections: result/method, title impact, ranking aftermath, injuries, player outcome.
- Collapsible; `aria-live="polite"` announces on open.

### `MonthEndBanner`

- Banner when the newest finalized month differs from the last-seen month.
- Last-seen month tracked under UI-only key `asw91-project-ringcraft-monthnote-v1`.
- Shows the player's rank movement and division headline facts. Dismissible.

### `DossierPanel`

- Dashboard card rendering `buildCareerDossier`.
- Export JSON and Export CSV buttons using Blob downloads.

### `BlockedReason`

- Renders `explainBlockedActions` output for offer, advance, and spend areas.
- Replaces the one-line placeholder with specific reasons and hints.

## Styling (`styles.css`)

- "Ringcraft" visual identity: arena-navy base, gold accent, explicit result colors (win / loss / draw, title, injury).
- Refined type hierarchy with system font stacks, letter-spacing and weight contrast; no network fonts (stays offline).
- Consistent card / eyebrow / badge treatments.
- Onboarding overlay and banner styles.
- Interleaves with existing `a11y-large`, `a11y-contrast`, `a11y-reduced` classes; reduced motion disables tour and banner animation.

## Accessibility review

- Fix audit findings in current surfaces if discovered: focus order, missing labels, heading hierarchy.
- New components use proper ARIA: dialog/modality, focus trap, labelled regions, `aria-live`.
- Extend `scripts/visual-qa.mjs`: keyboard tab-order sanity on each surface, dialog focus and return-focus checks, no unlabeled interactive control checks, and new M6 screenshots (tutorial, dossier, month-end banner, blocked-reason card, narrow and a11y variants).
- A real screen-reader human pass remains an external gate (consistent with known-limitations).

## Testing (`tests/m6-pres.test.ts`)

Deterministic unit tests over the pure functions:

- Post-match report content built from a completed match in `fixtures/m5/example-career-save.json` (read-only).
- Month-end facts derived from the same fixtures.
- Dossier arithmetic: W/L/D, title counts, WP, injuries, shot offers, vacancies — cross-checked against known fixture values.
- Blocked-reason purity: double-booking, injury, defense obligation, vacant title cases produce correct non-empty reasons and hints; deterministic output.
- Export string determinism: JSON and CSV outputs are stable strings.

Constraints: `npm run check` remains the gate; all 84 existing tests keep passing; fixtures stay unchanged.

## Verification commands

```bash
npm run check
npm run fixtures:verify
npm run visual:qa
```

Plus the new `tests/m6-pres.test.ts` suite runs as part of `npm run check`.