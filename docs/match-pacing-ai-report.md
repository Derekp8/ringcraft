# Match pacing and AI behavior report

## Scope

This report separates termination tests from product pacing evidence. It does not claim subjective balance acceptance and does not authorize changing manual probabilities.

## Why the reported 50/50 draw batches are misleading

`tests/core.test.ts` runs 50 singles and 50 tag matches at a deliberately short two-minute limit with a conservative `safePlayerAction`. Its contract is termination, legal decisions, and replayability—not finish distribution. A time-limit result is a valid terminal result, so 100% draws there do not show that ordinary eight-minute AI play cannot finish.

The two twelve-month fixtures are also deterministic integration fixtures, not a balanced player roster sample. Their 71 draws in 77 matches show that those generated rosters and configured limits are draw-prone; they remain useful persistence/replay evidence but are not product acceptance evidence.

## Canonical seeded pacing sample

`fixtures/m11/playtest-balance-report-v1.json` re-derives 528 eight-minute AI-driven matches across 17 batches.

| Format / roster relationship | Matches | Finish distribution | Draw rate | Length evidence |
|---|---:|---|---:|---|
| Standard-variety aggregate | 208 | 136 pin, 1 submission, 1 DQ, 70 draw | 33.65% | Mean 4.269 min; median 3 min |
| Cage extension | 64 | 52 escape, 8 pin, 4 draw | 6.25% | Pinned in report |
| Ladder extension | 64 | 55 retrieval, 8 pin, 1 draw | 1.56% | Pinned in report |
| Four underdog-standard batches | 128 | 125 pin, 1 DQ, 2 draw | 1.56% | Eight-minute configuration |
| Equal high-END standard | 32 | 1 submission, 31 draw | 96.88% | Intentional endurance stress fixture |
| Equal high-END ruthless | 32 | 2 pin, 30 draw | 93.75% | Intentional endurance stress fixture |
| Tag standard | 16 | 9 pin, 7 draw | 43.75% | Eight-minute configuration |

Moderate-END head-to-head batches further show roster and policy sensitivity: novice–standard 29 pins/3 draws; novice–veteran 27 pins/2 submissions/3 draws; novice–ruthless 27 pins/3 submissions/2 draws; standard–veteran 16 pins/1 submission/15 draws; standard–ruthless 31 pins/1 draw; veteran–ruthless 31 pins/1 draw.

The machine-readable report also contains per-batch difficulty, roster relationship, finish method, match length, and decision analytics. Fixture verification recomputes it exactly rather than trusting prose totals.

## Findings

- Matches legally terminate. No empty mandatory decision or non-terminating loop is demonstrated; historical bonus-attack empty-action seeds have explicit regressions.
- Draw frequency is dominated by time-limit selection and roster endurance/strength relationship. Equal high-END matchups are the clear outliers. Underdog fixtures at the same eight-minute limit overwhelmingly finish.
- The evidence is not consistent with a universal insufficient-pin defect or a globally over-conservative AI. Some pairings remain draw-heavy and should be played by humans before tuning.
- AI difficulty changes action selection only. It receives visible state, enumerates legal actions, uses bounded cloned simulations, does not mutate the live state, and does not read/consume live future RNG. Novice noise is seeded; replay pins cover decisions and final hashes.
- No rule, probability, recovery value, hold behavior, tag rule, AI score, time limit, policy identity, or replay fixture was changed in this phase.

## Acceptance decision

Automated engineering status: **pass** for legality, termination, fairness, bounded search, and deterministic replay. Product pacing status: **pending human playtest** using `docs/human-playtest-checklist.md`. Any future tuning should first adjust player-facing time-limit choices or documented AI valuation, not source rules, and must repeat all deterministic and difficulty-ordering gates.
