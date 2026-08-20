import {
  advanceUntilPlayerDecision,
  autoAllocateCreationPoints,
  canonicalHash64,
  careerRecordToDefinition,
  chooseDeterministicPolicyAction,
  choosePolicyAction,
  createCreationSession,
  createMatch,
  finalizeCreationSession,
  hashMatchState,
  rollCreationHistory,
  rollCreationStature,
  setCreationIdentity,
  setCreationSide,
  submitPlayerIntent,
} from "../src/core";
import type { AiDifficulty, MatchResult, MatchSetup, MatchState, MatchVariety, WrestlerCareerRecord } from "../src/core";

export const PLAYTEST_BALANCE_SCHEMA = "asw91-playtest-balance-report-v1";
export const PLAYTEST_TIME_LIMIT_MINUTES = 8;
export const PLAYTEST_SEEDS_PER_BATCH = 32;
export const PLAYTEST_TAG_SEEDS = 16;

export interface PlaytestBatchSpec {
  label: string;
  rosterKey: string;
  variety: MatchVariety;
  difficulty: AiDifficulty;
  seeds: number;
  /** For head-to-head batches: the policy difficulty driving the player side (the lower rung of the pair); default "v1". */
  playerSide?: AiDifficulty;
}

/**
 * M10 underdog profiles (extracted from the M10 ladder corpus test so the
 * balance report's difficulty sweep shares the exact roster structure that
 * produces ladder separation): a fast, tough wrestler against a slower,
 * smaller-pool challenger, with the AI always wrestling the weaker profile.
 */
export const UNDERDOG_STRONG = { pow: 60, agi: 62, qui: 55, tec: 58, end: 38 };
export const UNDERDOG_WEAK = { pow: 50, agi: 58, qui: 50, tec: 50, end: 18 };

/**
 * Settled head-to-head equal roster profile: both wrestlers identical at
 * moderate endurance (end 28). The fixture's high-endurance `equal-singles`
 * roster (end 80) grinds competent policies to time-limit draws (31/32 in the
 * probe), so the direct strength-comparison corpus uses this lighter equal
 * roster where matches actually finish and the policy difference shows.
 */
export const H2H_EQUAL_PROFILE = { pow: 62, agi: 60, qui: 55, tec: 58, end: 28 };

/** Roster for one head-to-head match: two identical end-28 wrestlers, the lower
 * rung's policy driving the player side and the higher rung as the engine's AI. */
export function h2hSetup(seed: number): { roster: MatchSetup["roster"]; teamMembers: MatchSetup["teamMembers"] } {
  const a = makeUnderdogRecord(900 + seed, 0);
  const b = makeUnderdogRecord(1100 + seed, 1);
  a.attributes = { ...H2H_EQUAL_PROFILE };
  b.attributes = { ...H2H_EQUAL_PROFILE };
  a.weight = 240;
  b.weight = 240;
  a.heightInches = 74;
  b.heightInches = 74;
  return {
    roster: {
      [a.id]: careerRecordToDefinition(a, a.id, "player"),
      [b.id]: careerRecordToDefinition(b, b.id, "ai"),
    },
    teamMembers: { player: [a.id], ai: [b.id] },
  };
}

/** Builds the match setup for a head-to-head (h2h-equal) batch run. */
export function h2hMatchSetup(spec: PlaytestBatchSpec, seedBase: number, seed: number): MatchSetup {
  const { roster, teamMembers } = h2hSetup(seedBase + seed);
  return {
    seed: seedBase + seed,
    timeLimitMinutes: PLAYTEST_TIME_LIMIT_MINUTES,
    mode: "singles",
    variety: spec.variety === "standard" ? undefined : spec.variety,
    aiDifficulty: spec.difficulty,
    roster,
    teamMembers,
  };
}

export function makeUnderdogRecord(seed: number, index: number): WrestlerCareerRecord {
  let session = createCreationSession(seed);
  session = setCreationIdentity(session, { name: `Ladder Wrestler ${index}`, epithet: "L", affiliation: "M10 Ladder" });
  session = setCreationSide(session, index % 2 ? "rulebreaker" : "fan-favorite");
  session = rollCreationStature(session);
  session = rollCreationHistory(session);
  session = autoAllocateCreationPoints(session);
  const record = finalizeCreationSession(session).finalized!;
  record.attributes = index % 2 ? UNDERDOG_WEAK : UNDERDOG_STRONG;
  record.weight = index % 2 ? 220 : 260;
  record.heightInches = index % 2 ? 71 : 76;
  record.maneuverLevels = { "the-rack": 1, "bear-hug": 1, "piledriver": 1, "shoulder-breaker": 1, "sleeper": 1, "headbutt-flying": 1, "neck-vise": 1 };
  record.customManeuvers = {};
  record.skills = { breakHold: 0, distractReferee: 0, dodge: 0, escapePin: 0, illegalPin: 0, irishWhip: 0, pinInterference: 0, tagTeam: 0, charm: 0 };
  return record;
}

/** Roster map for a single underdog match, mirroring the M10 test's `ladderSetup`. */
export function underdogSetup(seed: number): { roster: MatchSetup["roster"]; teamMembers: MatchSetup["teamMembers"] } {
  const strong = makeUnderdogRecord(500 + seed, 0);
  const weak = makeUnderdogRecord(700 + seed, 1);
  return {
    roster: {
      [strong.id]: careerRecordToDefinition(strong, strong.id, "player"),
      [weak.id]: careerRecordToDefinition(weak, weak.id, "ai"),
    },
    teamMembers: { player: [strong.id], ai: [weak.id] },
  };
}

/** The fixed, ordered batch corpus (batch index derives the seed base). */
export const PLAYTEST_BATCHES: PlaytestBatchSpec[] = [
  { label: "underdog-novice", rosterKey: "m10-underdog", variety: "standard", difficulty: "novice", seeds: PLAYTEST_SEEDS_PER_BATCH },
  { label: "underdog-standard", rosterKey: "m10-underdog", variety: "standard", difficulty: "standard", seeds: PLAYTEST_SEEDS_PER_BATCH },
  { label: "underdog-veteran", rosterKey: "m10-underdog", variety: "standard", difficulty: "veteran", seeds: PLAYTEST_SEEDS_PER_BATCH },
  { label: "underdog-ruthless", rosterKey: "m10-underdog", variety: "standard", difficulty: "ruthless", seeds: PLAYTEST_SEEDS_PER_BATCH },
  { label: "equal-standard", rosterKey: "equal-singles", variety: "standard", difficulty: "standard", seeds: PLAYTEST_SEEDS_PER_BATCH },
  { label: "equal-ruthless", rosterKey: "equal-singles", variety: "standard", difficulty: "ruthless", seeds: PLAYTEST_SEEDS_PER_BATCH },
  { label: "underdog-cage-standard", rosterKey: "dominant-singles", variety: "cage", difficulty: "standard", seeds: PLAYTEST_SEEDS_PER_BATCH },
  { label: "underdog-cage-ruthless", rosterKey: "dominant-singles", variety: "cage", difficulty: "ruthless", seeds: PLAYTEST_SEEDS_PER_BATCH },
  { label: "underdog-ladder-standard", rosterKey: "dominant-singles", variety: "ladder", difficulty: "standard", seeds: PLAYTEST_SEEDS_PER_BATCH },
  { label: "underdog-ladder-ruthless", rosterKey: "dominant-singles", variety: "ladder", difficulty: "ruthless", seeds: PLAYTEST_SEEDS_PER_BATCH },
  { label: "tag-standard", rosterKey: "standard-tag", variety: "standard", difficulty: "standard", seeds: PLAYTEST_TAG_SEEDS },
];

/**
 * Difficulty-vs-difficulty head-to-head corpus: every unordered pair of ladder
 * rungs played on the equal end-28 roster (`h2h-equal`), the LOWER rung driving
 * the player side (via the policy route) and the HIGHER rung as the engine's
 * AI — a direct strength comparison that never routes through the v1 player
 * baseline. Kept separate from `PLAYTEST_BATCHES` so the pacing-trend report
 * (which re-runs the shared corpus across seeded seasons) is unaffected; the
 * balance report plays `ALL_BALANCE_BATCHES`.
 */
export const HEAD_TO_HEAD_BATCHES: PlaytestBatchSpec[] = [
  { label: "h2h-novice-standard", rosterKey: "h2h-equal", variety: "standard", difficulty: "standard", playerSide: "novice", seeds: PLAYTEST_SEEDS_PER_BATCH },
  { label: "h2h-novice-veteran", rosterKey: "h2h-equal", variety: "standard", difficulty: "veteran", playerSide: "novice", seeds: PLAYTEST_SEEDS_PER_BATCH },
  { label: "h2h-novice-ruthless", rosterKey: "h2h-equal", variety: "standard", difficulty: "ruthless", playerSide: "novice", seeds: PLAYTEST_SEEDS_PER_BATCH },
  { label: "h2h-standard-veteran", rosterKey: "h2h-equal", variety: "standard", difficulty: "veteran", playerSide: "standard", seeds: PLAYTEST_SEEDS_PER_BATCH },
  { label: "h2h-standard-ruthless", rosterKey: "h2h-equal", variety: "standard", difficulty: "ruthless", playerSide: "standard", seeds: PLAYTEST_SEEDS_PER_BATCH },
  { label: "h2h-veteran-ruthless", rosterKey: "h2h-equal", variety: "standard", difficulty: "ruthless", playerSide: "veteran", seeds: PLAYTEST_SEEDS_PER_BATCH },
];

/** The balance report's full corpus: the shared batches plus the head-to-head pairs, in seed-base order. */
export const ALL_BALANCE_BATCHES: PlaytestBatchSpec[] = [...PLAYTEST_BATCHES, ...HEAD_TO_HEAD_BATCHES];

export interface BalanceMatchRow {
  seed: number;
  winnerTeam: "player" | "ai" | null;
  method: MatchResult["method"];
  minutes: number;
  ticks: number;
  finalHash: string;
}

export interface BalanceBatch {
  label: string;
  rosterKey: string;
  variety: MatchVariety;
  difficulty: AiDifficulty;
  playerSide: "v1" | AiDifficulty;
  seedBase: number;
  timeLimitMinutes: number;
  matches: BalanceMatchRow[];
}

/** Direct strength-comparison line for one difficulty-vs-difficulty pair on equal rosters. */
export interface HeadToHeadPair {
  higher: AiDifficulty;
  lower: AiDifficulty;
  higherShare: number;
  lowerShare: number;
  drawRate: number;
}

export interface BalanceAnalytics {
  winShare: { byDifficulty: Partial<Record<AiDifficulty, number>>; byBatch: Record<string, number> };
  /**
   * 95% Wilson score intervals around every win share (pure function of the
   * per-seed match outcomes, so the pinned report's bounds re-derive
   * byte-identically in the clean room). Kept separate from `winShare` so the
   * point estimates stay backward-compatible for existing consumers.
   */
  winShareCI: {
    byDifficulty: Partial<Record<AiDifficulty, { lower: number; upper: number }>>;
    byBatch: Record<string, { lower: number; upper: number }>;
  };
  matchLength: { byVariety: Record<MatchVariety, { meanMinutes: number; medianMinutes: number; minMinutes: number; maxMinutes: number; meanTicks: number; drawRate: number }> };
  finishMethods: { byVariety: Record<MatchVariety, Partial<Record<MatchResult["method"], number>>> };
  /** Head-to-head strength comparison per difficulty pair (see `HEAD_TO_HEAD_BATCHES`). */
  headToHead: { byPair: Record<string, HeadToHeadPair> };
}

/**
 * Wilson score interval for a binomial proportion (95% confidence by default):
 * the standard statistical bound for a win share estimated from N seeded
 * matches. Pure and deterministic — a report's intervals re-derive identically
 * on every run, so they are safe for the pinned fixture contract. An empty
 * sample (no decisive matches) carries no information and yields [0, 1].
 */
export function wilsonScoreInterval(wins: number, trials: number, z = 1.96): { lower: number; upper: number } {
  if (trials <= 0) return { lower: 0, upper: 1 };
  const p = wins / trials;
  const denom = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denom;
  const halfWidth = (z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials))) / denom;
  return { lower: Math.max(0, center - halfWidth), upper: Math.min(1, center + halfWidth) };
}

export interface PlaytestBalanceReport {
  schema: typeof PLAYTEST_BALANCE_SCHEMA;
  policy: "asw91-ai-policy-v1";
  ruleset: "classic-1991-vertical-slice";
  timeLimitMinutes: number;
  batches: BalanceBatch[];
  analytics: BalanceAnalytics;
  reportHash: string;
}

export function buildMatchSetup(
  spec: PlaytestBatchSpec,
  rosterKey: string,
  records: WrestlerCareerRecord[],
  seedBase: number,
  seed: number,
): MatchSetup {
  const ids = records.map((record) => record.id);
  const playerIds = ids.length === 4 ? [ids[0], ids[2]] : [ids[0]];
  const aiIds = ids.length === 4 ? [ids[1], ids[3]] : [ids[1]];
  const byId = new Map(records.map((record, index) => [ids[index], record]));
  return {
    seed: seedBase + seed,
    timeLimitMinutes: PLAYTEST_TIME_LIMIT_MINUTES,
    mode: ids.length === 4 ? "tag" : "singles",
    variety: spec.variety === "standard" ? undefined : spec.variety,
    aiDifficulty: spec.difficulty,
    roster: Object.fromEntries([...playerIds.map((id) => [id, careerRecordToDefinition(byId.get(id)!, id, "player")]), ...aiIds.map((id) => [id, careerRecordToDefinition(byId.get(id)!, id, "ai")])]),
    teamMembers: { player: playerIds, ai: aiIds },
  };
}

/**
 * Plays one seeded match headless: player decisions at `playerSide` ("v1" for
 * the fixed baseline, or a policy difficulty for head-to-head pairs) and the
 * AI side at the batch difficulty.
 */
export function playBalanceMatch(setup: MatchSetup, playerSide: "v1" | AiDifficulty = "v1"): MatchState {
  let state = createMatch(setup);
  let guard = 0;
  while (!state.result) {
    guard += 1;
    if (guard > 200_000) throw new Error("Playtest balance match exceeded the decision guard.");
    state = advanceUntilPlayerDecision(state);
    if (state.result) break;
    const decision = state.decision;
    if (!decision) throw new Error("Playtest balance match stalled without a decision.");
    const action = playerSide === "v1" ? chooseDeterministicPolicyAction(state, decision) : choosePolicyAction(state, decision, playerSide);
    state = submitPlayerIntent(state, action.intent);
  }
  if (!state.result) throw new Error("Playtest balance match did not reach a result.");
  return state;
}

export function rowFromState(state: MatchState, seed: number): BalanceMatchRow {
  if (!state.result) throw new Error("Cannot derive a row from a match without a result.");
  return {
    seed,
    winnerTeam: state.result.winnerTeamId,
    method: state.result.method,
    minutes: state.minute,
    ticks: state.tick,
    finalHash: hashMatchState(state),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildAnalytics(batches: BalanceBatch[]): BalanceAnalytics {
  const byDifficulty: Partial<Record<AiDifficulty, number>> = {};
  const byBatch: Record<string, number> = {};
  const ciByDifficulty: Partial<Record<AiDifficulty, { lower: number; upper: number }>> = {};
  const ciByBatch: Record<string, { lower: number; upper: number }> = {};
  const headToHead: Record<string, HeadToHeadPair> = {};
  for (const batch of batches) {
    const decisive = batch.matches.filter((row) => row.winnerTeam !== null);
    const aiWins = decisive.filter((row) => row.winnerTeam === "ai").length;
    byBatch[batch.label] = decisive.length === 0 ? 0 : aiWins / decisive.length;
    ciByBatch[batch.label] = wilsonScoreInterval(aiWins, decisive.length);
    if (batch.label.startsWith("underdog-") && !batch.label.includes("cage") && !batch.label.includes("ladder")) {
      byDifficulty[batch.difficulty] = byBatch[batch.label];
      ciByDifficulty[batch.difficulty] = ciByBatch[batch.label];
    }
    // Head-to-head pairs: the engine's "ai" side is the higher rung, the player
    // side the lower rung, so the higher rung's share is the batch's AI win
    // share on equal rosters.
    if (batch.label.startsWith("h2h-") && batch.playerSide !== "v1") {
      const total = batch.matches.length;
      const draws = batch.matches.filter((row) => row.winnerTeam === null).length;
      const higherWins = aiWins;
      const lowerWins = decisive.length - higherWins;
      headToHead[batch.label] = {
        higher: batch.difficulty,
        lower: batch.playerSide,
        higherShare: decisive.length === 0 ? 0 : higherWins / decisive.length,
        lowerShare: decisive.length === 0 ? 0 : lowerWins / decisive.length,
        drawRate: total === 0 ? 0 : draws / total,
      };
    }
  }
  const byVariety = {} as BalanceAnalytics["matchLength"]["byVariety"];
  const finishMethods = {} as BalanceAnalytics["finishMethods"]["byVariety"];
  for (const variety of ["standard", "cage", "ladder"] as const) {
    // Head-to-head matches are excluded from the pacing/finish analytics so the
    // existing player-vs-AI evidence stays byte-identical; the strength line is
    // the self-contained `headToHead` section.
    const rows = batches.filter((batch) => batch.variety === variety && !batch.label.startsWith("h2h-")).flatMap((batch) => batch.matches);
    const minutes = rows.map((row) => row.minutes);
    const ticks = rows.map((row) => row.ticks);
    byVariety[variety] = {
      meanMinutes: mean(minutes),
      medianMinutes: median(minutes),
      minMinutes: Math.min(...minutes),
      maxMinutes: Math.max(...minutes),
      meanTicks: mean(ticks),
      drawRate: rows.filter((row) => row.method === "time-limit-draw").length / rows.length,
    };
    const counts: Partial<Record<MatchResult["method"], number>> = {};
    for (const row of rows) counts[row.method] = (counts[row.method] ?? 0) + 1;
    finishMethods[variety] = counts;
  }
  return { winShare: { byDifficulty, byBatch }, winShareCI: { byDifficulty: ciByDifficulty, byBatch: ciByBatch }, matchLength: { byVariety }, finishMethods: { byVariety: finishMethods }, headToHead: { byPair: headToHead } };
}

/** Builds the full report by playing every batch match. */
/** Builds the match setup for an underdog (m10-underdog) batch run. */
export function underdogMatchSetup(spec: PlaytestBatchSpec, seedBase: number, seed: number): MatchSetup {
  const { roster, teamMembers } = underdogSetup(seedBase + seed);
  return {
    seed: seedBase + seed,
    timeLimitMinutes: PLAYTEST_TIME_LIMIT_MINUTES,
    mode: "singles",
    variety: spec.variety === "standard" ? undefined : spec.variety,
    aiDifficulty: spec.difficulty,
    roster,
    teamMembers,
  };
}

/** Canonical hash of the report over everything except the reportHash field itself. */
export function reportHash(report: PlaytestBalanceReport): string {
  const { reportHash: _ignored, ...rest } = report;
  return canonicalHash64(rest);
}

/** Re-derives every batch match and returns per-batch verification results. */

