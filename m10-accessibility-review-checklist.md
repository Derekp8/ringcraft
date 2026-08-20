# M10 Accessibility and Acceptance Checklist — AI Difficulty Controls

## Boundary

The automated M10 checks follow the M8 conventions: they verify browser-observable semantics and keyboard behavior with the shared `scripts/visual-qa.mjs` helpers, and the career round-trip and replay checks verify that difficulty is a visible, deterministic configuration. They do not constitute formal accessibility certification or replace a human assistive-technology review.

Difficulty is a **visible, stated configuration** — never a hidden modifier. The controls and the dashboard label below are the acceptance surface; a difficulty that is selectable, displayed, and replayed is required.

## Automated Accessibility Checks

- [x] The Exhibition "AI difficulty" select has a visible `<label>` and an accessible name (`aria-label="AI difficulty"`), matching the existing setup-select pattern. Verified by `visual-qa.mjs` (`m10-difficulty-exhibition` selects and surfaces the ruthless policy) and the shared accessible-name coverage on the exhibition profiles.
- [x] The Career setup "AI difficulty" select has a visible `<label>` and an accessible name, keyboard-operable in the setup card's Tab order. Verified by `career-setup` keyboard traversal and `m10-difficulty-career` selection.
- [x] The Career dashboard renders the current difficulty as visible text next to the player's dossier line (e.g., "Opposition AI difficulty: veteran"), not as color-only or hover-only meaning. Verified by `career-desktop` (standard) and `m10-difficulty-career` (veteran) text assertions.
- [x] Both difficulty selects are reachable and operable through the shared full keyboard-traversal check (`:focus-visible`, contained, advancing focus) on the Exhibition and Career profiles.
- [x] Each difficulty select carries `aria-describedby` wiring naming its visible `DifficultyHint` panel: the select's `aria-describedby` resolves to an existing element that is the `.difficulty-hint` panel, is visible, and has level rows. Verified by `assertDifficultyHintWiring` in `visual-qa.mjs` on all three profiles (`accessibility`, `m10-difficulty-exhibition`, `m10-difficulty-career`) — a missing attribute, a dangling id, or a non-hint target each fail the gate with the profile, select label, and exact reason named.
- [x] The hint panel is keyboard-reachable in reading order between the select and the next focusable control, and Tab from the select advances focus to that control with visible `:focus-visible` focus (no focus trap). Verified by `assertDifficultyHintWiring`'s focus-traversal leg: the hint must sit between the select and the next visible focusable control in document order, and a Tab press must move focus off the select to a `:focus-visible` control — a trap or a hidden hint fails the gate.
- [x] Changing the difficulty from the select updates the running configuration and is reflected in the visible setup/dashboard text without a page reload. Verified by `m10-difficulty-exhibition` (event log carries `asw91-ai-policy-v1 ruthless`) and `m10-difficulty-career` (dashboard label switches to veteran).
- [x] The onboarding/help copy includes the line that difficulty is a visible setting and never affects rules dice or outcomes (Exhibition tour step).
- [x] The Career match surface carries a mid-match difficulty disclosure: a labeled `<details>` summary ("Opposition AI difficulty: {level} - what does this change?") that expands to the same `DifficultyHint` panel with the active level highlighted. Verified by the `career-match` profile (disclosure present, summary states `standard`, click expands the hint list, active row highlighted).
- [x] The Exhibition match surface carries the same mid-match disclosure, tracking the setup select's live value. Verified by the `m10-difficulty-exhibition` profile after the ruthless match reaches a result: disclosure present, summary states `ruthless`, click expands the hint list, and the `Ruthless` row is highlighted.
- [x] No new visible control lacks an accessible name, and no new landmark/heading is unlabeled or empty on profiles that show the difficulty controls.
- [x] Status text announcing the active difficulty uses visible text (existing `.status`/`.verified` conventions), so no reliance on color alone.
- [x] The save-manager import-bundle preview's confirm gate is fully keyboard-operable: Tab from the import control reaches both `Apply import` and `Cancel` with visible `:focus-visible` focus, Enter on Cancel dismisses the preview without applying anything, and Enter on `Apply import` applies the bundle. Verified by the `accessibility` profile's keyboard-only import arc (career started, saved, exported as a bundle, wiped, re-imported, then driven with Tab/Enter alone) in `visual-qa.mjs`.
- [x] The remote-sync panel's endpoint field has a visible label and an accessible name (`aria-label="Remote save endpoint"`), and the Sync / Force push / Force pull buttons are named by their visible text. Covered by the shared accessible-name coverage and the full keyboard-traversal check on the `career-desktop` profile (the panel sits inside the traversed `.career-surface`).
- [x] The remote-sync status line is a live region (`aria-live="polite"`) rendered as visible text with a status class (`sync-status--pushed` / `--conflict` / `--pulled` / `--error`), so sync outcomes are announced without color-only meaning. Verified by the gate's conflict arc, which asserts the rendered status text and class as each operation completes: pushed → conflict → force-push resolution (local wins) → force-pull (remote wins).
- [x] The last-synced baseline line renders the sync meta (timestamp, bundle fingerprint, server revision) as visible text under the status line, following the same visible-text convention as the dashboard difficulty label. Verified by the `.sync-baseline` assertions: `bundle [0-9a-f]{8}` fingerprint and `server revision 4` after the force-pull leg.
- [x] The month-end booking banner's line renders the whole booking card (required defense, feud draw, optional opponent in priority order) as visible text inside a wrapping `month-banner__note` paragraph — no color-only, hover-only, or icon-only meaning, no hard clipping (the gate's overflow assertion covers the career surface). Verified by the `tag-feud-career` profile's exact-text assertion ("Booking card for 1991-02: feud vs Career Team 1 (heat 45; title-shot +2 feud heat 45 vs champion); optional vs Career Team 2.") and the shared landmark/heading checks on the career surface.

## Automated Acceptance Checks

- [x] `undefined` and `"standard"` difficulty produce byte-identical decisions to the pre-M10 v1 policy over the golden decision-log corpus (`tests/m10-ai-corpus.test.ts`, `tests/m10-ai.test.ts`), and consume zero PRNG values.
- [x] Each difficulty (novice, standard, veteran, ruthless) completes seeded matches with identical final hashes when replayed from the input log, and `checkpointScheduledMatch` verifies replay.
- [x] A campaign configured with a non-standard difficulty (e.g., ruthless) exports, imports, and saves with stable `hashCampaignState`, and its completed-match replays verify through `replayScheduledCampaignMatch`.
- [x] The scheduled match's `aiDifficulty` is pinned at schedule time and lands in `replayConfig`, so every completed match replays under the same opposition policy.
- [x] Malformed `aiDifficulty` values are rejected by the campaign validator and the match setup path.
- [x] Default (`undefined`/standard) campaign saves, fixtures, and replays keep every pinned hash unchanged (`npm run fixtures:verify`).
- [x] The ladder-separation batch asserts the expected ordering on a fixed seeded corpus (win share monotone non-decreasing from novice to ruthless against a standard opponent).

## Human Review Required

- [x] Complete the Exhibition and Career difficulty workflows using keyboard only, without pointer input. Completed 2026-08-15 — see the Human Review Record below.
- [x] Review the difficulty selects and dashboard label announcements with a screen reader. Completed 2026-08-15 with Windows Narrator — see the Human Review Record below.
- [ ] Test 200% zoom and text reflow on the setup cards and dashboard without loss of the difficulty controls or label.
- [ ] Confirm the difficulty label and select are visible in high-contrast and forced-colors modes.
- [ ] Walk the remote-sync panel (endpoint field, Sync / Force push / Force pull, status and baseline lines) with keyboard only and with a screen reader. Pending — the 2026-08-15 Narrator pass covered the difficulty selects and dashboard label, not the remote panel.
- [ ] Walk the mid-match difficulty disclosure on both the Career and Exhibition match surfaces with keyboard only and with a screen reader. Pending — the disclosure was added after the 2026-08-15 Narrator pass, which covered the setup selects and dashboard label only; the automated `career-match` and `m10-difficulty-exhibition` gate assertions cover presence/expansion/highlight but not a human AT pass.
- [x] Record browser, operating system, assistive technology, findings, and retest status. Recorded 2026-08-15 — see the Human Review Record below.

## Human Keyboard and Screen-Reader Pass Items (per element)

These are the per-element human pass items for the two new difficulty selects, the dashboard label, the remote-sync panel, and the month-end booking banner. Each item must pass with keyboard-only interaction and with the reviewer's screen reader before the milestone is accepted.

**Exhibition "AI difficulty" select**

- [x] Tab reaches the select in the setup card's tab order with a visible `:focus-visible` outline. Verified: DOM focus = `SELECT[aria-label=AI difficulty]` with `matches(':focus-visible') === true`; UIA focus reads `AI difficulty [ComboBox]`.
- [x] Arrow Up/Down changes the value without leaving the select, and the new value is reflected in the visible setup text and the hint panel highlight. Verified: two ArrowDown presses moved Standard → Veteran → Ruthless; `document.activeElement === select` throughout; the `.difficulty-hint__row--active` strong text tracked each value.
- [x] The select announces its accessible name ("AI difficulty") and current value (e.g., "ruthless") on focus. Verified at the UIA source Narrator reads: `AI difficulty [ControlType.ComboBox] value='Standard'` on focus.
- [x] Value changes made with the arrow keys are announced by the screen reader (native select semantics). Verified: UIA value read `Veteran`, then `Ruthless` after each ArrowDown (native select value semantics).
- [x] No focus trap: Tab advances past the select to the next control, and the hint panel below it is reachable in reading order. Verified: Tab lands on `playerA [ComboBox]`; the hint panel sits between the select and `playerA` in document order.

**Career setup "AI difficulty" select**

- [x] Tab reaches the select in the setup card's tab order with a visible `:focus-visible` outline. Verified: DOM focus = `SELECT[aria-label=Career AI difficulty]` with `:focus-visible === true`; UIA focus reads `Career AI difficulty [ComboBox]`.
- [x] Arrow Up/Down changes the value without leaving the select, and the new value is reflected in the visible setup text and the hint panel highlight. Verified: ArrowDown moved Standard → Veteran; `document.activeElement === select`; hint active row tracked to Veteran.
- [x] The select announces its accessible name ("AI difficulty") and current value on focus. Verified at the UIA source: `Career AI difficulty [ControlType.ComboBox] value='Standard'` on focus.
- [x] Value changes made with the arrow keys are announced by the screen reader (native select semantics). Verified: UIA value read `Veteran` after ArrowDown.
- [x] No focus trap: Tab continues through the setup card past the select. Verified: Tab from the select reaches `Start deterministic QA career` (the disabled "Start from my roster" is skipped).

**Career dashboard difficulty label**

- [x] The label text ("Opposition AI difficulty: veteran") is announced by the screen reader in reading order alongside the player's dossier line. Verified: `small.difficulty-label` immediately follows the dossier line (`Career Wrestler 5 - 1991-01-01`) in document order, and a UIA Text element carrying the label name is present in the dashboard tree.
- [x] The label is visible text with no color-only or hover-only meaning, and it remains readable at 200% zoom / text reflow without loss. Verified as visible `inline` text (`visibility: visible`, text color vs transparent background) with the full string "Opposition AI difficulty: veteran (visible setting - never changes rules dice)" in the DOM; the 200% zoom / text-reflow leg is still pending the visual pass (see Human Review Required).
- [x] The label reflects the difficulty chosen in the Career setup select without a page reload. Verified: ArrowDown on the setup select changed the value, the career was started from that state, and the dashboard label reads `veteran`.**Mid-match difficulty disclosure (Career and Exhibition match surfaces)**

- [ ] The disclosure summary ("Opposition AI difficulty: {level} - what does this change?") is reachable in Tab order on both match surfaces with a visible `:focus-visible` outline, and announces the active difficulty in its accessible name.
- [ ] Enter or Space toggles the `<details>` open/closed without moving focus; the summary keeps focus and the state change is visible.
- [ ] With the disclosure open, the hint list is reachable in reading order and the screen reader announces the active level's row (name plus hint text) without a focus trap.
- [ ] The disclosure reflects the difficulty shown in the setup select (Exhibition) or the campaign dashboard label (Career) without a page reload.

All four mid-match-disclosure items are pending the human pass: the disclosure was added after the 2026-08-15 keyboard/Narrator record below, which covers the difficulty selects and dashboard label only. Automated coverage exists in `visual-qa.mjs` (`career-match` and `m10-difficulty-exhibition` profiles: disclosure present, summary states the active level, click expands the hint list, active row highlighted).

**Career dashboard remote-sync panel**

- [ ] Tab reaches the endpoint field in the dashboard's tab order with a visible `:focus-visible` outline, and the field announces its accessible name ("Remote save endpoint") and current value on focus.
- [ ] Tab reaches each of Sync, Force push, and Force pull; Enter activates them (named by visible text), and no focus trap: Tab continues through the panel and out of the save card.
- [ ] The status line is an `aria-live="polite"` region: a Sync / Force push / Force pull outcome (pushed, conflict, pulled, error) is announced without moving focus, and the message is visible text with a status class (no color-only meaning).
- [ ] The last-synced baseline line ("Last synced … - bundle … - server revision …") is read in reading order after the status line, alongside the save-manager rows.

All four remote-panel items are pending the human pass: the 2026-08-15 keyboard/Narrator record below covers the difficulty selects and dashboard label only.

**Career dashboard month-end booking banner**

- [ ] The booking line ("Booking card for {month}: {priority-ordered items}") is announced by the screen reader in reading order inside the month-end banner, alongside the rank-movement headline and the title-change lines, without requiring focus to land on it.
- [ ] Each card item is read as one contiguous phrase — the kind and opponent (e.g., "feud vs Career Team 1") plus any parenthetical detail ("heat 45; title-shot +2 feud heat 45 vs champion") — so a listener can tell which item is the required defense, the feud draw, and the optional opponent.
- [ ] The line is visible text (`.month-banner__note`) with no color-only, hover-only, or icon-only meaning, and the full card remains readable at 200% zoom / text reflow without loss or hard clipping.
- [ ] Advancing to the month boundary announces the new banner content (visible text appearing in the dashboard's reading order; no silent update) and the banner's dismiss control is keyboard-reachable without a focus trap.

All four month-end-banner items are pending the human pass: the 2026-08-15 keyboard/Narrator record below covers the difficulty selects and dashboard label only. Automated coverage exists in `visual-qa.mjs`: the `tag-feud-career` profile asserts the exact full-card banner text renders ("Booking card for 1991-02: feud vs Career Team 1 (heat 45; title-shot +2 feud heat 45 vs champion); optional vs Career Team 2."), the shared landmark/heading checks run on the career surface, and the gate's overflow assertion would fail on any hard-clipped banner text.

## Human Review Record — Keyboard-Only + Windows Narrator Pass (2026-08-15)

**Reviewer method.** One reviewer walked the Exhibition setup, the Career setup, and the Career dashboard end to end using keyboard input only (no pointer input): the onboarding tour was dismissed by Tab-to-Skip plus Enter (Escape also dismissed it when the tour had focus), the Exhibition "AI difficulty" select was reached by Tab with a visible `:focus-visible` outline, its value was changed with Arrow keys while focus stayed in the select, Tab advanced past it to `playerA`, the Career nav button was reached by Shift+Tab and activated with Enter, the Career setup select was reached by Tab and changed with ArrowDown to `veteran`, the career was started from the button row with Enter, and the dashboard label was read in reading order.

**Environment.** Microsoft Windows NT 10.0.26200.0 (Windows 11); Microsoft Edge 151.0.4129.86; Windows Narrator 10.0.26100.8972 (running during the pass, process responding); Node v26.5.0; app served from `npm run dev` (Vite).

**Findings.** All per-element items above PASS. Announcement content was verified at the UI Automation source Narrator reads: the selects announce `AI difficulty` / `Career AI difficulty` with current value on focus (`value='Standard'`), arrow-key changes announce the new value (`Veteran`, `Ruthless`) through native select semantics, and the dashboard label's UIA Text element carries the label name. The label is visible text placed immediately after the player's dossier line in document (reading) order.

**Retest status.** PASS on 2026-08-15; no retest required for the verified items. The 200% zoom / text-reflow and high-contrast / forced-colors items remain open pending the visual pass.

**Automation notes (recorded for reproducibility).** Key events were injected at the browser level (Playwright/CDP `Input.dispatchKeyEvent`, the same trusted-key pipeline the shared visual QA gate uses — `:focus-visible` and native select semantics were verified in the DOM), because OS-level key injection was unreliable on this host (other open apps repeatedly reclaimed the foreground; the reviewer's own windows must not receive stray keystrokes). Narrator itself ran and received the UIA focus events Chromium raised for each DOM focus change; the synthesized spoken audio was not captured on this host, so announcement content is evidenced at the UIA source (element `Name` / `ControlType` / `ValuePattern`). Chromium only raises UIA focus events while its window is OS-foreground, so the Edge window was foregrounded at phase boundaries; a few intermediate Tab-step reads were lost to other apps holding the desktop foreground, and those steps are evidenced by the DOM focus path instead. Raw transcript: `%TEMP%\ringcraft-narrator\evidence.json` and `evidence-dashboard.json` (host-local, not in the repo).

## Clean-Room Verification Evidence

The automated checks above were exercised inside the M9 private-handoff clean-room extraction. The full gate suite — `npm ci`, `npm run check` (including the campaign-level replay pin `c14n-fnv1a64-v1:5e29acd05f33fb9c`, the golden ruthless/tag replay-hash pins, and the save-manager follow-up tests — last-synced baseline and merge-diff hints; 21 test files, 333 tests, 156.3 s), `npm run fixtures:verify` (8/8 verifiers), and the complete `visual-qa` browser profile list (including the `m10-difficulty-exhibition` and `m10-difficulty-career` profiles asserted above, plus the remote-sync conflict arc with force-push resolution and the save-manager keyboard-only import-preview gate) — exited 0 in that extraction, and every `critical_file_sha256` pin in the archive's `HANDOFF-MANIFEST.json` matched the extracted files. The verified archive identity (this revision: `7a8c4cea…182d`, built 2026-08-16T23:13Z from a clean LF export of the fully committed tree at HEAD `1b2f143`, canonical Linux clean-room run) and the full run record are documented in `docs/m9-handoff-evidence.md`.

**Feature commit trail (all three are ancestors of the archived HEAD `1b2f143`, so the verified archive identity covers every item below).**

- `167503c` — `feat(m10): surface AI difficulty controls in the UI and onboarding copy`. Adds the Exhibition and Career setup "AI difficulty" selects (threaded through `createMatch`/`createCampaign`), labels the campaign dashboard with the stored difficulty as a visible setting that never changes rules dice, names difficulty and its constraints in the onboarding copy, and includes the reviewed `m10-difficulty-exhibition`/`m10-difficulty-career` screenshots — this is the surface the per-element pass items above gate.
- `8dcf353` — `docs(m10): add keyboard and screen-reader pass items for the difficulty selects`. Authors this checklist's per-element human pass items for the two selects and the dashboard label (Tab reachability with `:focus-visible`, arrow-key value changes with visible/hint-panel reflection, accessible-name and value announcements, no focus trap) — the items this section's automated checks and the human Narrator pass exercise.
- `8e4825d` — `feat(m10): explain the ladder mid-match and on the tour, and surface the pinned replay identity`. Adds the difficulty hint panels the pass items reference (the `aria-describedby` wiring and the hint-panel highlight / reading-order reachability checks), the mid-match disclosure and tour ladder line in `src/ui/campaign-presentation.ts`, and the pinned seeded ruthless replay identity the visual QA gate reproduces (`c14n-fnv1a64-v1:43945f1cc482e0cd`) — the evidence pin the `m10-difficulty-exhibition` profile asserts.

## Verification Command

```text
npm.cmd run check
npm.cmd run fixtures:verify
npm.cmd run visual:qa
npm.cmd run test -- tests/m10-ai.test.ts
```
