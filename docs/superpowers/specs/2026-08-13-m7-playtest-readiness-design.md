# M7 Playtest Readiness Kit — Design

**Project:** Project Ringcraft 1.2.0 M6 private-polish candidate  
**Status:** Approved design, implemented  
**Date:** 2026-08-13

## Goal

Make private playtesting easier to start, document, reproduce, and hand off without changing campaign rules or save compatibility.

M7 adds structured local notes, a deterministic playtest report export, and shortcuts for the existing completed and in-progress M5 fixture saves. It does not add telemetry, accounts, network calls, cloud persistence, new campaign scenarios, or balance changes.

## Compatibility Boundary

M7 must not modify:

- `src/core/campaign.ts`
- `src/core/campaign-rules.ts`
- `src/core/campaign-serialization.ts`
- `src/core/hash.ts`
- Campaign schema `asw91-campaign-v1`
- M5 rules/data versions, data hash, PRNG behavior, fixtures, or replay formats

Playtest notes are UI-only. They never enter `CampaignState`, campaign events, canonical serialization, or campaign hashes.

New UI-only identifiers:

- Local storage: `asw91-project-ringcraft-playtest-notes-v1`
- Report format: `asw91-playtest-report-v1`

## Architecture

### Pure Presentation Module

Add `src/ui/playtest-presentation.ts` with no browser storage or React dependencies.

It defines:

```ts
export const PLAYTEST_FRICTION_TAGS = [
  "unclear-next-step",
  "blocked-action",
  "match-pacing",
  "save-recovery",
  "accessibility",
  "visual-clarity",
  "other",
] as const;

export type PlaytestFrictionTag = (typeof PLAYTEST_FRICTION_TAGS)[number];

export interface PlaytestNotes {
  campaignId: string;
  goal: string;
  tags: PlaytestFrictionTag[];
  notes: string;
}

export interface PlaytestReport {
  reportVersion: "asw91-playtest-report-v1";
  campaignId: string;
  campaignName: string;
  currentDate: string;
  campaignHash: string;
  entrant: string;
  dossier: CareerDossierData;
  latestMatch: {
    matchId: string;
    date: string;
    summary: string;
    method: string;
    finalMatchHash: string;
  } | null;
  recentEvents: Array<{
    id: string;
    date: string;
    type: string;
    summary: string;
    detail: string[];
    postStateHash: string;
  }>;
  notes: PlaytestNotes;
}
```

Functions:

- `normalizePlaytestNotes(notes, campaignId)`: trims text, removes duplicate tags, filters unknown tags, and binds notes to the current campaign ID.
- `buildPlaytestReport(campaign, dossier, notes)`: derives a report from current state, campaign hash, dossier data, latest completed match, and the latest 12 events.
- `serializePlaytestReport(report)`: returns stable pretty JSON with no generated timestamp or environment-dependent values.

The report is a diagnostic summary, not a replacement for **Export campaign JSON**, which remains the exact reproduction artifact.

### Fixture Shortcuts

Add `src/ui/playtest-fixtures.ts` with two read-only fixture loaders:

- `loadCompletedM5Fixture()` → `fixtures/m5/example-career-save.json`
- `loadInProgressM5Fixture()` → `fixtures/m5/example-in-progress-save.json`

Each loader passes the imported JSON through `importCampaignJson` and returns its validated state. No fixture is rewritten or regenerated.

### React Panel

Add `src/ui/playtest-panel.tsx`.

`PlaytestPanel` receives the current campaign, dossier, notes, and an `onNotesChange` callback. It renders:

- Session goal input
- Friction-tag checkbox group
- Free-text notes textarea
- `Save notes`, `Clear notes`, and `Export playtest report` controls
- Local-save status and current campaign ID

The panel uses the existing `downloadTextFile` helper. It renders on both the Career dashboard and active Career match so testers can record friction at either point.

`Career` owns the note draft and local-storage synchronization. When the campaign ID changes, the draft resets to the stored notes for the new campaign or an empty draft. Malformed storage is ignored safely. Clearing non-empty notes requires confirmation.

The Career setup receives a `Playtest fixtures` card with:

- `Load completed M5 fixture`
- `Load in-progress M5 fixture`

Loading a fixture over an existing campaign requires the existing replacement confirmation pattern. Import errors leave the current campaign untouched.

## UI and Accessibility

- Use a `fieldset` and `legend` for friction tags.
- Give every control an explicit accessible label.
- Announce local-save and export status through `aria-live="polite"`.
- Preserve keyboard operation and visible focus states.
- Keep the panel usable in the 390-pixel layout and inside the active-match surface.
- Use existing large-text, high-contrast, and reduced-motion classes.
- Do not rely on tag color alone; tag text remains visible.

## Error Handling and Privacy

- Local-storage parse failures fall back to an empty draft.
- Notes are normalized before persistence and export.
- Export failures surface a local UI message and do not mutate campaign state.
- Fixture import failures display the validation error and preserve the current campaign.
- No network requests, analytics, telemetry, accounts, or cloud storage are introduced.
- Report data is bounded to the current dossier, latest match summary, latest 12 event summaries, hashes, and tester-entered notes.

## Testing

Add `tests/m7-playtest.test.ts` covering:

- Tag normalization, deduplication, and invalid-tag filtering.
- Empty and campaign-bound note drafts.
- Deterministic report JSON for identical state and notes.
- Latest-match and recent-event derivation.
- Campaign hash unchanged before and after report derivation.
- Completed and in-progress fixture loaders preserve their known hashes and active-match status.
- Fixture import failure does not mutate the source state.

Extend `scripts/visual-qa.mjs` with profiles for:

- Playtest panel on a fresh Career dashboard.
- Saved notes and friction-tag selection.
- Report export control and status message.
- Completed fixture shortcut and report visibility.
- In-progress fixture shortcut and recovery surface.
- Narrow and accessibility variants.

Verification remains:

```text
npm.cmd run check
npm.cmd run fixtures:verify
npm.cmd run visual:qa
```

The existing 96 tests and all M5 fixture/replay hashes must remain unchanged and passing.
