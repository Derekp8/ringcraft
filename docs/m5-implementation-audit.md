# M5 implementation audit — Career and Persistence

## Verdict

Project Ringcraft 1.2.0 is a runnable **M5 Freebuff handoff candidate**. The retained M0–M4 behavior, new event-sourced career core, durable save/recovery boundary, full-engine match integration, deterministic fixtures, build, and browser visual checks pass. This is not a public release or formal source-perfect acceptance; independent second-human transcription and adjudication sign-off remain pending.

## Baseline confirmation

The supplied M4 archive `asw91-project-ringcraft-m4-candidate-1.1.0.zip` matched SHA-256 `4abe06697a4bfcad2a4f8dbc5649008278af1924b860a90e49b70442664551d0`, passed archive integrity, installed from its lockfile, passed 61/61 tests and production build, and passed its visual-QA script before M5 edits.

Manual page images—not OCR alone—were inspected for the M5 charts: Critical Hold on PDF page 60, Ratings on page 66, the ratings/defense/title-shot procedure on page 67, and title-shot modifiers/higher-title vacancy on page 68. Audited GDD Sections 16.1–16.6 were checked on PDF pages 29–31.

## Delivered architecture

| Area | Delivery | Verification |
|---|---|---|
| Versioned rules | `campaign-rules.ts`, `classic-1991-m5-v1`, pinned data hash | exhaustive chart/mapping assertions |
| State/schema | campaign, ranking, title, schedule, team, injury, vacancy, offer, AI decision, event types | creation/state validation and save fixtures |
| Transactions | immutable clone/validate/commit with intent, dice, detail/formulas, pre/post hash | rollback, post-hash, year campaigns |
| Calendar/scheduling | explicit date advancement, availability, booking and defense reservation, begin/checkpoint/commit | schedule/injury/stripping/year tests |
| Ratings/titles | exact RP, prior-rank, D6 tie, guarantees, shots, obligations, hierarchy, vacancies | focused M5 tests and long careers |
| Match integration | player and headless matches share the full retained engine | exactly-once test and 77 replay checks |
| Progression | automatic WP/Fame/result application; atomic in-career spending | result integration plus retained M4 progression tests |
| Persistence | autosave, three slots, JSON export/import, initial migration registry, recovery | canonical tests and deterministic fixtures |
| UI/accessibility | setup, batch roster import, offers/scouting, career dashboard/match/result/progression/saves/log filter | Chromium desktop/narrow/accessibility/recovery QA |

## Final local acceptance results

Command sequence:

```bash
npm ci
npm run check
npm run fixtures:verify
npm run visual:qa
```

Results before packaging:

- 3 test files passed; **84/84 tests passed** in 59.30 seconds reported by the final pre-package Vitest run.
- 61 retained M0–M4 tests remained green; 23 M5 tests were added.
- TypeScript project compilation passed.
- Vite 8.2.1 production build passed: 32 modules; main JavaScript 385.65 kB (114.38 kB gzip), CSS 19.51 kB (4.99 kB gzip).
- Fixture verification loaded the completed save, reproduced match hash `c14n-fnv1a64-v1:b5cc3ccccd2e25ee`, loaded the in-progress save, applied two deterministic player-policy inputs, and committed continued campaign hash `c14n-fnv1a64-v1:bd2c470ca5bf286a`.
- Browser visual QA passed exhibition, creator, progression, career setup/dashboard/offer/match/recovery, Rules Lab, narrow, large-text/high-contrast/reduced-motion, and accessibility profiles.

The first clean-room archive extraction installed 74 packages from the lockfile, passed 84/84 tests in 40.51 seconds, reproduced the same build sizes and fixture hashes, and passed the complete visual suite. The final packaging pass changes documentation/manifest bytes only and repeats archive integrity plus clean-room verification before delivery.

## Twelve-month adversarial matrix

Both policies completed 365 explicit calendar-day transactions and resolved mandatory defenses through the same full match engine. A canonical save/export/import checkpoint ran at all 12 month changes per career.

| Metric | Solo | Tag | Total |
|---|---:|---:|---:|
| Calendar days | 365 | 365 | 730 |
| Campaign events | 478 | 562 | 1,040 |
| Scheduled/completed matches | 28/28 | 49/49 | 77/77 |
| Replay checks | 28 | 49 | 77 |
| Monthly save/reload checkpoints | 12 | 12 | 24 |
| Historical ranking tables | 24 | 24 | 48 |
| Title changes | 3 | 3 | 6 |
| Stripping events | 5 | 4 | 9 |
| Final active injuries | 0 | 0 | 0 |
| Pin / submission / DQ / countout / time draw | 3 / 0 / 0 / 0 / 25 | 3 / 0 / 0 / 0 / 46 | 6 / 0 / 0 / 0 / 71 |
| Final canonical hash | `c14n-fnv1a64-v1:af6ff3ca602fc41a` | `c14n-fnv1a64-v1:a4635a8085b77a8c` | — |

Critical Hold injury reachability is covered separately with a forced result-100 path: the inherited six-week layoff remained present alongside automatic submission, blocked scheduling through the recorded date, and restored eligibility on the exact return date. The matrix is correctness/reachability evidence, not balance or pacing evidence.

## Defects found and corrected during M5

| Defect | Correction | Regression evidence |
|---|---|---|
| Headless resolution used a chooser that refused the match's player-owned side | extracted one transparent legal-action scoring policy independent of UI ownership | full headless year careers and replays |
| Campaign hash treated in-memory `undefined` differently from JSON persistence | normalized campaign identity to durable JSON semantics; canonical arrays use `null`, object keys omit undefined | byte/canonical round trip and monthly reloads |
| Recovered intent object key order could fail legality comparison | replaced property-order-sensitive string equality with canonical semantic comparison in validator and engine | stored replay checks and fixture recovery |
| Completed saves duplicated full final match states | retained compact replay config/input/expected-hash contract | 77 replay checks and example replay |
| Vacancy scheduling linked match IDs after the transaction hash | moved competition linkage inside the scheduling transaction | ranked/tournament post-state hash assertions |
| Visual offer test chose an initial champion and therefore had no legal optional Decline action | made the demo player a non-champion; retained mandatory-offer behavior for champions | visual QA now traverses decline, accept, match, checkpoint, reload |

## Correctness risks and external gates

No unresolved manual/GDD contradiction was found that blocks M5. The principal external risk remains the absence of an independent page-by-page table transcription comparison and signed adjudication review. Automated tests and this implementation audit do not replace that work.

Browser local-storage durability/quota varies by profile and vendor, so exported JSON remains the private backup boundary. FNV-1a campaign/match hashes detect deterministic drift but are not security signatures. Source rights work is intentionally outside this private M5 milestone and is not treated as a blocker.

## Deferred M6/private polish

M6 may begin with presentation and orientation around the verified M5 loop: tutorial/onboarding copy, clearer month-end and post-match summaries, audiovisual identity, accessibility audit with assistive technology, and private playtest instrumentation that does not alter rules or dice. Balance/pacing changes, public distribution, accounts/cloud sync, installers, platform certification, and commercial work remain outside this handoff.
