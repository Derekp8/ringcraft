# Project Ringcraft — M16 First-Run Playability Audit

Milestone: M16 — Full Playability Closure

This is an automated/source-backed UI audit, not a human playtest. The human clarity scenarios in `docs/qa/m16-playability-review.md` remain `NOT RUN` until a player executes them.

## Required next-action visibility

| Player question | Current player-facing evidence | Automated evidence |
|---|---|---|
| How do I start Exhibition? | `Exhibition` is a primary navigation area and the startup tour includes an Exhibition step. | Browser A starts from a fresh application context and proves the initial Exhibition is playable. |
| How do I start a match? | Exhibition exposes `Start match`; deterministic/manual seed controls remain under advanced options. | Browser A starts and completes a normal Singles match; B starts Tag. |
| When is it my turn / what can I do? | The decision panel names the current decision/actor and renders only validator-supplied legal action buttons, including a visible legal-choice count. | A/B/G interact with rendered legal action buttons; G also proves duplicate/stale actions cannot mutate replacement state. |
| How are match resources represented? | Wrestler cards expose DAM PTS, END, AV, DV, BODY, PACE, statuses, phase/minute, and legal/apron state. | Visual QA and browser Tag assertions exercise these rendered surfaces. |
| How do I know the match ended? | Result state displays `MATCH COMPLETE`, winner/draw, ending method, time, events, dice, and decision count. | A/B/C/E play matches to result. |
| How do I begin Career? | `Career` is primary navigation; setup defaults to Strict Manual Mode and exposes a normal Career start plus deterministic developer controls. | C creates a deterministic Strict Manual Career and verifies derived compatibility. |
| How do I schedule/play a Career match? | Career dashboard exposes `Accept and schedule`, `Advance one day`, and `Play due match` when legal, with blocked-state guidance when unavailable. | C/E schedule, advance, and play through the real UI. |
| How do I make the Career result official? | Completed Career matches expose the explicit `Commit official result` action. | C commits once; E/G compare normal and duplicate commit attempts and prove exactly-once final Campaign identity. |
| How do I save progress? | Career dashboard contains named-save create/update/duplicate/rename/delete, autosave history, bundle export/import, and Campaign JSON export/import. | D covers rollback plus the M16 named-save lifecycle supplement; H covers real file bundle import and corrupt-newer rejection. |
| How do I restore progress? | Named saves expose `Load` with a restore preview/confirmation; autosaves expose restore controls. | D verifies exact date/hash rollback; E verifies interrupted-match recovery and next-RNG continuity. |

## Startup guidance

The existing guided tour is shown to a first-time browser profile until dismissed. Its player-facing steps cover Exhibition, wrestler creation, progression, Career, AI-difficulty boundaries, and save durability. M16 does not add another modal/tutorial system because no automated blocker currently demonstrates that a required next action is absent.

## Accessibility support for first-run controls

The existing visual/accessibility route checks accessible names, landmark/heading structure, keyboard traversal, visible focus, live regions, dialog focus behavior, no color-only status, and save-import keyboard operation. Installed-PWA accessibility remains part of the same application UI; human accessibility review remains a separate external gate.

## M16 assessment

**Automated/source-backed first-run blocker audit: PASS — no missing required next-action control identified.**

This does **not** mean the human first-run experience is certified. M16-H01 through M16-H10, especially the question asking where the next action was unclear, remain human `NOT RUN` until actually performed.
