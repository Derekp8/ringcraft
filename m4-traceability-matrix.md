# M4 creation and progression traceability matrix

## Authority and review method

The 1991 manual is the rules authority, followed by complete examples and then the audited GDD's explicit adjudications. M4 tables were checked against rendered manual pages covering character creation, maneuver construction, and campaigning. The GDD locations below describe the digital contract and recorded adjudications. This review is one implementation audit and does **not** satisfy the required independent second-human transcription gate.

| Requirement | Manual evidence | GDD evidence | Rules/data structure | Core transaction or validator | UI surface | Automated coverage |
|---|---|---|---|---|---|---|
| 10D10+200 physical pool; 1–100 attributes; exact allocation | Character creation, printed pp. 7–13 | 3.2, 3.8; B.1 | `BASE_CREATION_SKILL_POINTS`; `Attributes` | `createCreationSession`, `setCreationAttributes`, `validateCreationSession` | Creator step 1, assigned/generated/unassigned equation | M4 physical min/max, deterministic pool, exact-spend/finalization tests |
| Attribute AV/DV bands and derived stats | Attribute and secondary-attribute charts, printed pp. 10–13 | 3.2–3.5; C.1–C.3 | `ATTRIBUTE_LOOKUPS`, `BODY_TABLE`, `PHASE_SCHEDULE`, `DAMAGE_BONUS_BANDS` | `baseAv`, `baseDv`, `body`, `startingDamage`, `recoveryModifier`, `activePhases` | Live derived preview | All AV/DV band ends, every BODY cell, DAM PTS/REC/AGI edge tests; retained derived regressions |
| Height/weight and light-heavyweight eligibility | Height/weight chart, printed p. 14 | 3.3, 3.7 | `HEIGHT_WEIGHT_BANDS`, `LIGHT_HEAVYWEIGHT_LIMIT` | `rollCreationStature`, `setCreationStature`, `creationDerivedPreview` | Creator step 2 | All ten bands, extreme rolls, 235/236 eligibility edge |
| Debut age and debut result | Background/debut charts, printed pp. 15–19 | 3.7; B.1; C.4 | `AGE_MODIFIER_BANDS`, `DEBUT_RESULT_BANDS` | `rollCreationHistory` | Creator step 2 and deterministic trace | Young/veteran boundaries, contiguous result bands, dice/formula evidence |
| Previous experience, circuits, titles, age, rerolls | Previous-experience/federation/championship charts, printed pp. 15–19 | 3.7, 3.8; B.1 | `FEDERATION_BANDS`, `CHAMPIONSHIP_BANDS` | `addPreviousExperience` | Add 2 years; history/Fame summary | Two-year increment, contiguous circuit bands, ineligible light-heavyweight reroll |
| Fame and creation-only title points | Title charts and creation rules, printed pp. 15–19 | 3.7–3.8; 16.3 | `TITLE_FAME` | `creationFame`, `creationPointSummary`, finalization | Budget equation and history summary | World-title Fame and +40 creation points; no post-creation conversion test |
| Fan Favorite/Rulebreaker locks | Side and skills, printed pp. 7–8, 35–38 | 3.6; 4.5; 10 | `SPECIAL_SKILLS`; maneuver `illegal` flags | `validateCreationSession`, `setCreationSide` | Creator step 3 and purchase explanations | Illegal purchase rejection; skill cap/side tests; retained untrained proficiency test |
| Drawback parameters and awards | Drawback section, printed pp. 45–47 | 11.1–11.5 | drawback award matrices in `career-rules.ts` | `drawbackAward`, `setCreationDrawback`, duplicate validation | Creator drawback choices and live points | Exhaustive parameter/Pow-band reconciliation; duplicate rejection; progression removal |
| Maneuver ownership, prerequisites, levels, breadth | Maneuver rules/charts, printed pp. 20–42 | 4.1–4.3 | `MANEUVERS`, `maneuverLevels` | `validateCreationSession`, `setCreationManeuverLevel` | Search/filter purchase table | 102 catalog reconciliation retained; side/prerequisite and changing breadth-cap tests |
| Custom Hold/Strike construction and exact cost | Maneuver construction, printed pp. 43–44 | 4.2–4.4 | `ManeuverDraft`, construction limits | `validateManeuverDraft`, `buildCustomManeuver`, `maneuverConstructionCost` | Custom maneuver builder and equation | Valid equation; submission/finisher/illegal/END rejection; JSON round trip |
| Base 150 points and all-points-spent gate | Character creation, printed pp. 7–19 | 3.8 | `BASE_CREATION_SKILL_POINTS` | `creationPointSummary`, `autoAllocateCreationPoints`, `finalizeCreationSession` | Budget/review/finalize | Unspent rejection, exact zero, 48-seed legal-finalization property sweep |
| Match WP formula and zero floor | Campaigning/WP chart, manual PDF pp. 64–65 (printed campaigning pp. 70–71) | 16.1; B.6 | `TITLE_WP_BONUS` | `calculateMatchWp` | Progression award form and formula trace | Win/loss/draw/DQ/countout, zero floor, exact ±50, title qualification |
| Tag WP team-average comparison | Campaigning/WP and tag awards | 13.7; 16.1 | `MatchWpInput` array form | `comparisonWp`, `calculateMatchWp` | Comma-separated team WP entry | Exact average and stronger threshold test |
| Atomic WP spending and age caps | Campaigning/advancement, manual PDF pp. 64–65 | 16.2–16.3 | `ATTRIBUTE_ADVANCEMENT_COSTS`, `AGE_CAPS`, `SPECIAL_SKILLS` | `applyProgression`, complete record revalidation | Attribute/skill/maneuver/drawback panels | Cost, rollback, all age-cap values, TEC exception, cap, replay, schema validation |
| Versioned JSON and reference-roster boundary | Record sheets/import needs | 17.1–17.4; 19 | `WRESTLER_SCHEMA_VERSION` | `validateWrestlerRecord`, `serializeWrestler`, `importWrestlerJson`, `importReferenceRosterJson` | Export; exhibition file import | Round trip, tampering, unsupported schema, reference roster |
| Dynamic singles/tag selection and replay | Match rules; no fixed identity rule | 13; 14; 17.2–17.4 | `RosterRegistry`, open `WrestlerId`, match-local maneuver catalog | `createMatch`, `careerRecordToDefinition`, `replayFromInputLog` | Exhibition roster selectors and temporary tag slots | Created singles/tag initialization, progression-to-match, state/replay identity |
| Deterministic creation/progression trace | Dice and record procedure | 2.2–2.4; 17.4 | `CreationEvent.input/dice`, `ProgressionEvent.intent`, canonical hashes | `replayCreationSession`, `replayProgression` | Expandable creation/progression traces | Full creator and progression replay equality |
| Accessibility and responsive end-to-end flow | Digital implementation requirement | 15.2–15.5; 19 | Semantic React controls and CSS profiles | Core-owned values only | Desktop/narrow, labels, keyboard, large text, contrast, reduced motion | Browser QA across exhibition, creator, progression, Rules Lab, narrow, accessibility |

## Numeric-code audit

M4 source numbers live in `career-rules.ts` or the retained versioned `rules.ts` data pack. React imports definitions and costs for display; it does not own rule numbers or compute legality. Transaction code contains only algorithmic constants intrinsic to the rules operation (for example ten physical dice and two years per experience roll), with the resulting formula recorded in the event trace.

## Gate status

- Implementation review against rendered source pages: complete for this candidate.
- Automated table/formula/runtime/UI coverage: complete for the listed M4 candidate scope.
- Independent second-human transcription and signed adjudication review: unresolved external gate.
- Rights clearance: unresolved external gate.
