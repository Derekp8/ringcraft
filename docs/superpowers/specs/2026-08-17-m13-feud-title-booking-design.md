# M13 Design Spec — Feuds and Title Booking Layer

**Milestone:** M13 · **Status:** Candidate · **Date:** 2026-08-17
**Precedent:** M10 (AI difficulty), M11 (match variety), M12 (contracts/finance) — versioned, opt-in campaign extensions that keep the default policy byte-identical.

## 1. Goal

Add a feud-and-title-booking layer to the campaign core:

- **Rivalries (feuds)** — roster-level rival pairs with a deterministic 0–100 heat track, driven by the official results of their matches (no dice).
- **Title-shot gating by popularity and ranking** — extend the M12-ADJ-04 popularity floor/heat-term machinery with a feud term: a candidate in an active feud with the title holder is the hotter draw and gains a deterministic title-shot bonus, while the ranking-start and popularity-floor gates stay authoritative.
- **Deterministic month-end booking suggestions** — a pure, state-derived booking card generated at month-end finalization: required title defenses first, then the player's hottest feud rival, then the most-popular available ranked opponent (the M12-ADJ-04 draw rule). Suggestions are advisory state, never auto-scheduled matches.

All three mechanics live in the campaign core (types, rules, transactions), are fully deterministic (derived from campaign state and official match results, **zero new dice**), and are **opt-in**: a campaign that never enables the extension hashes byte-identically to today.

## 2. Source-faithfulness adjudication

Verified authority chain (manual → audited GDD → implementation):

- The 1991 manual has **no feud, rivalry, heat, or booking mechanics** — only flavor prose about storylines and draws.
- The audited GDD (18.x) likewise defines no such subsystem.

Therefore this milestone is a **documented product decision adding digital-only rules** with the same extension pattern as M10-ADJ / M11-ADJ / M12-ADJ. Recorded as **M13-ADJ-01** (feuds and heat), **M13-ADJ-02** (month-end booking suggestions), **M13-ADJ-03** (feud title-shot term) in `docs/adjudication-register.md`. All formulas below are digital-only and never folded into `M5_DATA_HASH`.

## 3. Extension surface

### 3.1 Policy flag

```ts
type BookingPolicy = "feuds";                 // only enabled value
const BOOKING_POLICY_VERSION = "classic-1991-feud-booking-v1";
```

Campaign state gains three optional fields (absent ⇔ extension off, hashes exactly like pre-M13):

```ts
bookingPolicy?: BookingPolicy;      // "feuds" when enabled
bookingVersion?: string;            // BOOKING_POLICY_VERSION when enabled
booking?: BookingState;             // feud ledger + suggestions, present iff enabled
```

Campaign config gains the matching inputs:

```ts
bookingPolicy?: BookingPolicy;
feuds?: Array<{ entrantIds: [string, string]; label?: string; initialHeat?: number }>;
```

### 3.2 Booking state

```ts
interface BookingState {
  policyVersion: string;
  feuds: Feud[];                            // active + cooling rivalries
  feudHistory: FeudHeatMovement[];          // dated heat movements
  monthSuggestions: MonthBookingSuggestion[]; // one card per finalized month
}

interface Feud {
  id: string;                               // stableId("feud", …)
  entrantIds: [CampaignEntrantId, CampaignEntrantId];
  label: string;                            // e.g. "red-hot grudge"
  heat: number;                             // 0..100, deterministic
  status: "active" | "cooling";             // cooling = heat below the cooling threshold
  startedAt: string;                        // feud start date (config → startDate)
  lastMatchDate: string | null;             // last feud match's commit date
  matchCount: number;                       // feud matches completed
}

interface FeudHeatMovement {
  date: string;
  feudId: string;
  delta: number;
  from: number;
  to: number;
  reason: string;                           // "win", "loss", "draw", "dq", "title", "monthly-decay"
  matchId?: string;                         // present when driven by a committed match
}

interface MonthBookingSuggestion {
  month: string;                            // YYYY-MM
  playerEntrantId: CampaignEntrantId;
  items: Array<{
    priority: number;                       // 1 = top of the card
    kind: "required-defense" | "feud" | "optional";
    opponentId: CampaignEntrantId;
    titleId?: CampaignTitleId;              // present for required-defense
    feudId?: string;                        // present for feud items
    basis: string;                          // human-readable reason
  }>;
}
```

## 4. Mechanics

### 4.1 Feuds and heat

- **Creation:** `config.feuds` are created at `startDate` with `heat = initialHeat ?? 50`, clamped to `[0, 100]`, status `active`. Feud IDs derive from the entrant pair so the pair is unique per campaign.
- **New feud:** `startFeud(state, entrantIds, { label?, initialHeat? })` transaction — validates both entrants exist, are not the same entrant, are **the same entrant kind** (both wrestlers or both tag teams; M13-ADJ-04), and are not already feuding; no dice consumed.
- **Heat movement:** applied in `commitScheduledMatchResult` when the two entrants of a feud faced each other (feud matches; a feud between one entrant and the player's tag team uses the team pair). Deltas are deterministic from the official result — no dice:

| Outcome | Heat delta |
|---|---|
| Win by pin / submission / escape / retrieval | +3 |
| Win by DQ / countout | +5 (screwy finish, hotter) |
| Loss (any method) | +2 |
| Draw (time-limit / double-DQ) | +4 |
| Title match (either result) | +1 extra |

- Clamped to `[0, 100]`; every movement appends to `feudHistory` with the actual `from → to` and the committing match ID. A clamped movement records the clamped `to`.
- **Monthly decay:** at month-end finalization, every feud that had **no match that month** decays by `FEUD_DECAY_TABLE.monthlyDecay = 5` (a cold feud cools). A feud whose heat falls at or below the cooling threshold (`coolingThreshold = 20`) flips to `status: "cooling"`; a cooling feud still decays and can revive on its next match (a match always pushes heat up).
- **Revival:** any completed feud match sets `status: "active"`, `lastMatchDate`, and increments `matchCount` regardless of prior cooling status.

### 4.2 Title-shot gating by popularity and ranking

The M12-ADJ-04 gates stay authoritative and are **unchanged**: candidates must meet the 40 popularity floor (`candidateOrder` filters), the shot roll gains the graded crowd-heat term `floor((pop − 50) / 10)`, and ranking start order is untouched.

M13-ADJ-03 adds one deterministic term on top, present only while the booking extension is on:

- **Feud term:** a candidate in an **active** feud with the title holder gains `FEUD_TITLE_SHOT_TERM` per 20 points of feud heat: `floor(feudHeat / FEUD_TITLE_SHOT_TERM.step) * FEUD_TITLE_SHOT_TERM.bonus`. Default `step = 20`, `bonus = 1` — heat 60 ⇒ +3. The term is recorded in the offer's `modifiers` and the traversal's detail lines, exactly like the popularity heat term.
- **Gating is unchanged:** the feud term never bypasses the ranking start or the popularity floor — it only weights the roll of an already-eligible candidate.

### 4.3 Deterministic month-end booking suggestions

At month-end finalization (inside `advanceCampaignDays`' month-boundary block, after both divisions finalize), a pure booking card is generated for the player entrant and appended to `booking.monthSuggestions`:

1. **Required defense:** if the player holds a title with `completedDefenses + scheduledDefenseCount < requiredDefenses` this month, the top item is that title's mandatory defense (opponent = highest-ranked available contender in the title division, subject to the popularity floor when finance is on, respecting injury/schedule conflicts).
2. **Feud:** the player's highest-heat **active** feud rival (ties break by higher feud heat, then rank, then entrant ID). Opponent availability (injury/schedule) is checked; if the top rival is unavailable, the next-hottest feud rival is tried.
3. **Optional:** otherwise the most-popular available ranked opponent (the M12-ADJ-04 draw rule), or the highest-ranked available opponent when finance is off.

Each item records `priority`, `kind`, `opponentId`, optional `titleId`/`feudId`, and a `basis` line. The card is **advisory state only** — it schedules nothing. The player-facing flow can offer each item via the existing `suggestPlayerMatch` / `scheduleCampaignMatch` path; the suggestion is deterministic state, so a save/reload reproduces the same card byte-identically.

No dice are consumed anywhere in §4.1–§4.3; every value derives from campaign state and official match results, so the replay contract is unchanged.

## 5. Determinism and replay contract

- All values derive from campaign state and official match results — **zero new dice**.
- Extension-off campaigns: `bookingPolicy`/`bookingVersion`/`booking` are `undefined` and `canonicalSerialize` drops them, exactly like `finance` / `aiDifficulty` / `variety`. Every existing save, fixture, corpus hash, and pinned test stays valid. The M13 feud heat, month-end suggestions, and title-shot feud term are **booking-only**, so extension-off title-shot, booking, and month-end rating behavior is byte-identical to pre-amendment.
- Extension-on campaigns: fully replayable; `hashCampaignState` covers the booking ledger, so atomic save/reload round-trips byte-identically (verified by test).
- The match engine is never touched — no replay or fixture impact.

## 6. Validation

`validateCampaignState` additions:

- `bookingPolicy === "feuds"` ⇒ `bookingVersion === BOOKING_POLICY_VERSION` and `booking` present; `booking` object structurally valid (feud IDs unique, entrant pairs reference existing entrants, differ, and are the **same entrant kind** — mixed wrestler-vs-team feuds are rejected (M13-ADJ-04), heat 0–100, `lastMatchDate` a valid date or null, suggestions well-formed with the player entrant and valid opponents).
- `createCampaign` (config `feuds`) and `startFeud` reject a mixed-entrant pair with a targeted error; month-end booking also skips any feud rival that cannot resolve in the player's division, so a hand-edited save fails validation with a clear message instead of crashing mid-finalization.
- Extension off ⇒ `bookingVersion` and `booking` must be `undefined`.

`validateCampaignSave` (serialization) additions: `booking` (when present) is an object; `feuds`, `feudHistory`, `monthSuggestions` are arrays.

## 7. Deliverables

- `src/core/types.ts` — types + optional state/config fields.
- `src/core/campaign-rules.ts` — `BOOKING_POLICY_VERSION`, `FEUD_HEAT_TABLE`, `FEUD_DECAY_TABLE`, `FEUD_TITLE_SHOT_TERM` constants + pure helpers (`feudHeatDelta`, `feudTitleShotTerm`, `feudCoolingThreshold`).
- `src/core/campaign.ts` — `startFeud`, feud wiring in `createCampaign`, `commitScheduledMatchResult`, month-end finalization, `rollTitleShot` feud term, `suggestPlayerMatch` feud preference, validation, summary.
- `src/core/campaign-serialization.ts` — save validation additions.
- `tests/m13-feud-booking.test.ts` — default identity, determinism, heat movement, decay/revival, title-shot feud term, booking suggestions, round trip, validation.
- Docs: adjudication register (M13-ADJ-01/02/03), known-limitations, M13 implementation audit.

## 8. Acceptance

- `npm run check` green; `npm run fixtures:verify` green (M5 + M10 corpus + M10 ruthless-campaign + M11 fixtures + playtest + trend + save determinism + replay documents).
- All 68 manifest pins match the tree after the docs refreshes.
- Extension-off campaign hashes byte-identically to pre-M13 (asserted by the default-identity test over the committed fixtures).
- The booking ledger round-trips atomically (save → load → identical `hashCampaignState`).
