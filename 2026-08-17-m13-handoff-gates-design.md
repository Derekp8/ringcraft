# M13 Closing the External Handoff Gates — Design

**Project:** Project Ringcraft 1.2.0 M13 handoff candidate
**Status:** Proposed design, not implemented
**Date:** 2026-08-17

## Goal

Close the two remaining *external human handoff gates* that M8–M12 deliberately left open — (1) the human keyboard/screen-reader/zoom/forced-colors pass on the M10 difficulty controls, and (2) human playtest sign-off on the M11 seeded balance report — with **scripted, reproducible artifacts** instead of prose claims. M13 turns each "human review required" line into a machine-executable pass whose evidence is a committed, pinned fixture; the human reviewer's job becomes running the pass and signing the record, not handwriting an unverifiable checklist entry.

This is a **verification and evidence milestone, not a rules milestone**: it changes no gameplay, no engine, no campaign schema, no hash, and no replay contract. It adds:

1. **A scripted accessibility pass** (`scripts/run-a11y-pass.mjs`) that walks the two difficulty selects and the dashboard label through keyboard-only interaction and emulated forced-colors / 200% zoom / text-reflow conditions, recording a machine-readable pass record (`output/a11y/` → committed fixture `fixtures/a11y/pass-record-v1.json`).
2. **A human-playtest sign-off harness** (`scripts/run-playtest-signoff.mjs` + a browser surface) that lets a human reviewer play seeded M11 matches live against the difficulty AI, records their decision input log, re-verifies the replay contract on it, and produces a machine-readable sign-off record (`fixtures/playtest/signoff-record-v1.json`) with the reviewer, date, seeds, and per-match replay hashes.

## Authority and Framing

M13 inherits the M8/M10/M11 framing: automated checks verify browser-observable semantics and deterministic behavior, and they **do not** constitute formal accessibility certification. What changes is the *evidence shape*: where M10's checklist ends at "pending the human pass" and M11's report ends at "human playtest sign-off remains the external human gate," M13 provides the *instrumented procedure* for those passes and the *signed, pinned record* of the reviewer's completion — so the external gate is closed by a documented human action over a reproducible script, not by the absence of a finding.

Two boundary statements stay explicit in the docs:

- **Accessibility:** the scripted pass verifies keyboard reachability, `:focus-visible`, reading order, forced-colors visibility, and 200% zoom/reflow retention of the difficulty controls and label using browser emulation and DOM/UIA-source assertions. It does not replace a human on a physical assistive-technology setup; the reviewer's completion record is the human gate.
- **Playtest:** the sign-off harness records what the human *did* (decisions, outcome, replay hash) on pinned seeded matches. It is the human-playtest evidence line M11's report explicitly deferred; it is not a claim that the seeds generalize to all play.

No new adjudication is required: the difficulty ladder (M10-ADJ) and the cage/ladder rules (M11-ADJ) are already adjudicated; M13 only instruments their review.

## Compatibility Boundary

M13 must not modify:

- `src/core/*` engine, rules, PRNG, hash, or campaign behavior — scripts, UI-surface additions, fixtures, tests, and docs only
- Any pinned hash, existing fixture, replay format, the M10 corpus, the M11 playtest/trend reports, or the save-determinism fixture
- `M5_DATA_HASH`, `asw91-ai-policy-v1`, `asw91-campaign-v1`, or the M11 report schema `asw91-playtest-balance-report-v1`
- The difficulty UI surface (`src/ui/App.tsx` selects, dashboard label, `DifficultyHint`, mid-match disclosure) — the pass *tests* it but must not change it

M13 intentionally adds:

- `scripts/run-a11y-pass.mjs` — the scripted accessibility pass (browser-driven)
- `scripts/run-playtest-signoff.mjs` — the playtest sign-off harness (browser-driven; records the human's input log and re-verifies replay)
- `fixtures/a11y/pass-record-v1.json` — the committed, pinned accessibility pass record
- `fixtures/playtest/signoff-record-v1.json` — the committed, pinned playtest sign-off record (empty/initial until a reviewer runs the harness)
- Browser surface: a "Playtest sign-off" mode reachable from the existing playtest dashboard, and a pass-progress view for the a11y run (both keyboard-accessible, reusing existing styles)
- `tests/m13-*.test.ts` — invariant + determinism tests
- `package.json` — `a11y:pass`, `playtest:signoff` scripts, a `fixtures:verify` extension for both new records
- Docs: `known-limitations.md`, the M8/M10 checklists' remaining-gates lines, the M11 audit's remaining-gates line, the M9 evidence doc's External Gates section, and the M13 implementation audit

## Part A — Scripted Accessibility Pass

### Scope

The pass covers exactly the M10 acceptance surface the user-facing gates still list as pending human work, scoped to the two difficulty selects and the dashboard label:

1. Exhibition "AI difficulty" select (setup card)
2. Career setup "AI difficulty" select
3. Career dashboard difficulty label
4. The `DifficultyHint` panels and the mid-match disclosure on both match surfaces (the M10 checklist's remaining human items)

The remote-sync panel (also pending in M10) is out of M13-A's scope by request — the milestone names the difficulty controls and dashboard label; the remote panel keeps its checklist line and the harness pattern applies to it unchanged.

### Procedure (`scripts/run-a11y-pass.mjs`)

The script boots the app (same vite + portable-Chromium bootstrap as `visual-qa.mjs`), then executes a fixed, logged sequence per element. Every assertion emits a structured `{ check, element, passed, detail }` line, and the pass record is written only when every check passes.

**Keyboard-only leg** (no pointer input):

- Tab-reachability: from the surface entry point, Tab advances through the tab order to the select with `:focus-visible` on the element; the step count is recorded so a later layout change that moves the control (or inserts an unlabeled control ahead of it) fails the pass.
- Value changes: Arrow Up/Down change the value while `document.activeElement` stays on the select; after each press the visible setup text and the hint panel's active row reflect the new value.
- Reading order: the `DifficultyHint` panel sits between the select and the next focusable control in document order; Tab from the select advances focus off it (no trap).
- Mid-match disclosure: Tab reaches the `<details>` summary with `:focus-visible`; Enter/Space toggles it without moving focus; with it open, the hint list is in reading order; the summary's text tracks the select/dashboard value.
- Dashboard label: after starting a campaign from a selected difficulty, the label is read in document order immediately after the player's dossier line, as visible inline text.

**Emulated presentation legs** (the M10 checklist's two still-open human items):

- Forced-colors: `page.emulateMedia({ forcedColors: "active" })` then assert the selects, hint panels, disclosure, and label remain visible text (not color-only or `display: none`), and the `:focus-visible` outline is still distinguishable. This mirrors the browser-level emulation, not a physical high-contrast OS mode — the record states that boundary.
- 200% zoom / text reflow: `page.setViewportSize` at a 390 px-wide viewport with `deviceScaleFactor: 2` (the gate's existing narrow profile) and assert the selects, hint, disclosure, and label are present and not clipped (reuses the existing `assertNoHardClippedText` overflow gate), and the label's full string is visible without loss.

**Screen-reader-source leg:** the pass records the same UIA-source evidence the 2026-08-15 Narrator pass used (element `Name`, `ControlType`, `ValuePattern` via the Chromium accessibility tree), so a future Narrator/AT rerun can diff announcements against the committed record. The script asserts the select's accessible name, the value announced on focus, and the label's text node in the accessibility tree — without requiring a screen reader to be installed.

### Pass Record (`fixtures/a11y/pass-record-v1.json`)

```ts
{
  schema: "asw91-a11y-pass-record-v1",
  appVersion: "1.2.0-m13",
  generator: "scripts/run-a11y-pass.mjs",
  run: {
    completedAt: string,             // wall-clock, record-level only
    browserTarget: "linux-portable-chromium" | "windows-edge-fallback",
    platform: string, nodeVersion: string,
    reviewerName: string,            // filled by the human who ran the pass
  },
  checks: [{ check: string, element: string, passed: boolean, detail: string }],
  result: "passed" | "failed",
  recordHash: "c14n-fnv1a64-v1:…",   // canonical hash of everything except itself
}
```

The `recordHash` is pinned as `deterministic_evidence` (like the M11 report and save-determinism hashes), so the clean-room gate and `manifest-pins` re-derive it and fail on any drift. `completedAt` is excluded from the hash (the record's determinism is about the checks, not the wall clock).

## Part B — Human Playtest Sign-Off Harness

### Shape

The M11 report is AI-vs-AI; its own text says human playtest sign-off remains the external gate. M13-B closes that gate with a **recorded human-in-the-loop run over pinned seeds**:

- A human reviewer, from the playtest dashboard's new "Playtest sign-off" mode, picks one of the report's batches (defaulting to the four `underdog-*` difficulty batches) and a seed.
- The app loads that batch's roster and the match configuration exactly as `scripts/m11-playtest-batch.ts` constructs it (shared derivation module, so the seeded match is the same one the report measured), with the AI at the batch's difficulty and the human on the player side (the v1 side).
- The human plays the match live in the existing match UI. Every decision is recorded into an input log (the same input-log shape `replayFromInputLog` consumes).
- On result, the harness exports `{ batch, rosterKey, variety, difficulty, seed, inputLog, winnerTeam, method, minutes, ticks, finalStateHash }` and re-plays the input log through `replayFromInputLog` in Node, asserting the terminal hash reproduces. A wrong hash fails the sign-off run.
- The harness appends the reviewer's entries to the sign-off record, signed with reviewer name + completion date; the record hash re-pins.

The human's *decisions* replace the v1 player's on the player side, so the terminal hash is a **human-driven** hash — the harness proves the match is deterministic given the human's inputs (the replay contract), which is the whole point: the human played a real, reproducible match, not a simulation.

### Sign-Off Record (`fixtures/playtest/signoff-record-v1.json`)

```ts
{
  schema: "asw91-playtest-signoff-record-v1",
  reportHash: "c14n-fnv1a64-v1:0cf1a58e2b994c0a",   // the M11 report being signed off
  entries: [{
    reviewer: string, completedAt: string,
    batch: string, rosterKey: string, variety: "standard"|"cage"|"ladder",
    difficulty: AiDifficulty, seed: number,
    inputLog: InputLog, winnerTeam: "player"|"ai"|null, method: string,
    minutes: number, ticks: number, finalStateHash: string,
  }],
  findings: [{ reviewer, date, topic, observation, verdict: "ok"|"concern" }],
  recordHash: "c14n-fnv1a64-v1:…",
}
```

An empty initial record (committed) carries `entries: []` and a stable `recordHash`; the fixture verifier re-derives it and asserts the pinned hash, so a reviewer's additions change the hash and are themselves pinned in the next archive build. This keeps the sign-off chain deterministic: every sign-off entry is anchored to the report hash and to a re-verified replay hash.

### Minimum sign-off acceptance

The harness's browser mode enforces a floor before a record is accepted:

- At least one seeded match per difficulty rung (novice, standard, veteran, ruthless) from the `underdog-*` batches, and at least one non-standard variety (cage or ladder) if the reviewer chooses to include one.
- Every entry's `finalStateHash` re-verifies through `replayFromInputLog` (the harness blocks submission otherwise).
- The reviewer records at least one `findings` line per difficulty rung (the sign-off is an opinion, not a checkbox).

## Verification

- `verify-m13-a11y.ts` / `verify-m13-playtest.ts` (wired into `fixtures:verify`): re-derive both records' `recordHash` from the committed fixtures, assert the pinned hashes, assert the pass record contains no failed checks, and re-run `replayFromInputLog` on every sign-off entry's `inputLog`/`finalStateHash`.
- The clean-room gate's `deterministic_evidence` gains `a11y_pass_record_hash` and `playtest_signoff_record_hash` pins, parsed numerically from the verifiers' JSON (the same pattern as the M11 win-share pins).
- `npm run check` green; `npm run fixtures:verify` green (now 10 verifiers).
- `visual-qa.mjs` stays green — M13-A runs its own browser pass; M13-B's surface is covered by an existing-profile keyboard check (the playtest dashboard gains a keyboard-traversal leg).

## Tests

1. `tests/m13-a11y-record.test.ts` — pass-record schema, no failed checks on the committed record, `recordHash` recomputes.
2. `tests/m13-playtest-signoff.test.ts` — sign-off-record schema, empty-record hash, and a **synthetic entry**: a seeded human-vs-AI match played with a scripted input log re-verifies to its `finalStateHash` (proving the harness's replay contract on a committed example without a human).
3. `tests/m13-surface.test.ts` — the "Playtest sign-off" mode is keyboard-reachable from the dashboard and the a11y pass-progress view renders accessible-name/live-region semantics.

## Acceptance

- Both records committed, pinned, and reproducible (`fixtures:verify` green, 10 verifiers).
- `manifest-pins` green after the docs/package/fixture refreshes.
- The M10 checklist's pending human items for the difficulty controls and label are closed with the pass record; `known-limitations.md` and the M9 evidence External Gates section record that the *instrumented* human gates are closed (physical-AT certification and independent source adjudication remain external).
- A human reviewer has run `npm run a11y:pass` and `npm run playtest:signoff` against the working tree and their completed records are committed.
- No pinned hash, fixture, engine file, or schema changed.

## Known boundaries (recorded, not hidden)

- The a11y pass emulates forced-colors and zoom; it does not run a physical OS high-contrast mode or a physical screen reader. The UIA-source assertions make a later physical-AT rerun diffable against the committed record.
- The playtest sign-off covers the reviewer's chosen seeds only; it is the human-evidence line for the M11 report, not a claim of universal balance.
- The remote-sync panel keeps its M10 pending line; the a11y-pass harness pattern applies to it directly if a later milestone scopes it in.
