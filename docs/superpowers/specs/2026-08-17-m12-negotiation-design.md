# M12 Amendment Design Spec — Contract Negotiation

**Milestone:** M12 amendment · **Status:** Candidate · **Date:** 2026-08-17
**Precedent:** M12-ADJ-04/05 (M12 amendments), M13 (feud-and-title-booking) — versioned, opt-in campaign extensions that keep the default policy byte-identical.

## 1. Goal

Extend the M12 contracts-and-finance layer with deterministic contract negotiation:

- **Offer/reject flows** — `offerContract(state, wrestlerId, { weeklySalary, termWeeks, signingBonus? })` offers a wrestler a contract and resolves their deterministic response in one transaction (accept → signed immediately; reject → recorded), so the flow is inspectable in the negotiation ledger.
- **Salary curves** — a wrestler's expected weekly salary derives deterministically from their tracked popularity (`SALARY_CURVE`: $100 at popularity 0, +$5 per popularity point, clamped at $1000). Over-performers are worth more; the curve is the single reference for player offers and expiry re-signings.
- **Popularity-driven re-signing** — on the first day a contract is inactive, the expiring wrestler is offered a renewal **at the expiring salary** and responds with the same acceptance rule, so a wrestler who outgrew their deal (popularity up, salary flat) may walk.

All negotiation is deterministic: fair offers (≥ 100% of expectation) auto-accept, low offers (< 60%) auto-reject, and short offers resolve on a **recorded D20** from the campaign's seeded RNG. The ledger stays replayable — every die lands in the transaction's `dice` array like title shots and injury checks — and the extension is **opt-in** (`negotiationPolicy: "offers"`), so campaigns that never enable it hash byte-identically to today.

## 2. Source-faithfulness adjudication

The 1991 manual and audited GDD define **no negotiation, salary, or free-agency mechanics** — contracts, payroll, and popularity are themselves M12-ADJ digital-only inventions. This amendment therefore adds the negotiation layer as a documented product decision with the same extension pattern. Recorded as **M12-ADJ-06** (offer/reject flows), **M12-ADJ-07** (salary curves), **M12-ADJ-08** (popularity-driven re-signing) in `docs/adjudication-register.md`. All formulas are digital-only and never folded into `M5_DATA_HASH` or `FINANCE_TABLE_HASH`.

## 3. Extension surface

### 3.1 Policy flag

```ts
type NegotiationPolicy = "offers";                          // only enabled value
const NEGOTIATION_POLICY_VERSION = "classic-1991-contract-negotiation-v1";
```

Campaign state gains three optional fields (absent ⇔ extension off, hashes exactly like pre-amendment):

```ts
negotiationPolicy?: NegotiationPolicy;      // "offers" when enabled
negotiationVersion?: string;                // NEGOTIATION_POLICY_VERSION when enabled
negotiation?: NegotiationState;             // offer ledger, present iff enabled
```

Campaign config gains:

```ts
negotiationPolicy?: NegotiationPolicy;      // requires financePolicy: "contracts"
```

### 3.2 Negotiation state

```ts
interface NegotiationState {
  policyVersion: string;
  offers: ContractOffer[];                  // every offer, accepted or rejected
  history: NegotiationRecord[];             // dated accept/reject records
}

interface ContractOffer {
  id: string;                               // stableId("contract-offer", …)
  wrestlerId: string;
  weeklySalary: number;
  termWeeks: number;
  signingBonus: number;
  offeredAt: string;
  expectedSalary: number;                   // salary-curve expectation at offer time
  status: "offered" | "accepted" | "rejected";
  reason: "player" | "renewal";             // player offer vs expiry re-signing
  basis: string;                            // verdict, expectation, die when rolled
  resolvedAt?: string;
}

interface NegotiationRecord {
  date: string;
  wrestlerId: string;
  type: "accepted" | "rejected";
  offerId: string;
  weeklySalary: number;
  expectedSalary: number;
  basis: string;
}
```

## 4. Mechanics

### 4.1 Salary curve (M12-ADJ-07)

```ts
const SALARY_CURVE = {
  baseWeekly: 100,          // expected weekly salary at popularity 0
  perPopularityPoint: 5,    // +$5/week per popularity point
  maxWeekly: 1000,          // clamp
};
function expectedWeeklySalary(popularity) {
  return min(maxWeekly, baseWeekly + popularity * perPopularityPoint);
}
```

Popularity 50 (the flat baseline) ⇒ $350/week; 90 ⇒ $550; 100 ⇒ $600. The curve is state-derived, consumes no dice, and is the same reference for player offers and renewals.

### 4.2 Acceptance rule (M12-ADJ-06/08)

Every offer is graded against the wrestler's expectation:

| Verdict | Ratio (offer / expectation) | Resolution |
|---|---|---|
| `fair` | ≥ 100% | auto-accept, **no dice** |
| `short` | 60%–100% | recorded D20; accept if roll ≤ `floor((ratio − 60) / 40 × 20)` |
| `low` | < 60% | auto-reject, **no dice** |

A short offer at 80% of expectation has threshold 10 (50/50 odds); at 70% threshold 5; at 95% threshold 17. The roll is consumed from the campaign's seeded RNG and recorded in the transaction's `dice` array, exactly like title-shot and injury rolls, so the negotiation ledger replays byte-identically.

### 4.3 Offer/reject flow (M12-ADJ-06)

`offerContract(state, wrestlerId, { weeklySalary, termWeeks, signingBonus? })`:

1. Validates: wrestler exists, negotiation on, no active contract for the wrestler, no outstanding offered offer, amounts are positive whole numbers.
2. Computes the expectation from current popularity and grades the offer (4.2).
3. On accept: signs the contract at `currentDate` (signing bonus credited to the ledger and a `weekIndex: 0` payout row, exactly like `signContract`).
4. On reject: records the rejected offer; no contract is created.
5. Pushes the offer and an accept/reject history record with a human-readable `basis` naming the verdict, expectation, and die (when rolled).

### 4.4 Popularity-driven re-signing (M12-ADJ-08)

Inside `advanceCampaignDays`, on the first day a contract is inactive (the day after `startDate + termWeeks*7`), the expiring wrestler is offered a **renewal at the expiring salary** (same term weeks, no signing bonus) and responds with the acceptance rule from 4.2. Because the renewal is always at the old salary:

- a wrestler whose popularity stayed flat or dropped (expectation ≤ old salary) re-signs automatically (`fair`);
- a wrestler who got hot (expectation > old salary) faces a `short` or `low` verdict — a truly over-achieving wrestler **walks** (no contract), and the player must `offerContract` a curve-appropriate deal to keep them.

Renewal offers are marked `reason: "renewal"`; acceptance signs a new contract starting that day, so the payout cadence is unbroken. A rejected renewal leaves the expired contract inert (existing M12 behavior: expired contracts stop paying and no payout record is created for an empty week).

### 4.5 Campaign-AI curve-fair renewal (M12-ADJ-09)

Opt-in `renewalStrategy: "curve-fair"` (requires `negotiationPolicy: "offers"`) turns the expiry renewal into a campaign-AI action: whenever the expiring rate grades **below fair** (`offerVerdict(expiringSalary, expected) !== "fair"` — the wrestler's popularity outgrew their salary), the AI preemptively offers `expectedWeeklySalary(popularity)` instead of the expiring salary, so the wrestler re-signs at the curve instead of walking.

- The bump lands exactly on the fair threshold, so the renewal **auto-accepts and consumes zero dice** — the D20 sequence is untouched, and the next short offer rolls the same die it would have before the amendment.
- Already-fair expiring salaries are offered unchanged, so those renewals are byte-identical to the default strategy.
- The AI action records a detail line naming the curve match, and the offer keeps `reason: "renewal"` with the usual fair-offer basis.
- `"expiring-salary"` (the default) normalizes to an absent `renewalStrategy` field, so unset campaigns hash exactly as before.

## 5. Determinism and replay contract

- Fair/low decisions consume **zero dice**; short decisions consume one recorded D20; a curve-fair AI renewal (M12-ADJ-09) lands on fair and also consumes zero dice. Everything else derives from campaign state (popularity, the curve, official results).
- Extension-off campaigns: `negotiationPolicy`/`negotiationVersion`/`negotiation` are `undefined` and `canonicalSerialize` drops them, exactly like `finance`/`aiDifficulty`/`variety`/`booking`. Every existing save, fixture, corpus hash, and pinned test stays valid — the M12 ledger behavior (payout cadence, expiry, empty-week suppression) is untouched.
- Extension-on campaigns: `hashCampaignState` covers the negotiation ledger, so atomic save/reload round-trips byte-identically (verified by test).
- The match engine is never touched — no replay or fixture impact.

## 6. Validation

`validateCampaignState` additions:

- `negotiationPolicy === "offers"` ⇒ `negotiationVersion === NEGOTIATION_POLICY_VERSION`, `negotiation` present, and `financePolicy === "contracts"` (negotiation needs popularity).
- Extension off ⇒ `negotiationVersion` and `negotiation` must be `undefined`; `renewalStrategy` present without the offers policy (or with an unknown value) is rejected.
- `createCampaign` rejects unknown strategies and `"curve-fair"` without the negotiation extension.
- Ledger structure: unique offer IDs, offers reference existing wrestlers, positive whole salaries/terms, non-negative bonuses, valid status/reason, integer expectation, valid dates.

`validateCampaignSave` (serialization) additions: `negotiation` (when present) is an object with `offers` and `history` arrays.

## 7. Deliverables

- `src/core/types.ts` — `NegotiationPolicy`, `RenewalStrategy`, `ContractOffer`, `NegotiationRecord`, `NegotiationState`, config/state fields.
- `src/core/campaign-rules.ts` — `NEGOTIATION_POLICY_VERSION`, `SALARY_CURVE`, `NEGOTIATION_RULES`, `NEGOTIATION_TABLE_HASH`, `expectedWeeklySalary`, `offerVerdict`, `acceptanceThreshold`.
- `src/core/campaign.ts` — `offerContract`, the shared resolution core, expiry re-signing in `advanceCampaignDays`, `createCampaign` wiring, validation, summary.
- `src/core/campaign-serialization.ts` — save validation additions.
- `tests/m12-negotiation.test.ts` — default identity, curve pins, offer/reject flows, short-offer dice path, popularity-driven re-signing (accept/walk), curve-fair AI renewal (re-sign at curve, zero-dice short bump, already-fair identity, tamper rejection), determinism, round trip, validation.
- Docs: adjudication register (M12-ADJ-06/07/08), known-limitations, M12 implementation audit update.

## 8. Acceptance

- `npm run check` green; `npm run fixtures:verify` green.
- All manifest pins match the tree after the docs refreshes.
- Extension-off campaigns hash byte-identically to pre-amendment (asserted by the default-identity test).
- The negotiation ledger round-trips atomically (save → load → identical `hashCampaignState`).
