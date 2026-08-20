# All-Star Wrestling (1991) rules audit — Ringcraft

## Authority and method

Authority order for this audit is: (1) the 1991 *All-Star Wrestling* manual, (2) printed wrestler profiles in that manual, (3) supplied official errata/supplements if present, (4) the audited digital GDD as implementation guidance, and (5) Ringcraft source code only as implementation evidence. The manual's substantive rules pages were reviewed by chapter/rule family and cross-checked against the existing M4/M5 traceability matrices, the audited GDD, the rules data pack, validators, engine transitions, campaign transactions, and regression fixtures. Advertising, blank forms, feedback pages, and other non-rules pages are classified NOT APPLICABLE.

Status values: **MATCHES SOURCE**, **IMPLEMENTATION DEFECT**, **TRANSCRIPTION QUESTION**, **SOURCE AMBIGUITY**, **NOT IMPLEMENTED**, **NOT APPLICABLE**, **DIGITAL EXTENSION**.

## Focused adjudication: maneuver minimum attributes

**Rule:** A maneuver's printed minimum is an in-match/use prerequisite as well as a purchase prerequisite. Holds use **MIN TEC**; Strikes use **MIN POW**.

**Source:** Character-creation attribute text states that most Holds require minimum TEC and some maneuvers require minimum POW. The maneuver chapter states that a Hold whose MIN TEC is unmet may not be used, and that a Strike whose MIN POW is unmet may not be used. The "Big Scott" creation example reinforces the distinction: TEC 31 limits his Hold purchases, while he still legally buys Piledriver as a Strike because its threshold is POW, not TEC.

**Previous question:** Piledriver (40), Press & Slam (70), and Bearhug Suplex (75) were initially read as MIN TECH values when comparing printed profiles. They are Strike rows and therefore MIN POW values.

**Conclusion:** **MATCHES SOURCE.** Ringcraft already uses `move.kind === "hold" ? TEC : POW` in creation, progression, serialization validation, and match legality. The official-roster audit and its regression test now use the same rule. No maneuver data or profile attribute was changed.

**Confidence:** High. The rule is explicit in both the attribute and maneuver sections and is demonstrated by the printed Big Scott example.

## Rules matrix

| Rule / system | 1991 manual authority | Ringcraft implementation | Status | Notes |
|---|---|---|---|---|
| Dice conventions (D6/D10/D20/D100) | Intro / creating a wrestler, opening rules pages | `prng.ts`, dice-expression resolution | MATCHES SOURCE | Digital PRNG replaces physical dice while preserving die faces/probabilities. |
| Physical attribute pool | Ch. 1, wrestler creation, printed pp. 7-14 | `creation.ts` | MATCHES SOURCE | 10D10+200 pool; five attributes; 1-100 bounds. |
| POW meaning | Ch. 1 attributes | `rules.ts`, derived calculations | MATCHES SOURCE | Includes Strike MIN POW prerequisite. |
| AGI / phase movement | Ch. 1; Agility/Phase Movement charts | `PHASE_SCHEDULE`, derived movement | MATCHES SOURCE | Source bands are data-driven. |
| QUI / initiative contribution | Ch. 1 attributes; combat turn order | derived/engine initiative logic | MATCHES SOURCE | Used for AV/DV and simultaneous-phase ordering. |
| TEC meaning | Ch. 1 attributes | validators/derived | MATCHES SOURCE | Includes Hold MIN TEC prerequisite. |
| END / recovery | Ch. 1 secondary attributes | derived/engine recovery | MATCHES SOURCE | END pool and REC formula retained. |
| AV / DV derivation | Ch. 1 attribute charts | `ATTRIBUTE_LOOKUPS`, `baseAv`, `baseDv` | MATCHES SOURCE | All printed official profiles reproduce printed AV/DV. |
| Damage Points | Ch. 1 secondary attributes | `startingDamage` | MATCHES SOURCE | Derived from POW/END. |
| Damage Bonus | Ch. 1 charts | `DAMAGE_BONUS_BANDS` | MATCHES SOURCE | Source bands centralized in rules data. |
| BODY | Ch. 1 BODY chart | `BODY_TABLE`, `body()` | MATCHES SOURCE | Complete chart regression coverage exists. |
| Height / weight | Ch. 1 Height & Weight chart | creation tables/validation | MATCHES SOURCE | Source-supported range and light-heavyweight cutoff retained. |
| Debut age/result | Ch. 2 background | `career-rules.ts`, creation transactions | MATCHES SOURCE | Deterministic trace records rolls. |
| Previous experience | Ch. 2 background | creation history | MATCHES SOURCE | Each experience result advances age as source directs. |
| Federation history | Ch. 2 federation chart | creation history | MATCHES SOURCE | Table-driven. |
| Prior championships / Fame | Ch. 2 championship/fame charts | creation history / Fame | MATCHES SOURCE | Creation-only Fame-to-WP conversion separated from campaign Fame. |
| Fan Favorite / Rulebreaker side | Ch. 1-4 side restrictions | creation/progression/validator | MATCHES SOURCE | Illegal maneuver/skill purchase restrictions enforced. |
| Drawbacks | Ch. 3 drawback sections/charts | `career-rules.ts`, creation/progression | MATCHES SOURCE | Egotist, Glass Jaw, Old Injury, Stupid Moves. |
| Base skill points | Maneuvers/skills chapter | `BASE_CREATION_SKILL_POINTS` | MATCHES SOURCE | 150 base skill points plus source-supported creation modifiers. |
| Hold purchase/use minimum | Maneuver chapter / Holds chart | creation/progression/serialization/validator | MATCHES SOURCE | Uses TEC. |
| Strike purchase/use minimum | Maneuver chapter / Strikes chart | creation/progression/serialization/validator | MATCHES SOURCE | Uses POW. |
| Untrained maneuver use | Maneuver chapter | maneuver proficiency / legal action enumeration | MATCHES SOURCE | Legal at -5 AV when minimum attribute/side requirements are met. |
| Maneuver breadth/level cap | Maneuver chapter | creation/progression validators | MATCHES SOURCE | Levels capped by number of distinct maneuvers, max 8. |
| Illegal maneuver ownership/use | Maneuver chapter | maneuver flags / referee check | MATCHES SOURCE | Rulebreaker purchase lock; illegal use invokes referee procedure. |
| Hold continuation / END cost | Maneuver/combat chapters | engine hold state | MATCHES SOURCE | Holds persist subject to END and escape/release rules. |
| Submission Holds | Maneuver/combat chapters | hold/submission engine transitions | MATCHES SOURCE | Submission eligibility and terminal result implemented. |
| Finishing Strikes | Maneuver chapter | finisher flags / attack logic | MATCHES SOURCE | Distinct restricted-check behavior retained. |
| Irish Whip | Maneuver/Special Skills chapter | skill + whip-eligible strike actions | MATCHES SOURCE | Only source-eligible Strikes exposed. |
| Special Skill TEC caps | Special Skills chapter | `specialSkillCap` | MATCHES SOURCE | One level per 10 full TEC except Charm. |
| Charm/Fame cap and spend | Charm chart/text | charm state / check/damage/recovery bonuses | MATCHES SOURCE | Fame caps total levels; phase effect capped by source chart. |
| Custom maneuver construction | Maneuver-construction section, printed pp. 43-44 | `career-rules.ts` maneuver builder | MATCHES SOURCE | Cost and legality validated. |
| Match phase/tick progression | Combat chapter | `engine.ts` | MATCHES SOURCE | Source phase schedule drives activation. |
| Attack target calculation | Combat chapter | derived + validator + engine | MATCHES SOURCE | AV, proficiency, DV and situational modifiers centralized. |
| Attack damage | Combat chapter | engine damage resolver | MATCHES SOURCE | Maneuver expression + permitted DAM BONUS, then BODY rules. |
| Critical Holds | Critical Hit chart / combat | `CRITICAL_HOLD_BANDS` | MATCHES SOURCE | Full percentile bands data-driven. |
| Critical Strikes | Critical Hit chart / combat | `CRITICAL_STRIKE_BANDS` | MATCHES SOURCE | Includes bonus attacks and knockout result. |
| Fumbles | Fumble chart / combat | `FUMBLE_BANDS` | MATCHES SOURCE | Referee/self/rollup outcomes represented. |
| Pin prerequisite/resolution | Combat chapter | validator/engine pin state | MATCHES SOURCE | Referee must be able to count; terminal-state guards retained. |
| Knockout cover legality | Combat chapter + fumble/critical interactions | validator/engine | MATCHES SOURCE | Automatic cover is not offered while referee cannot count. |
| Hold release before submission | Combat/hold procedure | engine transition guard | MATCHES SOURCE | Submission follow-up skipped if legal intervention already released Hold. |
| Recovery | Combat chapter | recovery actions / end-of-minute recovery | MATCHES SOURCE | Player action and scheduled recovery represented. |
| Outside the ring / countout | Combat chapter, printed p. 56 | outside/countout state | MATCHES SOURCE | Countout progression/recovery/terminal results implemented. |
| Referee rolls | Combat chapter, printed pp. 56-60 | referee state/check functions | MATCHES SOURCE | Distracted/KO/ref checks represented. |
| Disqualification | Combat chapter, printed p. 57 | referee/DQ engine | MATCHES SOURCE | DQ terminal result and campaign consequences implemented. |
| Time limit | Match setup/combat | match clock/terminal resolution | MATCHES SOURCE | Draw is generated on source time-limit expiration. |
| Tag actions | Tag Team Combat, printed pp. 57-58 | tag validator/engine | MATCHES SOURCE | Active/inactive partner state represented. |
| Tagging out | Tag Team Combat | legal tag action/state transition | MATCHES SOURCE | Partner becomes active legally. |
| Combining Strikes | Tag Team Combat | combined-strike action | MATCHES SOURCE | Shared eligible strikes only. |
| Distracting referee (tag) | Tag Team Combat | tag/ref actions | MATCHES SOURCE | Uses special-skill/ref state. |
| Pin interference | Tag Team Combat | tag actions / Pin Interference skill | MATCHES SOURCE | Player/AI legality enumerated. |
| Tag recovery | Tag Team Combat | inactive partner recovery | MATCHES SOURCE | Existing tag engine state handles off-ring recovery. |
| Match WP award | Campaigning, printed pp. 63-64 | `progression.ts` / campaign rules | MATCHES SOURCE | Win/loss/draw/DQ/countout and non-negative floor. |
| WP spending on attributes | Campaigning, printed pp. 63-64 | progression transactions | MATCHES SOURCE | Age caps and costs enforced. |
| WP spending on skills/maneuvers | Campaigning, printed p. 64 | progression transactions | MATCHES SOURCE | Current prerequisites and caps enforced. |
| Post-creation Fame | Campaigning, printed p. 64 | campaign Fame logic | MATCHES SOURCE | Does not convert to WP after creation. |
| Monthly ratings | Campaigning, printed pp. 64-66 | campaign month finalization | MATCHES SOURCE | Rating table and prior-rank handling implemented. |
| Ratings sheet ranking | Campaigning, printed p. 66 | campaign ranking tables | MATCHES SOURCE | Deterministic tiebreak adjudication recorded in GDD/implementation. |
| Title shots | Campaigning, printed pp. 66-67 | campaign title-shot transaction | MATCHES SOURCE | Roll/modifier/traversal flow implemented. |
| ASWF title obligations | Campaigning, printed pp. 67-69 | campaign titles | MATCHES SOURCE | World, International, TV, World Tag, American Tag represented. |
| Team WP comparison | Campaigning/tag awards | campaign progression | MATCHES SOURCE | Team-average comparison; each member gets full award. |
| Printed example profiles | Appendix, printed pp. 77-90 / PDF 78-91 | `official-roster.ts` | SOURCE AMBIGUITY | Playable source profiles; three printed TOTAL WP rows do not recompute from maneuver-chart costs. |
| Leglock chart cost | Holds chart, printed p. 39 | `MANEUVERS.leglock` | SOURCE AMBIGUITY | Chart says 7; Tom Landers/Gibson Williams profile arithmetic implies 8 per level. Chart remains authoritative. |
| Leg Scissors chart cost | Holds chart, printed p. 39 | `MANEUVERS.leg-scissors` | SOURCE AMBIGUITY | Chart says 6; Keith Austin profile arithmetic implies 7 per level. Chart remains authoritative. |
| Seeded virtual dice | No 1991 digital equivalent | `prng.ts` | DIGITAL EXTENSION | Preserves source die probabilities and enables replay. |
| Solo AI | No 1991 solo-AI rules | `ai.ts` | DIGITAL EXTENSION | Fair AI changes decisions only, never dice odds. |
| Deterministic replay/hashes | No 1991 digital equivalent | replay/hash modules | DIGITAL EXTENSION | QA/save integrity feature. |
| Save migration/autosave | No 1991 digital equivalent | serialization/save modules | DIGITAL EXTENSION | Digital persistence only. |
| Cage/Ladder extensions | Not part of core 1991 rules used by baseline | M11 match-type modules | DIGITAL EXTENSION | Optional, separately labeled. |
| Contracts/finance | No source subsystem | M12 campaign extension | DIGITAL EXTENSION | Optional, separately labeled. |
| Feuds/booking | No mechanical source subsystem | M13 campaign extension | DIGITAL EXTENSION | Optional, separately labeled. |
| Campaign AI renewal/negotiation | No source subsystem | M12 extension | DIGITAL EXTENSION | Optional, separately labeled. |
| Advertisements / feedback form / blank player sheets | Appendix/non-rules pages | none | NOT APPLICABLE | No gameplay behavior to implement. |

## Source ambiguities

### A-1991-01 — Leglock printed-profile cost mismatch

The Holds chart lists Leglock at **7 WP per level**. Tom Landers and Gibson Williams have printed profile arithmetic that is consistent with **8 WP per level**. Ringcraft preserves the chart cost of 7 and preserves each profile's printed TOTAL WP as source metadata. The mismatch is not used to invalidate either profile.

### A-1991-02 — Leg Scissors printed-profile cost mismatch

The Holds chart lists Leg Scissors at **6 WP per level**. Keith Austin's printed profile arithmetic is consistent with **7 WP per level**. Ringcraft preserves the chart cost of 6 and the printed profile TOTAL WP.

### Resolved question R-1991-01 — apparent MIN TECH conflicts

Resolved as a label/interpretation issue, not a source contradiction. Piledriver, Press & Slam and Bearhug Suplex are **Strikes**; their printed minimum column is MIN POW. Holds use MIN TEC. No official profile requires an exception under the correctly interpreted rule.

## Core-versus-extension boundary

Normal 1991 Exhibition uses the printed source profiles and the manual-derived rules. Career creation/progression uses complete records that can safely carry source-required creation history. Optional finance/contracts, feud/booking, and later match-type features are Ringcraft digital extensions and must not be presented as original 1991 rules.

## Audit result

No new confirmed core-rule implementation defect was found while adjudicating the official roster. The previously corrected engine transition guards (empty bonus attack, referee-unavailable pin, Hold released before automatic submission) remain consistent with source legality. The outstanding source issues are documentary arithmetic contradictions in three printed profiles, not reasons to invent new costs.
