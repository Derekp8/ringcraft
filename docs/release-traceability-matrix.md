# Release traceability matrix

This is the consolidated closure index. Exact private page confirmation remains an independent-review task; known page locations come from the existing audited matrices and are not a substitute for reopening the authorized source. Item-level chart coverage, including all maneuver/profile rows, is in `docs/rules-audit-1991.md`.

| Rule family | Source location recorded by prior audit | Data / code | Primary automated evidence | Status |
|---|---|---|---|---|
| D6/D10/D20/D100 and virtual seed | Opening dice conventions; no digital seed equivalent | `src/core/prng.ts` | `tests/core.test.ts`, `randomized-play-fair-ai.test.ts` | Core faces match; digital seed extension; human source sign-off pending |
| Attribute creation and derived statistics | Creation chapters, printed pp. 7–14 | `creation.ts`, `derived.ts`, `rules.ts` | `m4.test.ts`, `core.test.ts` | Internal match; pending independent review |
| Background, experience, titles and Fame | Background chapters | `career-rules.ts`, `creation.ts` | `m4.test.ts` | Internal match; pending independent review |
| Maneuver purchase and prerequisites | Maneuver chapter; Holds chart printed p. 39 | `rules.ts`, `creation.ts`, `progression.ts`, `validator.ts` | `m4.test.ts`, `core.test.ts` | Internal match; ambiguities A-1991-01/02 |
| Holds and continuation | Maneuver/combat chapters | `engine.ts`, `validator.ts`, `rules.ts` | `core.test.ts` | Internal match; pending independent review |
| Strikes and finishing strikes | Maneuver/combat chapters | `engine.ts`, `validator.ts`, `rules.ts` | `core.test.ts` | Internal match; pending independent review |
| Critical Holds | Critical Hold chart, manual PDF 60 / printed 59 | `rules.ts`, `engine.ts` | `core.test.ts`, `m5.test.ts` | Internal match; M5-ADJ-03 pending approval |
| Critical Strikes | Critical Strike chart | `rules.ts`, `engine.ts` | `core.test.ts` | Internal match; pending independent review |
| Fumbles | Fumble chart | `rules.ts`, `engine.ts` | `core.test.ts` | Internal match; pending independent review |
| Pins and submissions | Combat chapter | `engine.ts`, `validator.ts` | `core.test.ts`, replay fixtures | Internal match; pending independent review |
| Recovery | Combat chapter | `engine.ts`, `derived.ts` | `core.test.ts` | Internal match; pending independent review |
| Referee checks and DQ | Manual PDF 56–60 / printed 55–59 | `engine.ts`, `rules.ts` | `core.test.ts` | Internal match; pending independent review |
| Outside ring and countout | Manual PDF 57 / printed 56 | `engine.ts`, `validator.ts` | `core.test.ts` | Internal match; pending independent review |
| Tag actions and interference | Tag combat, manual PDF 58–59 / printed 57–58 | `engine.ts`, `validator.ts` | `core.test.ts` | Internal match; pending independent review |
| WP awards and spending | Campaigning, manual PDF 64–65 / printed 63–64 | `progression.ts`, `campaign-rules.ts`, `campaign.ts` | `m4.test.ts`, `m5.test.ts` | Internal match; pending independent review |
| Monthly ratings | Manual PDF 66–67 / printed 65–66 | `campaign-rules.ts`, `campaign.ts` | `m5.test.ts`, campaign fixtures | Internal match; pending independent review |
| Title shots | Manual PDF 67–68 / printed 66–67 | `campaign-rules.ts`, `campaign.ts` | `m5.test.ts`, title-shot chain replay | Internal match; pending independent review |
| Championship obligations/vacancies | Manual PDF 67–69 / printed 66–68 | `campaign-rules.ts`, `campaign.ts` | `m5.test.ts` | Internal match plus recorded adjudications; pending review |
| Injuries and return eligibility | Critical charts; audited GDD 12.1–12.4 | `engine.ts`, `campaign.ts` | `m5.test.ts`, `post-match-injury.test.ts` | Core critical injuries internally match; optional post-match check is extension |
| Printed profiles / TOTAL WP | Appendix printed pp. 77–90 / PDF 78–91 | `official-roster.ts` | `player-ready-roster.test.ts`, rules audit | Three source ambiguities; pending review |
| Solo AI | No manual equivalent | `ai.ts` | `m10-ai*.test.ts`, `randomized-play-fair-ai.test.ts` | Digital extension; legal, bounded, replayable automated evidence |
| Replay, hashes, saves | No manual equivalent | `hash.ts`, serialization modules | replay/save tests and fixtures | Digital infrastructure; automated pass |
| Cage and ladder | Not in core; GDD 18.2 originally out of scope | M11 modules/configuration | `m11-match-variety.test.ts` | Optional Ringcraft extension |
| Finance/contracts/popularity/chemistry/negotiation | No source subsystem | M12 campaign/configuration | `m12-*.test.ts` | Optional Ringcraft extension |
| Feuds and booking | Source flavor only, no mechanical subsystem | M13 campaign/configuration | `m13-*.test.ts` | Optional Ringcraft extension |

Reviewer completion requires an authorized private page identifier for every row, cell-by-cell table comparison, initials for every relevant adjudication entry, and signatures in `docs/manual-compliance-review-packet.md`.
