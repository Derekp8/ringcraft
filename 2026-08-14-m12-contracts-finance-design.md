# M12 Design Spec — Contracts and Finances Layer

**Milestone:** M12 · **Status:** Candidate · **Date:** 2026-08-14
**Precedent:** M10 (AI difficulty), M11 (match variety) — versioned, opt-in campaign extensions that keep the default policy byte-identical.

## 1. Goal

Add a contracts-and-finances layer to the campaign core:

- **Per-wrestler contracts** — guaranteed weekly salary, term, and an optional signing bonus.
- **Weekly payouts** — a deterministic 7-day payout cadence that credits every contracted wrestler.
- **Popularity movement** — match-driven popularity deltas on a 0–100 scale.
- **Chemistry pairs** — roster-level pairings that boost tag-team popularity gains.

All four mechanics live in the campaign core (types, rules, transactions), are fully deterministic
(all values derived from campaign state, no wall-clock anywhere), and are **opt-in**: a campaign that
never enables the extension hashes byte-identically to today.

## 2. Source-faithfulness adjudication

Verified authority chain (manual → audited GDD → implementation):

- The 1991 manual has **no contract, payroll, popularity, or chemistry mechanics** — only flavor
  prose about draws, house shows, and storylines.
- The audited GDD (18.x) likewise defines no such subsystem.

Therefore this milestone is a **documented product decision adding digital-only rules** with the
same extension pattern as M10-ADJ / M11-ADJ. Recorded as **M12-ADJ-01** (contracts + weekly
payouts), **M12-ADJ-02** (popularity movement), **M12-ADJ-03** (chemistry pairs) in
`docs/adjudication-register.md`. All formulas below are digital-only and never folded into
`M5_DATA_HASH`.

## 3. Extension surface

### 3.1 Policy flag

```ts
type FinancePolicy = "contracts";          // only enabled value
const FINANCE_POLICY_VERSION = "classic-1991-contracts-finance-v1";
```

Campaign state gains three optional fields (absent ⇔ extension off, hashes exactly like pre-M12):

```ts
financePolicy?: FinancePolicy;      // "contracts" when enabled
financeVersion?: string;            // FINANCE_POLICY_VERSION when enabled
finance?: FinanceState;             // the ledger, present iff enabled
```

Campaign config gains the matching inputs:

```ts
financePolicy?: FinancePolicy;
contracts?: Array<{ wrestlerId: string; weeklySalary: number; termWeeks: number; signingBonus?: number }>;
chemistry?: Array<{ memberIds: [string, string]; label?: string }>;
```

### 3.2 Finance state

```ts
interface FinanceState {
  policyVersion: string;
  nextPayoutDate: string;                          // next 7-day cadence date
  contracts: Record<string, WrestlerContract>;     // by wrestlerId
  chemistry: ChemistryPair[];                      // roster-level pairs
  ledgers: Record<string, number>;                 // lifetime earnings by wrestlerId
  payouts: PayoutRecord[];                         // one row per weekly payout event
  popularity: Record<string, number>;              // current 0..100 by wrestlerId
  popularityHistory: PopularityMovement[];         // dated movement records
}

interface WrestlerContract {
  wrestlerId: string;
  weeklySalary: number;      // > 0, whole dollars
  termWeeks: number;         // whole weeks; term runs from the signing date
  startDate: string;         // contract start (config → campaign startDate)
  signingBonus: number;      // >= 0, paid once at signing
}

interface ChemistryPair {
  memberIds: [string, string];
  label: string;             // free text, e.g. "red-hot tag team"
}

interface PayoutRecord {
  date: string;
  weekIndex: number;         // campaign week number (1-based); 0 = signing-bonus payment
  entries: Array<{ wrestlerId: string; amount: number }>;
  total: number;
}

interface PopularityMovement {
  date: string;
  wrestlerId: string;
  delta: number;
  from: number;
  to: number;
  reason: string;            // "win", "loss", "draw", "chemistry-tag-win", ...
}
```

## 4. Mechanics

### 4.1 Contracts

- **Creation:** `config.contracts` are signed at `startDate` (term runs from `startDate`);
  each contract's `signingBonus` is credited immediately to that wrestler's ledger and recorded
  as a payout entry.
- **Signing:** `signContract(state, wrestlerId, { weeklySalary, termWeeks, signingBonus })`
  transaction — validates the wrestler exists, `weeklySalary > 0`, `termWeeks >= 1`,
  `signingBonus >= 0`; pays the bonus immediately; no dice consumed.
- **Termination:** a contract pays while `currentDate <= startDate + termWeeks*7`, which (given
  the fixed 7-day cadence) is exactly `termWeeks` weekly payouts: a 2-week contract signed on day 0
  pays on days 7 and 14, then expires. Contracts are not auto-renewed in v1; renewing means signing
  again (documented limitation).

### 4.2 Weekly payouts

- Cadence: every **7 days** from `startDate`. `nextPayoutDate` starts at `startDate + 7`.
- In `advanceCampaignDays`, after each day advances, if `currentDate >= nextPayoutDate` and the
  extension is enabled: pay every contracted wrestler whose term is still running, append a
  `PayoutRecord`, credit ledgers, and advance `nextPayoutDate += 7`.
- **No dice consumed** — amounts are deterministic arithmetic. Paying a wrestler on an injury
  layoff still happens (contracts are guaranteed; documented).

### 4.3 Popularity movement

- Every roster member starts at **50** on a 0–100 scale (flat baseline, documented; fame is
  unbounded post-creation so it is deliberately not the source).
- Applied in `commitScheduledMatchResult` (after awards/ratings/titles/injuries), extension on.
- Deltas are deterministic from the official result — no dice:

| Outcome | Delta |
|---|---|
| Win by pin / submission / escape / retrieval | +3 |
| Win by disqualification / countout | +1 |
| Loss by pin / submission / escape / retrieval | −2 |
| Loss by disqualification / countout | −1 |
| Draw (any) | 0 |
| Title match, winner | +1 extra |
| Tag win where both members share a chemistry pair | +1 extra per member |

- Clamped to `[0, 100]`; every movement is appended to `popularityHistory` with the actual
  `from → to` values. A clamped movement records the clamped `to`.

### 4.4 Chemistry pairs

- Roster-level config facts: `[wrestlerIdA, wrestlerIdB]` with a free-text label.
- Effect (v1): both members gain the `chemistry-tag-win` popularity bonus when their tag team
  wins. **M12-ADJ-05:** a tag team whose exact two members form a pair also gains a flat
  **+2 tag rating points per month** at month-end finalization (`CHEMISTRY_RATING_BONUS`), a
  roster-quality fact that applies whether or not the team competed that month (mirroring the
  passive prior-rank bonus). The bonus is finance-only and consumes no dice — the match engine
  is never touched, so **no replay or fixture impact**.
- Chemistry across a team is "shared" when the pair exactly matches the two team members.

### 4.5 Popularity gates the marquee (M12-ADJ-04)

With the extension enabled, the tracked popularity stat mechanically weights title-shot
eligibility and booking suggestions. This is a further digital-only adjudication (the source
still defines no popularity mechanics — see M12-ADJ-02) recorded as **M12-ADJ-04**:

- **Title-shot eligibility floor:** a candidate below **40** popularity is ineligible for a
  title-shot traversal (`candidateOrder` filters them out). A completely cold roster fails the
  traversal with an explicit error naming the floor. Tag teams use the rounded mean of their
  members' popularity.
- **Crowd-heat roll term:** the shot roll gains a graded term of `+1` per full 10 points of
  popularity above 50 (and −1 per 10 below): `floor((pop − 50) / 10)`. Pop 90 ⇒ +4, pop 30 ⇒ −2.
  The term is recorded in the offer's `modifiers` and the traversal's detail lines.
- **Draw booking:** optional-match offers prefer the most popular available ranked opponent
  (ties keep rank order), so the player is booked against the roster's hottest draw.

All three rules apply only while `CampaignState.finance` is present, consume **zero dice**, and
derive purely from already-tracked state, so the replay contract is unchanged.

## 5. Determinism and replay contract

- All values derive from campaign state and the official match results — **zero new dice**.
- Extension-off campaigns: `financePolicy`/`financeVersion`/`finance` are `undefined` and
  `canonicalSerialize` drops them, exactly like `postMatchInjuryPolicy` / `aiDifficulty` /
  `variety`. Every existing save, fixture, corpus hash, and pinned test stays valid. The
  M12-ADJ-04 popularity gate, heat term, draw booking, and the M12-ADJ-05 chemistry rating
  bonus are **finance-only**, so extension-off title-shot, booking, and month-end rating
  behavior is byte-identical to pre-amendment.
- Extension-on campaigns: fully replayable; `hashCampaignState` covers the finance ledger, so
  atomic save/reload round-trips byte-identically (verified by test).

## 6. Validation

`validateCampaignState` additions:

- `financePolicy === "contracts"` ⇒ `financeVersion === FINANCE_POLICY_VERSION` and `finance`
  present; `finance` object structurally valid (ledger keys ⊆ roster, popularity 0–100,
  contracts reference existing wrestlers, payouts well-formed, `nextPayoutDate` valid date).
- Extension off ⇒ `financeVersion` and `finance` must be `undefined`.

`validateCampaignSave` (serialization) additions: `finance` (when present) is an object;
`payouts` and `popularityHistory` are arrays.

## 7. Deliverables

- `src/core/types.ts` — types + optional state/config fields.
- `src/core/campaign-rules.ts` — `FINANCE_POLICY_VERSION`, `POPULARITY_MOVEMENT_TABLE`,
  `PAYOUT_SCHEDULE`, `TITLE_SHOT_POPULARITY_RULES`, `CHEMISTRY_RATING_BONUS` constants + pure
  helpers (`popularityDelta`, `contractActiveOn`, `titleShotPopularityHeat`,
  `chemistryTagRatingBonus`).
- `src/core/campaign.ts` — `signContract`, finance wiring in `createCampaign`,
  `advanceCampaignDays`, `commitScheduledMatchResult`, validation.
- `src/core/campaign-serialization.ts` — save validation additions.
- `tests/m12-finance.test.ts` — default identity, determinism, payouts, popularity,
  chemistry, round trip, validation.
- Docs: adjudication register (M12-ADJ-01/02/03), known-limitations, M12 implementation audit.
