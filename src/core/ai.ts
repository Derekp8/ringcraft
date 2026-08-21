import {
  body,
  charmCheckBonus,
  currentAv,
  currentDv,
  expectedExpression,
  maneuver,
  opponentFor,
  partnerOf,
  poolCurrent,
  poolMaximum,
  purchasedManeuverLevel,
  teamOf,
  nextActiveTick,
  wrestlerDefinition,
} from "./derived";
import { advanceUntilPlayerDecision, resolveDecisionOnce } from "./engine";
import { fnv1a32 } from "./hash";
import { createRng } from "./prng";
import { ESCAPE_DIFFICULTY } from "./types";
import type { AiDifficulty, DecisionState, LegalAction, MatchState, WrestlerId } from "./types";

/**
 * M10 policy table. This is policy configuration, not rules data: it is NOT part
 * of `M5_DATA_HASH` or the match `dataHash`. The difficulty is stored per match
 * configuration, so replays from an older mapping remain reproducible after a
 * version bump.
 */
export const AI_POLICY_VERSION = "asw91-ai-policy-v1";
export const AI_DIFFICULTIES: readonly AiDifficulty[] = ["novice", "standard", "veteran", "ruthless"];

/**
 * User-facing hints for the setup surfaces describing what each ladder level
 * changes in the AI's behavior. This is presentation copy derived from the
 * policy configuration above, not rules data (it is not part of `M5_DATA_HASH`).
 */
export const AI_DIFFICULTY_HINTS: Readonly<Record<AiDifficulty, string>> = {
  novice: "A forgiving opponent that intentionally chooses a suboptimal move — a strategic mistake — while following the same rules and dice as every other level.",
  standard: "The deterministic baseline: a competent opponent that consistently chooses strong legal actions with zero randomness and without changing the rules or dice.",
  veteran: "A stronger 1-ply tactical opponent that considers the likely position after its next move.",
  ruthless: "The toughest 2-ply opponent, weighing its move and your likely reply before committing to a legal action.",
};

/**
 * Maximum number of discarded search clones per top-level AI decision. Exported
 * for the M10 search-hygiene tests to pin the bound the spec requires.
 */
export const AI_SEARCH_CLONE_BUDGET = 40;
/**
 * How strongly the lookahead eval delta refines the v1 score (0 would be pure
 * v1). The 2-ply position models the opponent's response, so its eval is more
 * trustworthy and gets a stronger say than the 1-ply's.
 *
 * Swept 2026-08-15 across the same six seed offsets as the novice rate and the
 * depth-2 blend (0/250/500/650/750/1000, 40 seeds per window): every weight in
 * 0.05-0.30 holds the standard<veteran ordering at every window with a minimum
 * per-window margin of 0.105-0.232 (the 650 window is the thinnest at low
 * weights) and an aggregate margin of 0.300-0.346 — a broad, flat plateau. 0.15
 * is the pinned operating point; the separation test asserts a 0.10 per-window
 * / 0.20 aggregate floor that every swept weight satisfies. (The separation
 * gate runs the pinned operating points at 32 seeds per window since the
 * M10-ADJ-05 trim; the sweep numbers above record the 40-seed methodology used
 * to pick the operating point.)
 */
const LOOKAHEAD_WEIGHT = 0.15;
const LOOKAHEAD_WEIGHT_DEPTH_2 = 0.20;
/** How many opponent candidates the ruthless 2-ply best-response enumeration considers per candidate. */
const SEARCH_RESPONSE_CANDIDATES = 6;
/**
 * Probability (per decision) that `novice` plays a suboptimal action instead of the best.
 *
 * Empirically swept 2026-08-15 across the same seed offsets as the depth-2
 * blend (0/250/500/650/750/1000, 40 seeds per window): 0.30/0.35 form the
 * robust plateau for the novice<standard separation (min per-window margin
 * 0.030/0.029); 0.25 collapses at offset 1000 (margin 0.000, novice ties
 * standard) and 0.40 thins it to 0.006 there; 0.45+ over-hardens the level
 * (aggregate novice share 0.013/0.004 — no longer "forgiving" against the
 * underdog corpus). 0.35 keeps the hint's "roughly one decision in three" and
 * is pinned by the ladder separation test. (The separation gate runs the pinned
 * operating point at 32 seeds per window since the M10-ADJ-05 trim; the sweep
 * numbers above record the 40-seed methodology used to pick the rate.)
 */
export const NOVICE_MISTAKE_RATE = 0.35;

export function aiPolicyLabel(state: MatchState): string {
  return `${AI_POLICY_VERSION} ${state.config.aiDifficulty ?? "standard"}`;
}

function clampProbability(target: number): number {
  return Math.max(0.05, Math.min(0.95, target / 20));
}

/**
 * The events since the last "Recent net damage:" line (or all events if none).
 * Both `eventRecentDamage` and the engine's `recentNetDamage` are tail scans, so
 * a search clone can carry just this slice without changing interior decisions,
 * keeping the lookahead's advance clone proportional to the recent exchange.
 */
function recentDamageTail(events: MatchState["events"]): MatchState["events"] {
  let start = 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].detail.some((candidate) => candidate.startsWith("Recent net damage:"))) {
      start = index;
      break;
    }
  }
  return events.slice(start);
}

function eventRecentDamage(state: MatchState): number {
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const line = state.events[index].detail.find((candidate) => candidate.startsWith("Recent net damage:"));
    if (line) return Number(line.split(":")[1].trim());
  }
  return 0;
}

function scoreAction(state: MatchState, actorId: WrestlerId, action: LegalAction): number {
  const targetId = opponentFor(state, actorId);
  const intent = action.intent;
  if (intent.type === "decline-followup" || intent.type === "decline-interference") return 0;
  if (intent.type === "choose-damage-charm") {
    const target = state.wrestlers[targetId];
    const nearFinish = target.currentDamage <= 12 || target.currentEndurance <= 8;
    return intent.charm * (nearFinish ? 35 : 6) - intent.charm * intent.charm * 2;
  }
  if (intent.type === "escape-hold") {
    const urgency = state.wrestlers[actorId].currentEndurance <= 10 ? 25 : 0;
    return intent.charm * (8 + urgency) - intent.charm * intent.charm * 3;
  }
  if (intent.type === "dodge-commit") {
    if (!intent.dodge) return 8;
    const opponentScheduled = state.phaseQueue.includes(targetId);
    const danger = 1 - state.wrestlers[actorId].currentDamage / poolMaximum(state, actorId, "damage");
    return opponentScheduled ? 20 + danger * 40 + wrestlerDefinition(state, actorId).skills.dodge * 3 : -20;
  }
  if (intent.type === "pin") {
    if (intent.automatic) return 100_000;
    const illegal = intent.illegal ? wrestlerDefinition(state, actorId).skills.illegalPin : 0;
    const recent = eventRecentDamage(state);
    const target = currentAv(state, actorId) + illegal + Math.floor(recent / 10) -
      (currentDv(state, targetId) + wrestlerDefinition(state, targetId).skills.escapePin + state.wrestlers[targetId].currentDamage);
    return clampProbability(target) * 10_000 - (intent.illegal ? 40 + state.referee.cumulativeModifier * 8 : 0);
  }
  if (intent.type === "submission") {
    if (intent.automatic) return 100_000;
    const target = currentAv(state, actorId) + Math.floor(eventRecentDamage(state) / 10) -
      (currentDv(state, targetId) + state.wrestlers[targetId].currentEndurance);
    return clampProbability(target) * 10_000;
  }
  if (intent.type === "cage-escape" || intent.type === "climb-retrieve") {
    // Same target as the engine's check: climb difficulty minus the defender's
    // taken-damage advantage, minus the climber's own taken-damage handicap.
    const defenderTaken = poolMaximum(state, targetId, "damage") - poolCurrent(state, targetId, "damage");
    const actorTaken = poolMaximum(state, actorId, "damage") - poolCurrent(state, actorId, "damage");
    const target = currentAv(state, actorId) + charmCheckBonus(intent.charm, false) - currentDv(state, targetId) - ESCAPE_DIFFICULTY +
      Math.floor(defenderTaken / 10) - Math.floor(actorTaken / 10);
    return clampProbability(target) * 10_000;
  }
  if (intent.type === "set-up-ladder") {
    const selfDamageRatio = state.wrestlers[actorId].currentDamage / poolMaximum(state, actorId, "damage");
    // Attractive when healthy (55) and only more so when beaten down (up to
    // 95): the ladder is the beaten wrestler's escape from the damage war.
    return 55 + (1 - selfDamageRatio) * 40;
  }
  if (intent.type === "knock-ladder") return 45;
  if (intent.type === "recover") {
    const missing = poolMaximum(state, actorId, intent.pool) - poolCurrent(state, actorId, intent.pool);
    const urgency = intent.pool === "endurance" && state.wrestlers[actorId].currentEndurance <= 8 ? 180 : 0;
    const charmCost = intent.charm * 14;
    return missing * 5 + urgency + (intent.charm ? (missing > 20 ? intent.charm * 10 : 0) : 0) - charmCost;
  }
  if (intent.type === "maintain-hold") {
    if (!state.hold) return -Infinity;
    const move = maneuver(state, state.hold.maneuverId);
    const expected = expectedExpression(move.damage) + (move.usesDamageBonus ? 2 : 0);
    const ropeBoost = intent.useRopes ? body(wrestlerDefinition(state, targetId)) * 7 : 0;
    const refRisk = intent.useRopes || move.illegal ? state.referee.level + state.referee.cumulativeModifier : 0;
    return expected * 8 + ropeBoost - move.endCost * 1.5 + (move.submission ? 30 : 0) - refRisk * 2;
  }
  if (intent.type === "attack") {
    const move = maneuver(state, intent.maneuverId);
    const hitTarget = currentAv(state, actorId, true) + (purchasedManeuverLevel(state, actorId, move.id) || -5) - currentDv(state, targetId, true);
    const average = expectedExpression(move.damage) + (move.usesDamageBonus ? 2 : 0) + (intent.useMomentum ? 7 : 0);
    const reduction = move.illegal ? 0 : body(wrestlerDefinition(state, targetId));
    const finish = move.kind === "strike" ? 14 : move.submission ? 20 : 5;
    const illegalRisk = move.illegal ? 18 + state.referee.level * 3 + state.referee.cumulativeModifier * 6 : 0;
    return clampProbability(hitTarget) * Math.max(0, average - reduction) * 8 + finish - move.endCost * 1.4 - illegalRisk;
  }
  if (intent.type === "irish-whip") {
    const move = maneuver(state, intent.strikeManeuverId);
    const skill = wrestlerDefinition(state, actorId).skills.irishWhip || -5;
    const whipChance = clampProbability(currentAv(state, actorId) + skill - currentDv(state, targetId));
    const strikeChance = clampProbability(currentAv(state, actorId) + (purchasedManeuverLevel(state, actorId, move.id) || -5) - currentDv(state, targetId));
    return whipChance * strikeChance * (expectedExpression(move.damage) + 7) * 8 - (3 + move.endCost) * 1.4;
  }
  if (intent.type === "tag") {
    const partner = partnerOf(state, actorId);
    if (!partner) return -Infinity;
    const actorRatio = state.wrestlers[actorId].currentDamage / poolMaximum(state, actorId, "damage");
    const partnerRatio = state.wrestlers[partner].currentDamage / poolMaximum(state, partner, "damage");
    return (partnerRatio - actorRatio) * 180 + (state.wrestlers[actorId].currentEndurance < 10 ? 70 : 0);
  }
  if (intent.type === "double-team") return intent.sequence === "shared-whip" ? 120 : intent.sequence === "hold-strike" ? 105 : 110;
  if (intent.type === "distract-referee") {
    if (state.referee.distractedUntilTick > state.tick) return -40;
    const target = state.wrestlers[targetId];
    const targetDamageRatio = target.currentDamage / poolMaximum(state, targetId, "damage");
    const lateMatchOpportunity = (1 - targetDamageRatio) * 40;
    // An attempt always adds +2 alert even when it fails. Reserve that risk for a
    // genuinely useful late-match double-team window instead of spamming it from
    // the apron whenever no recovery is needed.
    return lateMatchOpportunity - 32 - state.referee.level * 2 - state.referee.cumulativeModifier * 8;
  }
  if (intent.type === "pin-interference") {
    const alertCost = (state.referee.level + state.referee.cumulativeModifier) * 45;
    const pending = state.pendingAction;
    if (pending?.kind === "pin") {
      if (pending.automatic) return 5000 - alertCost;
      const illegalLevels = pending.illegal ? wrestlerDefinition(state, pending.pinnerId).skills.illegalPin : 0;
      const pinTarget = currentAv(state, pending.pinnerId) + illegalLevels + Math.floor(pending.recentDamage / 10) -
        (currentDv(state, pending.defenderId) + wrestlerDefinition(state, pending.defenderId).skills.escapePin + state.wrestlers[pending.defenderId].currentDamage);
      const lossChance = Math.max(0, Math.min(1, pinTarget / 20));
      return lossChance * 1500 - 100 - alertCost;
    }
    if (pending?.kind === "submission") {
      if (pending.automatic) return 5000 - alertCost;
      const submissionTarget = currentAv(state, pending.attackerId) + Math.floor(pending.recentDamage / 10) -
        (currentDv(state, pending.defenderId) + state.wrestlers[pending.defenderId].currentEndurance);
      const lossChance = Math.max(0, Math.min(1, submissionTarget / 20));
      return lossChance * 1500 - 100 - alertCost;
    }
    const partner = state.teams[teamOf(state, actorId)].legalInRingId;
    const exhaustion = 1 - state.wrestlers[partner].currentEndurance / poolMaximum(state, partner, "endurance");
    return exhaustion * 400 - 180 - alertCost;
  }
  if (intent.type === "enter-ring") return 90;
  if (intent.type === "exit-ring") {
    const team = state.teams[teamOf(state, actorId)];
    const deadline = team.exitDeadlineTick ?? state.referee.distractedUntilTick;
    const anotherSafeSlot = team.members.some((id) => id !== actorId && nextActiveTick(state, id) < deadline);
    return deadline - state.tick <= 1 || (!anotherSafeSlot && nextActiveTick(state, actorId) >= deadline) ? 1000 : 35;
  }
  if (intent.type === "reenter") return intent.attackManeuverId ? 60 : 30;
  return -Infinity;
}

export function chooseDeterministicPolicyAction(state: MatchState, decision: DecisionState): LegalAction {
  const scored = decision.actions.map((action) => ({
    action,
    score: scoreAction(state, decision.actorId, action),
    tie: fnv1a32({ seed: state.config.seed, tick: state.tick, actor: decision.actorId, action: action.key }),
  }));
  scored.sort((left, right) => right.score - left.score || left.tie.localeCompare(right.tie));
  const winner = scored[0];
  if (!winner) throw new Error("AI received an empty legal action set.");
  return { ...winner.action, estimatedUtility: winner.score };
}

/**
 * M10 positional evaluation (v2). Pure function of visible match state; never
 * consumes RNG. Values finish proximity (open pin/submission), pool positions,
 * Hold control, referee alertness, and tag position from `actorId`'s perspective.
 */
export function evaluateState(state: MatchState, actorId: WrestlerId): number {
  if (state.result) return state.result.winnerTeamId === teamOf(state, actorId) ? 1_000_000 : -1_000_000;
  const targetId = opponentFor(state, actorId);
  const target = state.wrestlers[targetId];
  const self = state.wrestlers[actorId];
  let value = 0;
  const pending = state.pendingAction;
  if (pending?.kind === "pin") {
    const mine = pending.pinnerId === actorId;
    const winChance = pending.automatic ? 1 : clampProbability(
      currentAv(state, pending.pinnerId) + (pending.illegal ? wrestlerDefinition(state, pending.pinnerId).skills.illegalPin : 0) + Math.floor(pending.recentDamage / 10) -
      (currentDv(state, pending.defenderId) + wrestlerDefinition(state, pending.defenderId).skills.escapePin + state.wrestlers[pending.defenderId].currentDamage),
    );
    value += (mine ? 1 : -1) * winChance * 2_500;
  } else if (pending?.kind === "submission") {
    const mine = pending.attackerId === actorId;
    const winChance = pending.automatic ? 1 : clampProbability(
      currentAv(state, pending.attackerId) + Math.floor(pending.recentDamage / 10) -
      (currentDv(state, pending.defenderId) + state.wrestlers[pending.defenderId].currentEndurance),
    );
    value += (mine ? 1 : -1) * winChance * 2_500;
  }
  const targetDamageRatio = target.currentDamage / poolMaximum(state, targetId, "damage");
  const selfDamageRatio = self.currentDamage / poolMaximum(state, actorId, "damage");
  value += (1 - targetDamageRatio) * 4_000 - (1 - selfDamageRatio) * 4_000;
  const targetEndRatio = target.currentEndurance / poolMaximum(state, targetId, "endurance");
  const selfEndRatio = self.currentEndurance / poolMaximum(state, actorId, "endurance");
  value += (1 - targetEndRatio) * 2_000 - (1 - selfEndRatio) * 2_000;
  // Counter-threat: the opponent's best purchased-move expected net damage against me.
  let threat = 0;
  for (const [moveId, level] of Object.entries(wrestlerDefinition(state, targetId).maneuverLevels)) {
    if (level <= 0) continue;
    const move = state.maneuvers[moveId];
    if (!move) continue;
    const hitChance = clampProbability(currentAv(state, targetId, true) + level - currentDv(state, actorId, true));
    const reduction = move.illegal ? 0 : body(wrestlerDefinition(state, actorId));
    const net = Math.max(0, expectedExpression(move.damage) + (move.usesDamageBonus ? 2 : 0) - reduction);
    const expected = hitChance * net;
    if (expected > threat) threat = expected;
  }
  value -= threat * 420;
  if (state.hold?.holderId === actorId) value += 700;
  else if (state.hold?.defenderId === actorId) value -= 1_200;
  if (state.ladder) value += state.ladder.setById === actorId ? 800 : -800;
  value -= state.referee.cumulativeModifier * 150 + state.referee.level * 30;
  if (state.config.mode === "tag") {
    const partner = partnerOf(state, actorId);
    if (partner) {
      const partnerRatio = state.wrestlers[partner].currentDamage / poolMaximum(state, partner, "damage");
      value += (partnerRatio - selfDamageRatio) * 1_500;
    }
  }
  return value;
}

/**
 * Bounded fair lookahead. Every candidate starts from the same deterministic
 * evaluation-only RNG stream derived from visible decision state, never from the
 * live match RNG. The hypothetical dice therefore provide common-random-number
 * comparisons without revealing upcoming real rolls. `veteran` stops after the
 * action; `ruthless` advances the clone
 * (interior AI play resolved with the v1 heuristic so the depth cap is never
 * exceeded) to the opponent's next open decision, applies the opponent's
 * eval-greedy best response, and evaluates that position. Candidates are
 * searched in v1-score order so the fallback tail (past `SEARCH_CLONE_BUDGET`
 * clones) holds only the least promising actions, which keep their v1 score.
 * Any search failure falls back to v1 scoring; the live state and live RNG are
 * never touched.
 */
function evaluationSeed(state: MatchState, decision: DecisionState): number {
  // Deliberately excludes state.rng, config.seed, and scripted rolls. The seed is
  // a replay-stable fingerprint of information available at the decision point.
  const hash = fnv1a32({
    policy: AI_POLICY_VERSION,
    tick: state.tick,
    minute: state.minute,
    phase: state.phase,
    mode: state.config.mode,
    variety: state.config.variety ?? "standard",
    actor: decision.actorId,
    kind: decision.kind,
    actions: decision.actions.map((action) => action.key),
    wrestlers: state.wrestlers,
    teams: state.teams,
    hold: state.hold,
    momentum: state.momentum,
    ladder: state.ladder,
    referee: state.referee,
    pendingAction: state.pendingAction,
    phaseQueue: state.phaseQueue,
    freeRecoveryQueue: state.freeRecoveryQueue,
  });
  return (Number.parseInt(hash, 16) >>> 0) || 1;
}

function chooseWithSearch(state: MatchState, decision: DecisionState, depth: 1 | 2): LegalAction {
  const actorId = decision.actorId;
  const baseline = evaluateState(state, actorId);
  const rows: Array<{ action: LegalAction; v1: number; tie: string; score: number }> = decision.actions.map((action) => ({
    action,
    v1: scoreAction(state, actorId, action),
    tie: fnv1a32({ seed: state.config.seed, tick: state.tick, actor: actorId, action: action.key }),
    score: 0,
  }));
  rows.sort((left, right) => right.v1 - left.v1 || left.tie.localeCompare(right.tie));
  // Search clones hash their event log per recorded event, so each clone starts
  // from just the recent exchange instead of the whole match. The engine only
  // ever tail-scans events (recent net damage / the pending action's stored
  // value), so the slice never changes an interior decision.
  const searchBase: MatchState = { ...state, config: { ...state.config, aiDifficulty: undefined, scriptedRolls: undefined }, rng: createRng(evaluationSeed(state, decision)), events: recentDamageTail(state.events) };
  let budget = AI_SEARCH_CLONE_BUDGET;
  for (const row of rows) {
    if (budget <= 0) {
      row.score = row.v1;
      continue;
    }
    let cursor: MatchState;
    try {
      cursor = resolveDecisionOnce(searchBase, row.action);
    } catch {
      row.score = row.v1;
      continue;
    }
    budget -= 1;
    if (depth === 2) {
      try {
        cursor = advanceUntilPlayerDecision(cursor);
        budget -= 1;
        const opponentDecision = cursor.decision && teamOf(cursor, cursor.decision.actorId) !== teamOf(state, actorId) ? cursor.decision : null;
        if (opponentDecision && opponentDecision.actions.length > 0) {
          // The opponent's response is their greedy choice by the same evaluation
          // function, searched within the node budget. Ranking candidates by
          // their post-response evaluation (rather than by the v1 score) keeps
          // the modeled counterplay honest about what the eval thinks is best.
          let bestResponse: MatchState | null = null;
          let bestOpponentScore = -Infinity;
          for (const candidate of opponentDecision.actions.slice(0, SEARCH_RESPONSE_CANDIDATES)) {
            if (budget <= 0) break;
            const afterOpponent = resolveDecisionOnce({ ...cursor, events: recentDamageTail(cursor.events) }, candidate);
            budget -= 1;
            const opponentScore = evaluateState(afterOpponent, opponentDecision.actorId);
            if (opponentScore > bestOpponentScore) {
              bestOpponentScore = opponentScore;
              bestResponse = afterOpponent;
            }
          }
          if (bestResponse) cursor = bestResponse;
        }
      } catch {
        // Search failed to converge; evaluate the position right after the action.
      }
    }
    row.score = row.v1 + (depth === 2 ? LOOKAHEAD_WEIGHT_DEPTH_2 : LOOKAHEAD_WEIGHT) * (evaluateState(cursor, actorId) - baseline);
  }
  rows.sort((left, right) => right.score - left.score || left.tie.localeCompare(right.tie));
  const winner = rows[0];
  if (!winner) throw new Error("AI received an empty legal action set.");
  return { ...winner.action, estimatedUtility: winner.score };
}

/**
 * Novice mistake injection. From a hash of the decision state (never the dice
 * stream), derive a per-decision mistake probability; on a mistake, play the
 * lowest-scoring legal action instead of the best.
 */
function noviceMistakeRank(state: MatchState, decision: DecisionState, count: number): number {
  if (count <= 1) return 0;
  const hash = fnv1a32({ seed: state.config.seed, tick: state.tick, actor: decision.actorId, kind: decision.kind, difficulty: "novice" });
  const value = Number.parseInt(hash, 16);
  const mistakeProbability = (value % 1_000) / 1_000;
  if (mistakeProbability >= NOVICE_MISTAKE_RATE) return 0;
  return count - 1;
}

function chooseNoviceAction(state: MatchState, decision: DecisionState): LegalAction {
  const scored = decision.actions.map((action) => ({
    action,
    score: scoreAction(state, decision.actorId, action),
    tie: fnv1a32({ seed: state.config.seed, tick: state.tick, actor: decision.actorId, action: action.key }),
  }));
  scored.sort((left, right) => right.score - left.score || left.tie.localeCompare(right.tie));
  const rank = noviceMistakeRank(state, decision, scored.length);
  const winner = scored[rank];
  if (!winner) throw new Error("AI received an empty legal action set.");
  return { ...winner.action, estimatedUtility: winner.score };
}

/**
 * Raw policy dispatcher. `standard` (and an absent `aiDifficulty`) takes exactly
 * the v1 greedy path and consumes zero PRNG values; `novice` injects hash-derived
 * mistakes; `veteran`/`ruthless` run the bounded search.
 */
export function choosePolicyAction(state: MatchState, decision: DecisionState, difficulty: AiDifficulty = state.config.aiDifficulty ?? "standard"): LegalAction {
  if (difficulty === "novice") return chooseNoviceAction(state, decision);
  if (difficulty === "veteran") return chooseWithSearch(state, decision, 1);
  if (difficulty === "ruthless") return chooseWithSearch(state, decision, 2);
  return chooseDeterministicPolicyAction(state, decision);
}

export function chooseAiAction(state: MatchState, decision: DecisionState): LegalAction {
  if (teamOf(state, decision.actorId) !== "ai") throw new Error("AI chooser called for a human-controlled wrestler.");
  return choosePolicyAction(state, decision);
}
