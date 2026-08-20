import { fnv1a32 } from "./hash";
import type { BookingPolicy, CampaignDivision, CampaignTitleId, FinancePolicy, MatchResult, NegotiationPolicy, Side } from "./types";

export const CAMPAIGN_SCHEMA_VERSION = "asw91-campaign-v1" as const;
export const M5_DATA_PACK_VERSION = "classic-1991-m5-v1" as const;
export const CAMPAIGN_RULESET_VERSION = "1.2.0-m5-candidate" as const;

// Optional post-match injury extension. The 1991 manual defines injuries only
// through the match charts (Critical Hold 99/100 and Critical Strike 100 roll a
// 1D6-week layoff; sprains are match-local) and the Old Injury D20 flare-up.
// There is no source between-match injury table, so this is an explicitly
// adjudicated, opt-in campaign extension that reuses the source's D20 check and
// week-duration vocabulary. It is versioned independently and is never folded
// into M5_DATA_HASH, so campaigns that leave it off hash exactly as before.
export const POST_MATCH_INJURY_POLICY_VERSION = "classic-1991-post-match-injury-v1" as const;
export type PostMatchInjuryPolicy = "off" | "d20-check";
export type PostMatchInjurySeverity = "broken-extremity" | "sprain";

export const POST_MATCH_INJURY_TABLE = Object.freeze({
  version: POST_MATCH_INJURY_POLICY_VERSION,
  die: 20,
  eligibility: "participant finished at or below half of the starting damage pool, or was knocked out during the match",
  bands: Object.freeze({
    "broken-extremity": Object.freeze({ roll: 1, weeksDie: 6, weeksText: "1D6 weeks" }),
    sprain: Object.freeze({ rolls: Object.freeze([2, 3]), weeksDie: 6, weeksDivisor: 2, weeksText: "ceil(1D6/2) weeks" }),
  }),
  source: "Manual Critical Hold/Strike layoffs and Old Injury D20 flare-up; between-match check is an adjudicated extension (M10-ADJ).",
});

export const POST_MATCH_INJURY_TABLE_HASH = fnv1a32(POST_MATCH_INJURY_TABLE);

export function postMatchInjuryEligible(damageTaken: number, maxDamage: number, wasKnockedOut: boolean): boolean {
  if (!Number.isFinite(maxDamage) || maxDamage <= 0) throw new Error(`Invalid damage pool ${maxDamage}.`);
  if (!Number.isFinite(damageTaken) || damageTaken < 0) throw new Error(`Invalid damage taken ${damageTaken}.`);
  return wasKnockedOut || damageTaken >= Math.ceil(maxDamage / 2);
}

export function resolvePostMatchInjury(d20: number, d6: number): { severity: PostMatchInjurySeverity; weeks: number } | null {
  if (!Number.isInteger(d20) || d20 < 1 || d20 > 20) throw new Error(`Post-match injury check expects D20 1-20; received ${d20}.`);
  if (!Number.isInteger(d6) || d6 < 1 || d6 > 6) throw new Error(`Post-match injury duration expects D6 1-6; received ${d6}.`);
  if (d20 === 1) return { severity: "broken-extremity", weeks: d6 };
  if (d20 >= 2 && d20 <= 3) return { severity: "sprain", weeks: Math.ceil(d6 / 2) };
  return null;
}

export const RATING_LIMITS = Object.freeze({ singles: 10, tag: 4 } as const);
export const UNRANKED_PRIOR_RANK = Object.freeze({ singles: 11, tag: 5 } as const);
export const PREVIOUS_RANK_BASE = Object.freeze({ singles: 10, tag: 4 } as const);

export type RatingResultKind = "win-pin-submission" | "win-dq-countout" | "loss" | "time-limit-draw" | "double-disqualification";

export const MONTHLY_RATING_POINTS: Readonly<Record<RatingResultKind, Readonly<{ higher: number; lower: number }>>> = Object.freeze({
  "win-pin-submission": Object.freeze({ higher: 3, lower: 2 }),
  "win-dq-countout": Object.freeze({ higher: 2, lower: 1 }),
  loss: Object.freeze({ higher: -1, lower: -2 }),
  "time-limit-draw": Object.freeze({ higher: 1, lower: 1 }),
  "double-disqualification": Object.freeze({ higher: 0, lower: 0 }),
});

export interface CampaignTitleDefinition {
  id: CampaignTitleId;
  name: string;
  division: CampaignDivision;
  hierarchy: number;
  shotDieSides: 6 | 10;
  startingRank: "world" | "international" | "television" | "world-tag" | "american-tag";
  matchTitleModifier: 1 | 3 | 5;
  fame: number;
  wpCategory: "world-heavyweight" | "international" | "world-tag" | "american-tag" | "television";
}

export const CAMPAIGN_TITLES: Readonly<Record<CampaignTitleId, CampaignTitleDefinition>> = Object.freeze({
  "world-heavyweight": Object.freeze({ id: "world-heavyweight", name: "World Heavyweight", division: "singles", hierarchy: 3, shotDieSides: 10, startingRank: "world", matchTitleModifier: 5, fame: 4, wpCategory: "world-heavyweight" }),
  international: Object.freeze({ id: "international", name: "International", division: "singles", hierarchy: 2, shotDieSides: 10, startingRank: "international", matchTitleModifier: 3, fame: 2, wpCategory: "international" }),
  television: Object.freeze({ id: "television", name: "Television", division: "singles", hierarchy: 1, shotDieSides: 10, startingRank: "television", matchTitleModifier: 1, fame: 2, wpCategory: "television" }),
  "world-tag": Object.freeze({ id: "world-tag", name: "World Tag", division: "tag", hierarchy: 2, shotDieSides: 6, startingRank: "world-tag", matchTitleModifier: 3, fame: 3, wpCategory: "world-tag" }),
  "american-tag": Object.freeze({ id: "american-tag", name: "American Tag", division: "tag", hierarchy: 1, shotDieSides: 6, startingRank: "american-tag", matchTitleModifier: 1, fame: 1, wpCategory: "american-tag" }),
});

export const TITLE_SHOT_MODIFIERS = Object.freeze({
  sameSide: Object.freeze({ singles: -6, tag: -3 }),
  priorShot: Object.freeze({ "world-heavyweight": -3, international: -2, television: -1, "world-tag": -2, "american-tag": -1 } as const),
  heldTitle: Object.freeze({ international: -2, television: -1, "american-tag": -1 } as const),
});

export function requiredDefensesForRoll(d6: number): number {
  if (!Number.isInteger(d6) || d6 < 1 || d6 > 6) throw new Error(`Defense requirement expects D6 1-6; received ${d6}.`);
  return Math.ceil(d6 / 2);
}

export function previousRankBonus(division: CampaignDivision, priorRank: number): number {
  const normalized = priorRank === 0 ? 0 : priorRank;
  if (!Number.isInteger(normalized) || normalized < 0) throw new Error(`Invalid ${division} prior rank ${priorRank}.`);
  return Math.max(0, PREVIOUS_RANK_BASE[division] - normalized);
}

export function ratingResultKind(result: MatchResult, entrantWon: boolean | null): RatingResultKind {
  if (result.method === "time-limit-draw") return "time-limit-draw";
  if (entrantWon === null) return "double-disqualification";
  if (!entrantWon) return "loss";
  if (result.method === "pin" || result.method === "submission" || result.method === "escape" || result.method === "retrieval") return "win-pin-submission";
  return "win-dq-countout";
}

export function ratingPoints(kind: RatingResultKind, opponentIsHigher: boolean): number {
  const row = MONTHLY_RATING_POINTS[kind];
  return opponentIsHigher ? row.higher : row.lower;
}

/**
 * Titles change hands only by pin or submission. Escape and retrieval (M11
 * cage/ladder finishes) keep the title with the champion while still counting
 * as a title defense, mirroring the M5-ADJ-06 precedent for DQ and countout
 * finishes. This is the canonical campaign rule for title matches; the match
 * result itself is unaffected by the stake.
 */
export function titleCanChangeOnMethod(method: MatchResult["method"]): boolean {
  return method === "pin" || method === "submission";
}

export function titleShotStartingRank(titleId: CampaignTitleId, championRank: number | null): number {
  if (titleId === "world-heavyweight" || titleId === "world-tag") return 1;
  if (titleId === "international" || titleId === "american-tag") return 2;
  return championRank === 10 ? 2 : Math.min(10, Math.max(2, (championRank ?? 1) + 1));
}

export function titleShotModifier(
  titleId: CampaignTitleId,
  division: CampaignDivision,
  candidateSide: Side,
  championSide: Side,
  alreadyReceivedShot: boolean,
  heldTitles: CampaignTitleId[],
): { total: number; terms: Array<{ label: string; amount: number }> } {
  const terms: Array<{ label: string; amount: number }> = [];
  if (candidateSide === championSide) terms.push({ label: `same side (${division})`, amount: TITLE_SHOT_MODIFIERS.sameSide[division] });
  if (alreadyReceivedShot) terms.push({ label: `already received ${titleId} shot`, amount: TITLE_SHOT_MODIFIERS.priorShot[titleId] });
  for (const held of heldTitles) {
    if (held === "international") terms.push({ label: "already holds International", amount: TITLE_SHOT_MODIFIERS.heldTitle.international });
    else if (held === "television") terms.push({ label: "already holds Television", amount: TITLE_SHOT_MODIFIERS.heldTitle.television });
    else if (held === "american-tag") terms.push({ label: "already holds American Tag", amount: TITLE_SHOT_MODIFIERS.heldTitle["american-tag"] });
  }
  return { total: terms.reduce((sum, row) => sum + row.amount, 0), terms };
}

// Optional contracts-and-finance extension (M12). The 1991 manual defines no
// contract, payroll, popularity, or chemistry mechanics (only flavor prose), so
// this is an explicitly adjudicated, opt-in campaign extension (M12-ADJ-01/02/03).
// It is versioned independently and never folded into M5_DATA_HASH, so campaigns
// that leave it off hash exactly as before. All values derive from campaign
// state and official match results; the extension consumes no dice.
export const FINANCE_POLICY_VERSION = "classic-1991-contracts-finance-v1" as const;

// Re-exported for convenience; the canonical declaration lives in types.ts.
export type { FinancePolicy };

export const PAYOUT_SCHEDULE = Object.freeze({
  version: FINANCE_POLICY_VERSION,
  cadenceDays: 7,
  source: "Digital-only adjudicated extension (M12-ADJ-01); no source payroll mechanics exist.",
});

export const POPULARITY_MOVEMENT_TABLE = Object.freeze({
  version: FINANCE_POLICY_VERSION,
  scale: Object.freeze({ floor: 0, ceiling: 100 }),
  clean: Object.freeze({ win: 3, loss: -2 }),
  dqCountout: Object.freeze({ win: 1, loss: -1 }),
  draw: 0,
  titleMatchWinnerBonus: 1,
  chemistryTagWinBonus: 1,
  source: "Digital-only adjudicated extension (M12-ADJ-02/03); no source popularity mechanics exist.",
});

/**
 * M12-ADJ-04 ("overness gates the marquee"): when the finance extension is
 * enabled, the tracked popularity stat mechanically weights title-shot
 * eligibility and booking suggestions:
 *  - `eligibilityFloor`: a candidate below this popularity cannot be offered a
 *    title shot (a cold wrestler is not put over for a championship);
 *  - `heatStep` / `heatBonusPerStep`: the shot roll gains a graded "crowd heat"
 *    term of `heatBonusPerStep` per `heatStep` points above/below 50
 *    (`floor((pop - 50) / heatStep) * heatBonusPerStep`), so over performers
 *    convert title shots more easily;
 *  - optional-match bookings prefer the most popular available ranked opponent.
 * The rules apply only while `CampaignState.finance` is present, so campaigns
 * with the extension off hash byte-identically. No dice are consumed — every
 * term derives from already-tracked state.
 */
export const TITLE_SHOT_POPULARITY_RULES = Object.freeze({
  version: "m12-adjudicated-overness-v1",
  eligibilityFloor: 40,
  heatStep: 10,
  heatBonusPerStep: 1,
  source: "Digital-only adjudicated extension (M12-ADJ-04); no source popularity mechanics exist.",
});

/** Graded "crowd heat" term for title-shot rolls: `floor((pop - 50) / heatStep) * heatBonusPerStep`. */
export function titleShotPopularityHeat(pop: number): number {
  return Math.floor((pop - 50) / TITLE_SHOT_POPULARITY_RULES.heatStep) * TITLE_SHOT_POPULARITY_RULES.heatBonusPerStep;
}

/**
 * M12-ADJ-05: chemistry pairs also carry a deterministic campaign-level bonus.
 * A tag team whose exact two members form a chemistry pair gains a flat monthly
 * tag rating-point bonus at month-end finalization (`tagRatedBonus`), on top of
 * the existing tag-win popularity bonus (M12-ADJ-03). The bonus is a roster
 * quality fact — it applies whether or not the team competed that month —
 * derives purely from state, consumes no dice, and never touches the match
 * engine, so replays and pinned hashes are unaffected. It applies only while
 * `CampaignState.finance` is present.
 */
export const CHEMISTRY_RATING_BONUS = Object.freeze({
  version: "m12-adjudicated-chemistry-rating-v1",
  tagRatedBonus: 2,
  source: "Digital-only adjudicated extension (M12-ADJ-05); no source chemistry rating mechanics exist.",
});

/** Monthly tag rating-point bonus for a chemistry-pair team; 0 unless the extension is on and the pair matches. */
export function chemistryTagRatingBonus(enabled: boolean, isChemistryPair: boolean): number {
  return enabled && isChemistryPair ? CHEMISTRY_RATING_BONUS.tagRatedBonus : 0;
}

export const FINANCE_TABLE_HASH = fnv1a32({
  schedule: PAYOUT_SCHEDULE,
  popularity: POPULARITY_MOVEMENT_TABLE,
  titleShotPopularity: TITLE_SHOT_POPULARITY_RULES,
  chemistryRating: CHEMISTRY_RATING_BONUS,
});

function addDaysIso(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * A contract pays while currentDate <= startDate + termWeeks*7, which (given
 * the fixed 7-day payout cadence) is exactly `termWeeks` weekly payouts: a
 * 2-week contract signed on day 0 pays on days 7 and 14, then expires. ISO
 * strings compare lexicographically.
 */
export function contractActiveOn(contract: { startDate: string; termWeeks: number }, currentDate: string): boolean {
  if (!Number.isInteger(contract.termWeeks) || contract.termWeeks < 1) throw new Error(`Contract term must be a positive whole number of weeks; received ${contract.termWeeks}.`);
  return currentDate <= addDaysIso(contract.startDate, contract.termWeeks * 7);
}

export function popularityDelta(
  won: boolean | null,
  method: MatchResult["method"],
  titleMatch: boolean,
  chemistryTagWin: boolean,
): number {
  if (method === "time-limit-draw" || won === null) return POPULARITY_MOVEMENT_TABLE.draw;
  const clean = method === "pin" || method === "submission" || method === "escape" || method === "retrieval";
  const base = clean ? (won ? POPULARITY_MOVEMENT_TABLE.clean.win : POPULARITY_MOVEMENT_TABLE.clean.loss) : won ? POPULARITY_MOVEMENT_TABLE.dqCountout.win : POPULARITY_MOVEMENT_TABLE.dqCountout.loss;
  return base + (won && titleMatch ? POPULARITY_MOVEMENT_TABLE.titleMatchWinnerBonus : 0) + (won && chemistryTagWin ? POPULARITY_MOVEMENT_TABLE.chemistryTagWinBonus : 0);
}

// Optional feud-and-title-booking extension (M13). The 1991 manual and audited
// GDD define no feud, heat, or booking mechanics (only storyline flavor prose),
// so this is an explicitly adjudicated, opt-in campaign extension
// (M13-ADJ-01/02/03). It is versioned independently and never folded into
// M5_DATA_HASH, so campaigns that leave it off hash exactly as before. All
// values derive from campaign state and official match results; the extension
// consumes no dice.
export const BOOKING_POLICY_VERSION = "classic-1991-feud-booking-v1" as const;

// Re-exported for convenience; the canonical declaration lives in types.ts.
export type { BookingPolicy };

export const FEUD_HEAT_TABLE = Object.freeze({
  version: BOOKING_POLICY_VERSION,
  scale: Object.freeze({ floor: 0, ceiling: 100 }),
  clean: Object.freeze({ win: 3 }),
  dqCountoutWin: 5,
  loss: 2,
  draw: 4,
  titleMatchBonus: 1,
  source: "Digital-only adjudicated extension (M13-ADJ-01); no source feud mechanics exist.",
});

export const FEUD_DECAY_TABLE = Object.freeze({
  version: BOOKING_POLICY_VERSION,
  monthlyDecay: 5,
  coolingThreshold: 20,
  source: "Digital-only adjudicated extension (M13-ADJ-01); cold feuds cool, a match always revives.",
});

/**
 * M13-ADJ-03 ("the feud is the draw"): when the booking extension is enabled, a
 * candidate in an active feud with the title holder gains a deterministic
 * title-shot term of `bonus` per `step` points of feud heat
 * (`floor(heat / step) * bonus`), recorded in the offer's modifiers. The term
 * never bypasses the ranking start or the M12-ADJ-04 popularity floor — it only
 * weights the roll of an already-eligible candidate.
 */
export const FEUD_TITLE_SHOT_TERM = Object.freeze({
  version: "m13-adjudicated-feud-term-v1",
  step: 20,
  bonus: 1,
  source: "Digital-only adjudicated extension (M13-ADJ-03); no source feud mechanics exist.",
});

/** Deterministic feud heat delta from an official match result (M13-ADJ-01). */
export function feudHeatDelta(
  won: boolean | null,
  method: MatchResult["method"],
  titleMatch: boolean,
): number {
  if (method === "time-limit-draw" || won === null) return FEUD_HEAT_TABLE.draw;
  const clean = method === "pin" || method === "submission" || method === "escape" || method === "retrieval";
  const base = clean ? (won ? FEUD_HEAT_TABLE.clean.win : FEUD_HEAT_TABLE.loss) : won ? FEUD_HEAT_TABLE.dqCountoutWin : FEUD_HEAT_TABLE.loss;
  return base + (titleMatch ? FEUD_HEAT_TABLE.titleMatchBonus : 0);
}

/** Graded feud title-shot term: `floor(heat / step) * bonus` (M13-ADJ-03). */
export function feudTitleShotTerm(heat: number): number {
  return Math.floor(heat / FEUD_TITLE_SHOT_TERM.step) * FEUD_TITLE_SHOT_TERM.bonus;
}

export const BOOKING_TABLE_HASH = fnv1a32({
  heat: FEUD_HEAT_TABLE,
  decay: FEUD_DECAY_TABLE,
  feudTitleShot: FEUD_TITLE_SHOT_TERM,
});

// Optional contract-negotiation extension (M12 amendment). The 1991 manual and
// audited GDD define no negotiation, salary, or free-agency mechanics, so this
// is an explicitly adjudicated, opt-in amendment to the M12 contracts-and-
// finance extension (M12-ADJ-06/07/08). It is versioned independently and never
// folded into M5_DATA_HASH or FINANCE_TABLE_HASH, so campaigns that leave it off
// hash exactly as before. Offers resolve deterministically from the salary
// curve and the campaign's seeded RNG (short offers consume a recorded D20);
// the ledger stays deterministic and replayable.
export const NEGOTIATION_POLICY_VERSION = "classic-1991-contract-negotiation-v1" as const;

// Re-exported for convenience; the canonical declaration lives in types.ts.
export type { NegotiationPolicy };

/**
 * M12-ADJ-07 ("the salary curve"): a wrestler's expected weekly salary derives
 * deterministically from their tracked popularity — `baseWeekly` at popularity
 * 0 plus `perPopularityPoint` per point, clamped at `maxWeekly`. Over-performers
 * are worth more; the curve is the same reference for player offers and expiry
 * re-signings, so a hot wrestler priced below their curve will not re-sign.
 */
export const SALARY_CURVE = Object.freeze({
  version: "m12-adjudicated-salary-curve-v1",
  baseWeekly: 100,
  perPopularityPoint: 5,
  maxWeekly: 1000,
  source: "Digital-only adjudicated extension (M12-ADJ-07); no source salary mechanics exist.",
});

/** Deterministic expected weekly salary from tracked popularity (M12-ADJ-07). */
export function expectedWeeklySalary(popularity: number): number {
  return Math.min(SALARY_CURVE.maxWeekly, SALARY_CURVE.baseWeekly + popularity * SALARY_CURVE.perPopularityPoint);
}

/**
 * M12-ADJ-06/08 ("offer/reject and re-signing"): every offer is graded against
 * the wrestler's salary-curve expectation. An offer at or above 100% of the
 * expectation is "fair" and auto-accepted (no dice); below 60% it is "low" and
 * auto-rejected; in between it is "short" and resolved by a recorded D20 whose
 * accept threshold scales linearly from 0 at 60% to 20 at 100%
 * (`floor((ratio - low) / (fair - low) * die)`). The same rule drives expiry
 * re-signings, which are always offered at the expiring contract's salary, so a
 * wrestler who outgrew their deal may walk.
 */
export const NEGOTIATION_RULES = Object.freeze({
  version: "m12-adjudicated-negotiation-v1",
  fairThresholdPercent: 100,
  lowThresholdPercent: 60,
  acceptanceDie: 20,
  source: "Digital-only adjudicated extension (M12-ADJ-06/08); no source negotiation mechanics exist.",
});

export const NEGOTIATION_TABLE_HASH = fnv1a32({
  salaryCurve: SALARY_CURVE,
  acceptance: NEGOTIATION_RULES,
});

export type OfferVerdict = "fair" | "short" | "low";

/** Classify an offer against the wrestler's salary-curve expectation (M12-ADJ-08). */
export function offerVerdict(offerWeekly: number, expectedWeekly: number): OfferVerdict {
  if (expectedWeekly <= 0) throw new Error(`Expected weekly salary must be positive; received ${expectedWeekly}.`);
  const ratio = (offerWeekly / expectedWeekly) * 100;
  if (ratio >= NEGOTIATION_RULES.fairThresholdPercent) return "fair";
  if (ratio < NEGOTIATION_RULES.lowThresholdPercent) return "low";
  return "short";
}

/** D20 accept threshold for a short offer; fair/low offers are decided without a roll. */
export function acceptanceThreshold(offerWeekly: number, expectedWeekly: number): number {
  const ratio = (offerWeekly / expectedWeekly) * 100;
  const span = NEGOTIATION_RULES.fairThresholdPercent - NEGOTIATION_RULES.lowThresholdPercent;
  return Math.floor(((ratio - NEGOTIATION_RULES.lowThresholdPercent) / span) * NEGOTIATION_RULES.acceptanceDie);
}

export const M5_DATA_HASH = fnv1a32({
  schema: CAMPAIGN_SCHEMA_VERSION,
  version: M5_DATA_PACK_VERSION,
  ratings: MONTHLY_RATING_POINTS,
  previousRank: PREVIOUS_RANK_BASE,
  unrated: UNRANKED_PRIOR_RANK,
  limits: RATING_LIMITS,
  titles: CAMPAIGN_TITLES,
  titleShotModifiers: TITLE_SHOT_MODIFIERS,
  defenseFormula: "ceil(1D6/2)",
  rollingDefenseDays: 30,
});
