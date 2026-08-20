# M12 implementation audit — Contracts and Finances Layer

## Verdict

M12 adds a contracts-and-finances layer to the campaign core: per-wrestler contracts, weekly
payouts on a fixed 7-day cadence, match-driven popularity movement, and roster-level chemistry
pairs, per `docs/superpowers/specs/2026-08-14-m12-contracts-finance-design.md`. The 1991 manual
contains no contract, payroll, popularity, or chemistry mechanics (only flavor prose), and the
audited GDD defines no such subsystem, so the milestone is a documented digital-only extension
recorded in `docs/adjudication-register.md` (M12-ADJ-01/02/03), mirroring the M10-ADJ / M11-ADJ
opt-in extension pattern. **M12-ADJ-04** ("overness gates the marquee") then makes the tracked
popularity stat mechanically matter: a title-shot eligibility floor, a graded crowd-heat roll
term, and popularity-weighted booking suggestions — all finance-only and dice-free.
**M12-ADJ-05** extends chemistry pairs into a deterministic campaign-level bonus: +2 tag rating
points per month at month-end finalization, engine-free. Campaigns that never enable the
extension serialize and hash byte-identically to pre-M12 — every existing save, fixture, replay
hash, and the M10/M11 corpora remain valid.

## Implemented surfaces

| Area | Evidence |
|---|---|
| Policy model | `FinancePolicy = "contracts"` and `FINANCE_POLICY_VERSION = "classic-1991-contracts-finance-v1"`; optional `CampaignState.financePolicy` / `financeVersion` / `finance` — all three `undefined` when off and dropped by `canonicalSerialize`, exactly like `postMatchInjuryPolicy` / `aiDifficulty` / `variety` |
| Finance state | `FinanceState` in `src/core/types.ts`: `nextPayoutDate`, `contracts` (by wrestlerId), `chemistry`, `ledgers`, `payouts`, `popularity`, `popularityHistory`; `WrestlerContract` (weeklySalary > 0, termWeeks >= 1, signingBonus >= 0), `ChemistryPair`, `PayoutRecord`, `PopularityMovement` |
| Rules tables | `PAYOUT_SCHEDULE` (7-day cadence), `POPULARITY_MOVEMENT_TABLE` (clean win +3 / DQ win +1 / clean loss −2 / DQ loss −1 / draw 0, title-match winner +1, chemistry tag-win +1, 0–100 clamp), `TITLE_SHOT_POPULARITY_RULES` (M12-ADJ-04: eligibility floor 40, heat step 10 → `floor((pop−50)/10)` roll term), and `CHEMISTRY_RATING_BONUS` (M12-ADJ-05: +2 tag RP per month) in `src/core/campaign-rules.ts`, with `FINANCE_TABLE_HASH` covering all four tables; `contractActiveOn` pays while `currentDate <= startDate + termWeeks*7`, i.e. exactly `termWeeks` weekly payouts |
| Creation | `createCampaign` builds the ledger when `financePolicy: "contracts"`: config `contracts` signed at `startDate` (signing bonuses credited immediately as `weekIndex: 0` payout rows), config `chemistry` pairs validated (existing wrestlers, distinct members, non-empty label), `nextPayoutDate = startDate + 7`, every roster member's popularity starts at a documented flat **50** |
| Weekly payouts | In `advanceCampaignDays`, each day that reaches `nextPayoutDate` credits every active contract, appends a `PayoutRecord` with per-wrestler entries and totals, and advances `nextPayoutDate += 7`; expired contracts stop paying; no payout record is created for an empty payout week; **zero dice consumed** |
| Popularity movement | In `commitScheduledMatchResult`, after awards/ratings/titles/injuries, both sides' members move by the official result method (`popularityDelta`), title matches add the winner's +1, and history rows record `date / delta / from / to / reason` with clamped `to`; **zero dice consumed** |
| Chemistry | Tag wins where the team's exact two members form a config chemistry pair add the +1 tag-win bonus (reason `chemistry-tag-win`); **M12-ADJ-05** also grants such teams a flat +2 tag RP per month in `finalizeDivision` (finance-only, zero dice, recorded in the month-end detail line, applies whether or not the team competed); chemistry never touches the match engine, so no replay or fixture impact |
| Popularity gates the marquee (M12-ADJ-04) | Finance-only, dice-free mechanics in `src/core/campaign.ts`: `candidateOrder` excludes candidates below the 40 popularity floor (tag teams use the rounded member mean), `rollTitleShot` adds the graded crowd-heat term to the roll and records it in offer `modifiers`/detail lines, and `suggestPlayerMatch` books the most popular available opponent (ties keep rank order); a cold roster fails the traversal with an explicit floor error |
| Transactions | `signContract(state, wrestlerId, { weeklySalary, termWeeks, signingBonus })` — validates wrestler/extension/duplicate/amounts, pays the bonus immediately; events use the standard `transact` event-sourcing envelope (pre/post hashes, dice, detail) |
| Validation | `validateCampaignState` rejects: wrong `financeVersion` for the policy, version/ledger present without the policy, policy without the ledger, unknown wrestlers in contracts/ledgers/popularity, non-whole or out-of-range amounts, popularity outside 0–100; `validateCampaignSave` requires `finance` to be an object when present |
| Summary | `campaignSummary` adds `financePayouts`, `financeLedgerTotal`, and `financePopularity` (player entrant) only when the extension is enabled |
| Determinism | All values derive from campaign state and official match results — no new dice, no wall-clock; `hashCampaignState` covers the finance ledger, so atomic save/reload round-trips byte-identically |

## Verification

- **Full regression gate:** `npm run check` green — 219 pre-M12 tests plus the 14 M12 tests
  (`tests/m12-finance.test.ts`) — and `npm run fixtures:verify` green — M5 pinned hashes, the M10
  corpus, both M11 fixtures, and the M11 playtest balance report (336 replayed matches) all verify.
- **Default identity:** a campaign without `financePolicy` carries no `finance*` fields in state or
  export JSON, `validateCampaignSave` is clean, `campaignSummary` has no finance keys, and the
  round trip is byte-identical; all pre-M12 pinned hashes (fixtures, corpora) replay unchanged.
- **Rules pinning:** the policy version, table hash, cadence, popularity bands/deltas, and the
  `termWeeks`-exact payout boundary are asserted; `contractActiveOn` pays on days 0, 7, 14 for a
  2-week contract and stops on day 15.
- **Payouts:** a 2-week $100 + 3-week $75 contract pair pays signing bonus at creation, $175 on
  weeks 1–2, $75 on week 3, and nothing on week 4 — with ledgers tracked per wrestler.
- **Popularity:** pinned seed-2000 singles (win +3 → 53, loss −2 → 48, both by pin) and the
  pinned seed-7 Television title match (winner `title-match` +4); double-DQ/draw produce no
  movement.
- **Chemistry:** pinned seed-1991 tag match — the chemistry pair on the winning team records
  `chemistry-tag-win` +4 each while the losing non-chemistry team records plain losses.
- **Popularity gates the marquee (M12-ADJ-04):** the rules table and `titleShotPopularityHeat`
  are pinned (floor 40, pop 90 ⇒ +4, pop 30 ⇒ −2); with only the top non-champion over the floor
  the traversal offers exactly that candidate with the heat term in the offer modifiers; a
  completely cold roster throws naming the floor; non-finance campaigns carry no heat term and
  keep rank-order bookings; finance-on bookings prefer a hotter low-ranked opponent over the
  field while flat popularity preserves rank order.
- **Chemistry rating bonus (M12-ADJ-05):** the rules table and `chemistryTagRatingBonus` helper
  are pinned (+2 when enabled and paired, 0 otherwise); a seeded tag campaign advanced across a
  month end finalizes the chemistry team at prior-rank bonus + 2 while the non-pair team stays
  at baseline, the +2 is recorded in the month-end detail line, and the month-end state hash is
  pinned; non-finance tag campaigns finalize without any bonus or detail line.
- **Determinism:** identical seeds produce identical state hashes, popularity histories, and
  payout sequences across advances and headless matches.
- **Round trip:** enabled campaigns serialize → import → serialize byte-identically
  (`verifyCampaignRoundTrip`), preserving `hashCampaignState`.
- **Validation:** tampered popularity (>100), wrong version, orphaned ledger, and missing ledger
  are all rejected with targeted messages.

## M12-ADJ-06/07/08 contract negotiation amendment

An amendment to the M12 layer adds deterministic contract negotiation, per
`docs/superpowers/specs/2026-08-17-m12-negotiation-design.md`:

| Area | Evidence |
|---|---|
| Policy model | `NegotiationPolicy = "offers"` and `NEGOTIATION_POLICY_VERSION = "classic-1991-contract-negotiation-v1"`; optional `CampaignState.negotiationPolicy` / `negotiationVersion` / `negotiation` (all `undefined` when off and dropped by `canonicalSerialize`); config `negotiationPolicy` requires `financePolicy: "contracts"` (rejected at creation and by validation) |
| Negotiation state | `NegotiationState` (`policyVersion`, `offers`, `history`) in `src/core/types.ts`; `ContractOffer` (id, wrestler, terms, offeredAt, `expectedSalary`, status, `reason: "player" | "renewal"`, basis, resolvedAt), `NegotiationRecord` (dated accept/reject rows) |
| Rules tables | `SALARY_CURVE` (base $100/week + $5/popularity point, clamped at $1000), `NEGOTIATION_RULES` (fair ≥ 100%, low < 60%, D20 acceptanceDie), `NEGOTIATION_TABLE_HASH` covering both; pure helpers `expectedWeeklySalary`, `offerVerdict`, `acceptanceThreshold` in `src/core/campaign-rules.ts` |
| Offer/reject flow (M12-ADJ-06) | `offerContract(state, wrestlerId, { weeklySalary, termWeeks, signingBonus? })` validates the wrestler/extension/no-active-contract/no-outstanding-offer/amounts, grades the offer against the curve expectation, and resolves in one transaction: accept signs the contract immediately (bonus credited to the ledger and a `weekIndex: 0` payout row, exactly like `signContract`); reject records the rejected offer. Both paths push the offer and an accept/reject history row with the basis naming verdict, expectation, and die |
| Salary curve (M12-ADJ-07) | `expectedWeeklySalary` derives purely from tracked popularity (50 ⇒ $350, 90 ⇒ $550, 100 ⇒ $600, clamped); the same curve prices player offers and expiry re-signings; zero dice |
| Re-signing (M12-ADJ-08) | In `advanceCampaignDays`, on the first day a contract is inactive (the day after `startDate + termWeeks*7`), the expiring wrestler is offered a renewal **at the expiring salary** (same term, no bonus) and responds with the acceptance rule: fair auto-accepts (payout cadence unbroken), low walks (inert expired contract, no empty-week payout), short rolls the recorded D20 |
| Dice | Only short offers consume the campaign's seeded RNG — one D20 per short decision, recorded in the transaction's `dice` array; fair/low decisions consume nothing |
| Validation | `validateCampaignState` rejects: wrong `negotiationVersion`, version/ledger present without the policy, policy without the ledger, policy without `financePolicy: "contracts"`, duplicate offer IDs, unknown wrestlers, invalid amounts/status/reason/expectation/dates; `validateCampaignSave` requires `negotiation` (when present) to be an object with `offers`/`history` arrays |
| Summary | `campaignSummary` adds `negotiationOffers` and `negotiationAccepted` when the extension is enabled |

Amendment verification: default identity (finance-only campaigns carry no negotiation fields and hash byte-identically); curve/threshold pins (pop 0/30/50/90/100 and the 60%/100% verdict boundaries, threshold 0/5/10/17); fair offer auto-accept with the signing bonus credited and zero dice; low offer auto-reject leaving the wrestler free for a later offer; short offers pinned by seed (seed-1991 D20 11 > 10 rejected, seed-2000 D20 6 ≤ 10 accepted, one recorded die each); renewal paths pinned — cold wrestler (pop 0) re-signs at the expiring salary keeping the payout cadence (two payouts, $200 ledger), baseline (pop 50) and hot (pop 90) wrestlers walk with their expired contracts inert and no empty-week payout, and short renewals (pop 30, $200 vs $250 expectation) resolve by the same pinned dice; determinism, atomic round trip, tamper rejection, and summary counters. All 17 amendment tests (`tests/m12-negotiation.test.ts`) pass alongside the 363-test baseline.

## M12-ADJ-09 curve-fair renewal strategy

A follow-up amendment to the negotiation layer adds an opt-in campaign-AI renewal action, per the
same design spec (`docs/superpowers/specs/2026-08-17-m12-negotiation-design.md` §4.5):

| Area | Evidence |
|---|---|
| Policy model | `RenewalStrategy = "expiring-salary" | "curve-fair"` in `src/core/types.ts`; optional `CampaignState.renewalStrategy` — persisted only as `"curve-fair"` (`"expiring-salary"` normalizes to absent, so unset campaigns hash byte-identically); config `renewalStrategy` requires `negotiationPolicy: "offers"` (rejected at creation and by validation, like the negotiation/finance coupling) |
| AI action (M12-ADJ-09) | In `evaluateContractRenewal` (the M12-ADJ-08 expiry hook), with `renewalStrategy: "curve-fair"` the AI preemptively offers `expectedWeeklySalary(popularity)` whenever the expiring rate grades below fair (`offerVerdict !== "fair"`), so a wrestler whose popularity outgrew their salary re-signs at the curve instead of walking. The bump lands on the fair threshold, so it auto-accepts with zero dice and the D20 sequence is untouched; already-fair expiring salaries are offered unchanged (byte-identical to the default renewal); the AI-action line is recorded in the event detail |
| Dice | The curve-fair bump consumes no dice — a fair offer auto-accepts. The next short offer consumes the same first D20 the pre-amendment renewal would have, pinned at seed-1991 D20 11 |
| Validation | `validateCampaignState` rejects `renewalStrategy` present without the offers policy and unknown strategy values; `createCampaign` rejects unknown strategies and curve-fair without the negotiation extension |

Amendment verification (7 new tests in `tests/m12-negotiation.test.ts`, 17 → 24): default identity
(unset vs explicit `"expiring-salary"` hash byte-identically, neither persists the field); a
pop-90 wrestler on a $300 contract re-signs at the $550 curve expectation with zero dice, a
restarted contract, the AI-action detail line, and the payout cadence at the new rate;
a short-offer renewal (pop 30, $200 vs $250) is bumped to fair instead of rolling, and the next
manual short offer on the same seed consumes D20 11 exactly as if the renewal had never rolled;
an already-fair expiring salary is offered unchanged with no M12-ADJ-09 line; creation rejects
curve-fair without the negotiation extension and unknown strategies; tampered state (orphaned
strategy, invalid value) is rejected; and a curve-fair campaign round-trips byte-identically.

## Remaining external gates

The contracts-and-finance rules are a documented digital-only extension (M12-ADJ-01/02/03/04/05/06/07/08/09,
human sign-off pending like every M4–M11 adjudication). No source transcription is claimed for
the finance layer; independent review of the extension decisions — including the M12-ADJ-04
popularity gate/booking weighting, the M12-ADJ-05 chemistry rating bonus, and the M12-ADJ-06/07/08/09
negotiation amendment (offer/reject flows, the salary curve, popularity-driven re-signing, and the
curve-fair campaign-AI renewal) — remains an external handoff gate.
Popularity is a tracked/moving stat in v1; contracts are not auto-renewed in v1 without the
negotiation extension (renewing means signing again or offering a renewal via the M12-ADJ-06/08
flow), and the negotiation surface has no campaign UI wiring yet (core, tests, and docs only).
