# Vertical slice 1.0 implementation audit

## Verdict

The package is a complete runnable **M0–M3 implementation candidate** and replaces checkpoint 0.1. Singles and tag matches are playable end to end against a deterministic AI, all source maneuver rows are encoded, the major manual action families are reachable, Rules Lab and accessibility baselines are present, and every seeded simulation replayed to an identical final state hash.

It is not a formal M0–M3 acceptance certificate. The GDD requires an independent second-human transcription and adjudication sign-off for M0; this implementation has automated reconciliation and page-image review, but no software test can substitute for that independent human gate. M4–M6 are intentionally outside this slice.

## Milestone traceability

| Milestone | Implemented evidence | Status |
|---|---|---|
| M0 — Rules data and harness | 24 Holds, 78 Strikes, lookup/chart data, cost reconciliation, seeded PRNG, immutable events, canonical hash, replay identity | Implementation candidate; independent second-human transcription/sign-off remains |
| M1 — Singles engine | Phase loop, Holds/Strikes, pools, recovery, pins/submissions, countout, referee, critical/fumble, drawbacks, complete Charm windows | Implemented and regression-tested |
| M2 — Tag engine | Tags, outside recovery, double teams, interference, distraction entry/exit, deadlines, team results | Implemented and regression-tested |
| M3 — Playable solo match | Responsive action UI, visible arithmetic, fair shared-validator AI, Rules Lab stepping, accessibility toggles, singles/tag exhibitions | Implemented and browser-tested |
| M4–M6 | Creation/progression, campaign, persistence, content/tuning, platform release and rights clearance | Excluded by vertical-slice scope |

## Source and rule traceability

The maneuver catalog was transcribed from the manual's Hold and Strike charts and reviewed against rendered page images. Each of all 102 listed costs is independently recomputed from the encoded construction formula. Representative source-sensitive rows and flags have explicit regressions, including Choke with Ropes, Throw Out of Ring, and Brainbuster.

The GDD's adjudicated rules are covered by focused regressions for:

- AV/DV/DAM PTS/BODY and 1-, 2-, and 7-move phase rows;
- purchased-level versus untrained referee arithmetic;
- Break Hold Charm before the roll;
- Irish Whip two-roll resolution and transferred momentum;
- Critical Hold 100 injury plus automatic submission;
- simultaneous Dodge commitment;
- tag initiative, outside recovery, interference, and illegal-entry deadlines;
- Rules Lab single-transaction stepping;
- replay hash identity and data validation.

## Verification snapshot

Run on 2026-08-09:

- `npm run check`: **29/29 tests passed**, TypeScript compilation passed, production Vite build passed.
- Two-minute conservative batch: 50 singles and 50 tag matches reached the configured time-limit draw; all 100 replays matched their final canonical hashes. The short limit is a correctness stress fixture, not a match-duration claim.
- Ten-minute aggressive smoke batch: singles produced 6 pins and 4 time-limit draws; tag produced 5 pins and 5 time-limit draws. No smoke match ended by DQ after the AI alert-policy correction. All 20 replays matched.
- `npm run visual:qa`: singles desktop (1440×1100), tag desktop (1440×1100), tag narrow (390×844), accessibility modes, and Rules Lab passed without runtime console errors, horizontal overflow, or missing required controls.

## Defects found and fixed during completion QA

1. Break Hold skipped the required pre-roll Charm decision. The escape transaction now opens an explicit mandatory Charm window and has a regression.
2. A full-health outside partner could be forced to distract the referee. A no-action apron choice is now always legal.
3. Illegal-entry teams could lack an exit choice or miss the final safe exit phase. Either partner can exit, distraction extensions update the deadline, automatic DQ is logged, and entry is withheld when no future exit phase exists.
4. A floor wrestler at END lockout could receive an empty forced decision. Mandatory END recovery now takes priority and has a long-horizon regression.
5. Half-target entry authorization could survive after distraction expiry. Authorization now expires at the phase boundary and is rejected by the validator.
6. The AI spammed low-value distractions, inflated its own referee alert, then repeatedly risked DQ on harmless pin interference. Distraction is now reserved for late-match tactical value and interference is scored from the actual pending pin/submission threat and current alert. Ten-minute tag smoke changed from 10/10 DQs to 5 pins, 5 draws, and zero DQs without changing any rule or die result.

## Residual risks and later work

1. A second independent human must retranscribe the source tables and sign the adjudication register before M0 acceptance.
2. The AI uses bounded visible-state heuristics rather than a multi-ply search. It satisfies fairness and shared-legality constraints, but tactical strength still needs later tuning.
3. The internal fixture roster is intentionally small and original; source roster import and rights clearance remain separate.
4. Cross-runtime/platform hash comparison, save migration, installers, and broad platform QA belong to later milestones.
5. Simulation outcomes above validate termination, invariants, replay identity, and action reachability. They are not balance or target-duration claims.
