import { AI_DIFFICULTIES, aiPolicyLabel, chooseAiAction } from "./ai";
import {
  activePhases,
  body,
  charmCheckBonus,
  charmDamageDice,
  charmRecoveryBonus,
  currentAv,
  currentDv,
  damageBonus,
  isKnockedOut,
  isLegalInRing,
  isOutsidePartner,
  maneuver,
  nextActiveTick,
  opponentFor,
  opponentTeam,
  partnerOf,
  poolCurrent,
  poolMaximum,
  recoveryLocked,
  recoveryModifier,
  specialProficiency,
  startingDamage,
  startingEndurance,
  teamOf,
  wrestlerDefinition,
} from "./derived";
import { canonicalSerialize, fnv1a32, hashMatchState } from "./hash";
import { M4_DATA_HASH } from "./career-rules";
import { createRng, generateRandomSeed, rollDie, rollExplodingD10, rollExpression } from "./prng";
import type { RandomUint32Source } from "./prng";
import {
  CRITICAL_HOLD_BANDS,
  CRITICAL_STRIKE_BANDS,
  DATA_HASH,
  FUMBLE_BANDS,
  MANEUVERS,
  RULESET_VERSION,
  WRESTLERS,
  validateRulesData,
} from "./rules";
import type {
  CriticalEffectState,
  DecisionState,
  DieRoll,
  Intent,
  LegalAction,
  MatchConfiguration,
  MatchSetup,
  MatchState,
  PendingAction,
  Pool,
  ResolvedEvent,
  TeamId,
  WrestlerId,
} from "./types";
import { ESCAPE_DIFFICULTY, ESCAPE_LEGALITY_THRESHOLD, MATCH_VARIETIES } from "./types";
import {
  assertIntentLegal,
  attackTarget,
  enumerateDamageCharm,
  enumerateDodgeCommit,
  enumerateDoubleTeams,
  enumerateHoldEscape,
  enumerateInterference,
  enumeratePinFollowup,
  enumerateSubmissionFollowup,
  enumerateTurnActions,
  holdEscapeTarget,
} from "./validator";

interface AttackOptions {
  releaseHold?: boolean;
  attackCharm?: number;
  extraAv?: number;
  bonusDamageDice?: number;
  consumeMomentum?: boolean;
  transferMomentumOnMiss?: boolean;
  suppressFollowups?: boolean;
  allowDamageCharm?: boolean;
  preStateHash?: string;
  dice?: DieRoll[];
  detail?: string[];
  skipEndPayment?: boolean;
  completesActivationFor?: WrestlerId;
}

/**
 * States the engine may advance in place. Two kinds of state carry the marker:
 * M10 bounded-search cursors (created by `cloneMatchStateForSearch`) and
 * caller-owned discardable states (`markDiscardable`). For both, advancing
 * mutates the object instead of taking a defensive JSON clone, and recording
 * events skips the per-event full-state hash — the hash is never needed for
 * either, and skipping both keeps headless simulation cheap. The marker lives
 * in a WeakSet, never in serialized state, and the live replay path never sees
 * it because replay entrypoints (`submitPlayerIntent`, `stepRulesLab`) only
 * receive marked states from callers that explicitly opted in.
 */
const searchScoped = new WeakSet<object>();

function stateHashForRecord(state: MatchState): string {
  return searchScoped.has(state) ? "" : hashMatchState(state);
}

function clone<T>(value: T): T {
  const result = JSON.parse(JSON.stringify(value)) as T;
  if (searchScoped.has(value as object)) searchScoped.add(result as object);
  return result;
}

function blankEffect(): CriticalEffectState {
  return {
    additionalDamageDice: 0,
    damageMultiplier: 1,
    bonusAttack: false,
    bonusAttackAv: 0,
    nextActivationAvBonus: 0,
    automaticSubmission: false,
    knockoutPin: false,
  };
}

function recordEvent(
  state: MatchState,
  preStateHash: string,
  actorId: WrestlerId | "system",
  type: string,
  summary: string,
  detail: string[],
  dice: DieRoll[],
): void {
  const event: ResolvedEvent = {
    sequence: state.events.length + 1,
    tick: state.tick,
    minute: state.minute,
    phase: state.phase,
    actorId,
    type,
    summary,
    detail,
    dice,
    preStateHash,
    postStateHash: stateHashForRecord(state),
  };
  state.events.push(event);
}

function setResult(
  state: MatchState,
  winnerTeamId: TeamId | null,
  winnerId: WrestlerId | null,
  method: NonNullable<MatchState["result"]>["method"],
  summary: string,
): void {
  state.result = { winnerTeamId, winnerId, method, summary };
  state.decision = null;
  state.pendingAction = null;
  state.phaseQueue = [];
  state.freeRecoveryQueue = [];
  state.currentActorId = null;
}

export function refereeAvailable(state: MatchState): boolean {
  return state.tick >= state.referee.distractedUntilTick && state.tick >= state.referee.knockedOutUntilTick;
}

/** Damage actually taken by a wrestler (the pool starts full and drains). */
function damageTaken(state: MatchState, id: WrestlerId): number {
  return Math.max(0, startingDamage(wrestlerDefinition(state, id)) - state.wrestlers[id].currentDamage);
}

function applyDamage(state: MatchState, defenderId: WrestlerId, raw: number, ignoresBody: boolean): number {
  const net = ignoresBody ? raw : Math.max(0, raw - body(wrestlerDefinition(state, defenderId)));
  const defender = state.wrestlers[defenderId];
  const remaining = defender.currentDamage - net;
  if (remaining >= 0) defender.currentDamage = remaining;
  else {
    defender.currentDamage = 0;
    defender.currentEndurance += remaining;
  }
  defender.damageTakenThisPhase += net;
  return net;
}

export function refereeTotal(
  explodingD10: number,
  refereeLevel: number,
  cumulativeModifier: number,
  timedModifier: number,
  extraModifier: number,
  purchasedLevelsUsed: number,
): number {
  return explodingD10 + refereeLevel + cumulativeModifier + timedModifier + extraModifier - purchasedLevelsUsed;
}

function forceIllegalEntrantOut(state: MatchState, offenderTeamId: TeamId, detail: string[]): void {
  const team = state.teams[offenderTeamId];
  if (!team.illegalEntrantId) return;
  state.wrestlers[team.illegalEntrantId].location = "apron";
  detail.push(`${wrestlerDefinition(state, team.illegalEntrantId).name} obeys the warning and returns to the apron.`);
  team.illegalEntrantId = null;
  team.exitDeadlineTick = null;
}

function refereeCheck(
  state: MatchState,
  offenderId: WrestlerId,
  purchasedLevels: number,
  extraModifier: number,
  dice: DieRoll[],
  detail: string[],
): void {
  if (!refereeAvailable(state)) {
    detail.push("Referee check skipped: referee unavailable; the check is not queued.");
    return;
  }
  const timedPenalty = state.tick < state.referee.rollPenaltyUntilTick ? state.referee.rollPenalty : 0;
  const exploded = rollExplodingD10(state, "referee exploding D10", dice);
  const total = refereeTotal(exploded, state.referee.level, state.referee.cumulativeModifier, timedPenalty, extraModifier, purchasedLevels);
  detail.push(`Referee: ${exploded} + level ${state.referee.level} + alert ${state.referee.cumulativeModifier} + timed ${timedPenalty} + special ${extraModifier} - purchased levels ${purchasedLevels} = ${total}.`);
  if (total <= 0) {
    detail.push("Referee result: conduct unnoticed.");
    return;
  }
  if (total >= 31 && state.config.variety === undefined) {
    const winnerTeam = opponentTeam(teamOf(state, offenderId));
    const winner = state.teams[winnerTeam].legalInRingId;
    setResult(state, winnerTeam, winner, "disqualification", `${wrestlerDefinition(state, offenderId).name}'s team was disqualified.`);
    detail.push("Referee result 31+: disqualification.");
    return;
  }
  const increase = total <= 10 ? 1 : total <= 15 ? 2 : total <= 20 ? 3 : total <= 25 ? 4 : 5;
  if (total >= 31) detail.push(`Referee result 31+: no disqualification in a ${state.config.variety} match; the referee lets it go.`);
  state.referee.cumulativeModifier += increase;
  if (state.hold?.holderId === offenderId) state.hold = null;
  forceIllegalEntrantOut(state, teamOf(state, offenderId), detail);
  detail.push(`Referee warning: cumulative alert increases by ${increase}.`);
}

function chooseRecoveryPool(state: MatchState, id: WrestlerId): Pool {
  const policy = teamOf(state, id) === "player" ? state.config.playerRecoveryPolicy : state.config.aiRecoveryPolicy;
  if (policy !== "lowest-percent") return policy;
  const damageRatio = state.wrestlers[id].currentDamage / startingDamage(wrestlerDefinition(state, id));
  const enduranceRatio = state.wrestlers[id].currentEndurance / startingEndurance(wrestlerDefinition(state, id));
  return damageRatio <= enduranceRatio ? "damage" : "endurance";
}

function rollRecovery(
  state: MatchState,
  id: WrestlerId,
  pool: Pool,
  charm: number,
  dice: DieRoll[],
  detail: string[],
): number {
  const definition = wrestlerDefinition(state, id);
  const runtime = state.wrestlers[id];
  if (charm > Math.min(3, runtime.charmRemaining)) throw new Error("Invalid recovery Charm spend.");
  runtime.charmRemaining -= charm;
  const die = rollDie(state, 6, "REC D6", dice);
  const modifier = recoveryModifier(definition);
  const charmBonus = charmRecoveryBonus(charm);
  const amount = die + modifier + charmBonus;
  const before = poolCurrent(state, id, pool);
  const after = Math.min(poolMaximum(state, id, pool), before + amount);
  if (pool === "damage") runtime.currentDamage = after;
  else runtime.currentEndurance = after;
  detail.push(`REC: 1D6 (${die}) + ceil(permanent END ${definition.attributes.end}/10) (${modifier}) + Charm ${charmBonus} = ${amount}.`);
  detail.push(`${pool === "damage" ? "DAM PTS" : "END"}: ${before} -> ${after}.`);
  return after - before;
}

function bandEffect<T extends readonly { max: number; effect: string }[]>(bands: T, roll: number): T[number]["effect"] {
  const found = bands.find((band) => roll <= band.max);
  if (!found) throw new Error(`No chart band for ${roll}.`);
  return found.effect;
}

function resolveCriticalHold(
  state: MatchState,
  defenderId: WrestlerId,
  roll: number,
  dice: DieRoll[],
  detail: string[],
): CriticalEffectState {
  const effect = blankEffect();
  const defender = state.wrestlers[defenderId];
  const code = bandEffect(CRITICAL_HOLD_BANDS, roll);
  if (code === "skip-1") defender.skipActivePhases += 1;
  else if (code === "skip-1-escape-1" || code === "skip-1-escape-2") {
    defender.skipActivePhases += 1;
    if (state.hold) state.hold.criticalEscapePenalty += code.endsWith("2") ? 2 : 1;
  } else if (code.startsWith("damage-d6-")) effect.additionalDamageDice = Number(code.at(-1));
  else if (code === "damage-x2" || code === "damage-x3") effect.damageMultiplier = code.endsWith("3") ? 3 : 2;
  else if (code === "dv-rest-1" || code === "dv-rest-2") defender.matchDvModifier -= code.endsWith("2") ? 2 : 1;
  else if (code === "half-dv-rest") defender.halfDvForMatch = true;
  else if (code === "sprain" || code === "break" || code === "break-submit") {
    effect.damageMultiplier = 3;
    defender.matchAvModifier -= 5;
    defender.halfDvForMatch = true;
    if (code !== "sprain") defender.injuryWeeks += rollDie(state, 6, "broken-extremity layoff weeks", dice);
    if (code === "break-submit") effect.automaticSubmission = true;
  }
  detail.push(`Critical Hold chart ${roll}: ${code}.`);
  if (roll === 100) detail.push("Result 100 inherits result 99: broken extremity, layoff, and automatic submission.");
  return effect;
}

function resolveCriticalStrike(
  state: MatchState,
  attackerId: WrestlerId,
  defenderId: WrestlerId,
  roll: number,
  dice: DieRoll[],
  detail: string[],
): CriticalEffectState {
  const effect = blankEffect();
  const defender = state.wrestlers[defenderId];
  const code = bandEffect(CRITICAL_STRIKE_BANDS, roll);
  if (code === "skip-1") defender.skipActivePhases += 1;
  else if (code === "skip-1-av-next-2") {
    defender.skipActivePhases += 1;
    effect.nextActivationAvBonus = 2;
  } else if (code === "stun-d6") defender.stunnedUntilTick = Math.max(defender.stunnedUntilTick, state.tick + rollDie(state, 6, "stun duration", dice));
  else if (code === "bonus-attack" || code === "bonus-attack-av-2") {
    effect.bonusAttack = true;
    effect.bonusAttackAv = code.endsWith("2") ? 2 : 0;
  } else if (code.startsWith("damage-d6-")) effect.additionalDamageDice = Number(code.at(-1));
  else if (code === "damage-x2" || code === "damage-x3") effect.damageMultiplier = code.endsWith("3") ? 3 : 2;
  else if (code === "dv-rest-2") defender.matchDvModifier -= 2;
  else if (code === "av-5-half-dv" || code === "av-5-half-dv-injury") {
    defender.matchAvModifier -= 5;
    defender.halfDvForMatch = true;
    if (code.endsWith("injury")) defender.injuryWeeks += rollDie(state, 6, "critical injury layoff weeks", dice);
  } else if (code === "knockout-d6-minutes") {
    defender.knockedOutUntilTick = state.tick + rollDie(state, 6, "knockout minutes", dice) * 10;
    effect.knockoutPin = true;
  }
  detail.push(`Critical Strike chart ${roll}: ${code}.`);
  void attackerId;
  return effect;
}

function makePinDecision(
  state: MatchState,
  actorId: WrestlerId,
  completesActivationFor: WrestlerId,
  automatic: boolean,
  recentDamage: number,
  kind: "pin-followup" | "knockout-pin" = "pin-followup",
): DecisionState {
  state.pendingAction = { kind: "pin", pinnerId: actorId, defenderId: opponentFor(state, actorId), completesActivationFor, illegal: false, automatic, recentDamage };
  return {
    actorId,
    completesActivationFor,
    kind,
    prompt: automatic ? `${wrestlerDefinition(state, actorId).name} can cover the knocked-out opponent.` : "Attempt a pin after the successful Strike?",
    actions: enumeratePinFollowup(state, actorId, automatic),
  };
}

function makeSubmissionDecision(state: MatchState, actorId: WrestlerId, automatic: boolean, recentDamage: number): DecisionState {
  if (!state.hold) throw new Error("Submission decision requires a Hold.");
  state.pendingAction = { kind: "submission", attackerId: actorId, defenderId: state.hold.defenderId, completesActivationFor: actorId, automatic, recentDamage };
  return {
    actorId,
    completesActivationFor: actorId,
    kind: "submission-followup",
    prompt: automatic ? "Critical Hold 100 forces an automatic submission." : "Attempt a submission check?",
    actions: enumerateSubmissionFollowup(actorId, automatic),
  };
}

function resolveFumble(
  state: MatchState,
  attackerId: WrestlerId,
  roll: number,
  dice: DieRoll[],
  detail: string[],
): void {
  const attacker = state.wrestlers[attackerId];
  const opponentId = opponentFor(state, attackerId);
  const code = bandEffect(FUMBLE_BANDS, roll);
  detail.push(`Fumble chart ${roll}: ${code}.`);
  if (code === "skip-1") attacker.skipActivePhases += 1;
  else if (code === "skip-1-dv-next-2") {
    attacker.skipActivePhases += 1;
    attacker.nextDefenseDvPenalty += 2;
    attacker.nextDefenseDvPenaltyReadyTick = state.tick;
  } else if (code.startsWith("end-d6-")) {
    const count = Number(code.at(-1));
    const extra = rollExpression(state, count, 6, 0, "fumble END cost", dice);
    attacker.currentEndurance -= extra;
    detail.push(`Extra END cost: ${extra}.`);
  } else if (code === "ref-stun-5" || code === "ref-stun-10") {
    const duration = rollDie(state, 6, "referee stun duration", dice);
    state.referee.rollPenalty = code.endsWith("10") ? -10 : -5;
    state.referee.rollPenaltyUntilTick = Math.max(state.referee.rollPenaltyUntilTick, state.tick + duration);
  } else if (code === "ref-ko-d10" || code === "ref-ko-2d10") {
    const duration = rollExpression(state, code === "ref-ko-2d10" ? 2 : 1, 10, 0, "referee knockout duration", dice);
    state.referee.knockedOutUntilTick = Math.max(state.referee.knockedOutUntilTick, state.tick + duration);
  } else if (code === "ref-check" || code === "ref-check-10") refereeCheck(state, attackerId, 0, code.endsWith("10") ? 10 : 0, dice, detail);
  else if (code === "self-injury") {
    const extraEnd = rollExpression(state, 3, 6, 0, "self-injury END cost", dice);
    const selfDamage = rollExpression(state, 2, 6, 0, "self-injury damage", dice);
    attacker.currentEndurance -= extraEnd;
    applyDamage(state, attackerId, selfDamage, true);
    attacker.matchDvModifier -= 2;
    detail.push(`Self-injury bypasses BODY: ${selfDamage} damage and ${extraEnd} extra END.`);
  } else if (code === "rollup" || code === "rollup-5") {
    const target = currentAv(state, opponentId) + (code === "rollup-5" ? 5 : 0) -
      (currentDv(state, attackerId) + wrestlerDefinition(state, attackerId).skills.escapePin);
    const pinRoll = rollDie(state, 20, "fumble roll-up pin", dice);
    detail.push(`Roll-up pin: ${pinRoll} <= ${target}; Escape Pin applies, DAM PTS and recent damage do not.`);
    if (pinRoll <= target) setResult(state, teamOf(state, opponentId), opponentId, "pin", `${wrestlerDefinition(state, opponentId).name} wins with an immediate roll-up.`);
  } else if (code === "turnbuckle-ko") {
    attacker.knockedOutForMatch = true;
    if (refereeAvailable(state)) state.decision = makePinDecision(state, opponentId, attackerId, true, 0, "knockout-pin");
  }
}

function triggerDamageDrawbacks(
  state: MatchState,
  attackerId: WrestlerId,
  defenderId: WrestlerId,
  raw: number,
  net: number,
  dice: DieRoll[],
  detail: string[],
  preserveAutomaticSubmissionHold = false,
): boolean {
  let egotistTriggered = false;
  for (const drawback of wrestlerDefinition(state, attackerId).drawbacks) {
    if (drawback.type !== "egotist" || raw < drawback.damageThreshold) continue;
    const roll = rollDie(state, 20, "Egotist D20", dice);
    detail.push(`Egotist: raw ${raw} >= ${drawback.damageThreshold}; ${roll} <= ${drawback.rollThreshold}.`);
    if (roll <= drawback.rollThreshold) {
      state.wrestlers[attackerId].egotistPosing = true;
      if (!preserveAutomaticSubmissionHold && state.hold?.holderId === attackerId) state.hold = null;
      egotistTriggered = true;
    }
  }
  for (const drawback of wrestlerDefinition(state, defenderId).drawbacks) {
    if ((drawback.type !== "glass-jaw" && drawback.type !== "old-injury") || net < drawback.damageThreshold) continue;
    const roll = rollDie(state, 20, `${drawback.type} D20`, dice);
    detail.push(`${drawback.type}: net ${net} >= ${drawback.damageThreshold}; ${roll} <= ${drawback.rollThreshold}.`);
    if (roll <= drawback.rollThreshold) {
      if (drawback.type === "glass-jaw") state.wrestlers[defenderId].matchDvModifier -= 1;
      else state.wrestlers[defenderId].matchAvModifier -= 2;
    }
  }
  return egotistTriggered;
}

function finalizeAttackDamage(state: MatchState, charm: number): void {
  const pending = state.pendingAction;
  if (!pending || pending.kind !== "attack-damage") throw new Error("No attack damage is pending.");
  const { actorId, defenderId, maneuverId, critical, dice, detail } = pending;
  const move = maneuver(state, maneuverId);
  const attacker = state.wrestlers[actorId];
  if (charm > Math.min(3, attacker.charmRemaining)) throw new Error("Invalid damage Charm spend.");
  attacker.charmRemaining -= charm;
  state.pendingAction = null;
  state.decision = null;

  let raw = rollExpression(state, move.damage.dice, 6, move.damage.flat, `${move.name} base damage`, dice);
  if (move.usesDamageBonus) {
    const bonus = damageBonus(wrestlerDefinition(state, actorId));
    raw += rollExpression(state, bonus.dice, 6, bonus.flat, "POW damage bonus", dice);
  }
  const addedDice = critical.additionalDamageDice + pending.bonusDamageDice + charmDamageDice(charm);
  if (addedDice > 0) raw += rollExpression(state, addedDice, 6, 0, "critical/Whip/Charm added damage", dice);
  raw *= critical.damageMultiplier;
  const ignoresBody = Boolean(move.illegal || pending.useRopes);
  const net = applyDamage(state, defenderId, raw, ignoresBody);
  detail.push(`Damage: raw ${raw} - ${ignoresBody ? "BODY ignored" : `BODY ${body(wrestlerDefinition(state, defenderId))}`} = net ${net}.`);
  detail.push(`Recent net damage: ${net}`);
  detail.push(`Defender pools: ${state.wrestlers[defenderId].currentDamage} DAM PTS / ${state.wrestlers[defenderId].currentEndurance} END.`);

  if (move.throwsOut) {
    if (state.config.variety === "cage") {
      detail.push("Cage wall: the throw slams the defender against the cage; nobody leaves the ring and no countout begins.");
    } else {
      state.wrestlers[defenderId].location = "floor";
      state.wrestlers[defenderId].thrownOutAtTick = state.tick;
      detail.push("Throw Out of Ring: countout checks begin on the next global phase.");
    }
  }
  const egotist = triggerDamageDrawbacks(state, actorId, defenderId, raw, net, dice, detail, critical.automaticSubmission);
  if (move.illegal || pending.useRopes) refereeCheck(state, actorId, move.illegal ? (wrestlerDefinition(state, actorId).maneuverLevels[move.id] ?? 0) : 0, 0, dice, detail);

  if (critical.nextActivationAvBonus > 0) {
    attacker.nextAttackAvBonus = critical.nextActivationAvBonus;
    attacker.nextAttackAvBonusReadyTick = nextActiveTick(state, actorId);
  }
  recordEvent(state, pending.preStateHash, actorId, "attack", `${wrestlerDefinition(state, actorId).name} lands ${move.name} for ${net} net damage.`, detail, dice);
  if (state.result) return;
  if (pending.suppressFollowups) {
    completeActivation(state, pending.completesActivationFor);
    return;
  }
  if (critical.automaticSubmission) {
    // Referee intervention or another legal effect may have released the Hold
    // after the critical result was rolled. An automatic submission can only
    // resolve while its Hold still exists; otherwise the activation ends.
    if (state.hold?.holderId === actorId) state.decision = makeSubmissionDecision(state, actorId, true, net);
    else completeActivation(state, pending.completesActivationFor);
  } else if (critical.bonusAttack) {
    attacker.nextAttackAvBonus += critical.bonusAttackAv;
    attacker.nextAttackAvBonusReadyTick = state.tick;
    const bonusActions = enumerateTurnActions(state, actorId).filter((action) => action.intent.type === "attack");
    if (bonusActions.length === 0) {
      // A critical can change position/state such that no immediate Hold/Strike is
      // legal. Never open an impossible mandatory decision; the immediate bonus
      // expires with this activation instead.
      attacker.nextAttackAvBonus = 0;
      attacker.nextAttackAvBonusReadyTick = 0;
      completeActivation(state, pending.completesActivationFor);
    } else {
      state.decision = {
        actorId,
        completesActivationFor: pending.completesActivationFor,
        kind: "bonus-attack",
        prompt: "Critical result grants an immediate additional Hold or Strike.",
        actions: bonusActions,
      };
    }
  } else if (move.kind === "hold" && move.submission && refereeAvailable(state) && state.hold) state.decision = makeSubmissionDecision(state, actorId, false, net);
  else if (move.kind === "strike" && refereeAvailable(state) && state.wrestlers[defenderId].location === "ring" && !egotist) {
    state.decision = makePinDecision(state, actorId, pending.completesActivationFor, critical.knockoutPin, net);
  } else completeActivation(state, pending.completesActivationFor);
}

function beginAttack(state: MatchState, actorId: WrestlerId, maneuverId: string, options: AttackOptions = {}): void {
  state.decision = null;
  const pre = options.preStateHash ?? hashMatchState(state);
  const dice = options.dice ?? [];
  const detail = options.detail ?? [];
  const defenderId = opponentFor(state, actorId);
  const move = maneuver(state, maneuverId);
  const attacker = state.wrestlers[actorId];
  const defender = state.wrestlers[defenderId];
  const attackCharm = options.attackCharm ?? 0;
  if (options.releaseHold) {
    if (state.hold?.holderId !== actorId) throw new Error("No Hold is available to release.");
    state.hold = null;
    detail.push("Voluntary Hold release grants +2 AV to this check.");
  }
  if (attackCharm > Math.min(3, attacker.charmRemaining)) throw new Error("Invalid attack Charm spend.");
  attacker.charmRemaining -= attackCharm;
  if (!options.skipEndPayment) attacker.currentEndurance -= move.endCost;
  if (defender.stupidMovesActive) {
    defender.stupidMovesActive = false;
    detail.push("Being attacked ends Stupid Moves status.");
  }
  const target = attackTarget(state, actorId, move.id, attackCharm, Boolean(options.releaseHold), options.extraAv ?? 0);
  const roll = rollDie(state, 20, "attack D20", dice);
  let hit = roll === 1 || (roll !== 20 && roll <= target);
  let critical = blankEffect();
  detail.push(`Attack: ${roll} vs target ${target}; natural 1 auto-hits, natural 20 auto-misses.`);
  detail.push(`END paid on attempt: ${options.skipEndPayment ? 0 : move.endCost}; remaining END ${attacker.currentEndurance}.`);

  if (roll === 1) {
    const confirmation = rollDie(state, 20, "critical confirmation D20", dice);
    const confirmed = confirmation === 1 || (confirmation !== 20 && confirmation <= target);
    detail.push(`Critical confirmation: ${confirmation} vs frozen target ${target} -> ${confirmed ? "confirmed" : "not confirmed"}.`);
    if (confirmed) {
      if (move.kind === "hold") state.hold = { holderId: actorId, defenderId, maneuverId: move.id, failedEscapes: 0, criticalEscapePenalty: 0 };
      const chart = rollDie(state, 100, `${move.kind} critical percentile`, dice);
      critical = move.kind === "hold" ? resolveCriticalHold(state, defenderId, chart, dice, detail) : resolveCriticalStrike(state, actorId, defenderId, chart, dice, detail);
    }
  } else if (roll === 20) {
    const confirmation = rollDie(state, 20, "fumble confirmation D20", dice);
    const confirmationMisses = confirmation === 20 || (confirmation !== 1 && confirmation > target);
    detail.push(`Fumble confirmation: ${confirmation} vs frozen target ${target} -> ${confirmationMisses ? "confirmed" : "not confirmed"}.`);
    if (confirmationMisses) resolveFumble(state, actorId, rollDie(state, 100, "fumble percentile", dice), dice, detail);
    hit = false;
  }

  if (options.consumeMomentum) state.momentum = null;
  if (!hit || state.result) {
    if (options.transferMomentumOnMiss && !state.result) {
      state.momentum = { ownerId: defenderId, sourceWhipperId: actorId, expiresAtTick: nextActiveTick(state, actorId) };
      detail.push(`Transferred momentum belongs to ${wrestlerDefinition(state, defenderId).name} until ${wrestlerDefinition(state, actorId).name}'s next active phase.`);
    }
    attacker.nextAttackAvBonus = 0;
    attacker.nextAttackAvBonusReadyTick = 0;
    recordEvent(state, pre, actorId, "attack", `${wrestlerDefinition(state, actorId).name}'s ${move.name} misses.`, detail, dice);
    if (!state.decision && !state.result) completeActivation(state, options.completesActivationFor ?? actorId);
    return;
  }

  if (move.kind === "hold" && !state.hold) state.hold = { holderId: actorId, defenderId, maneuverId: move.id, failedEscapes: 0, criticalEscapePenalty: 0 };
  attacker.nextAttackAvBonus = 0;
  attacker.nextAttackAvBonusReadyTick = 0;
  defender.nextDefenseDvPenalty = 0;
  defender.nextDefenseDvPenaltyReadyTick = 0;
  state.pendingAction = {
    kind: "attack-damage",
    actorId,
    defenderId,
    maneuverId: move.id,
    preStateHash: pre,
    dice,
    detail,
    critical,
    bonusDamageDice: options.bonusDamageDice ?? 0,
    consumeMomentum: Boolean(options.consumeMomentum),
    useRopes: false,
    completesActivationFor: options.completesActivationFor ?? actorId,
    suppressFollowups: Boolean(options.suppressFollowups),
  };
  if (options.allowDamageCharm === false || attacker.charmRemaining === 0) finalizeAttackDamage(state, 0);
  else {
    state.decision = {
      actorId,
      completesActivationFor: options.completesActivationFor ?? actorId,
      kind: "damage-charm",
      prompt: `${move.name} hit. Add Charm before rolling damage?`,
      actions: enumerateDamageCharm(state, actorId),
    };
  }
}

function resolveIrishWhip(state: MatchState, actorId: WrestlerId, intent: Extract<Intent, { type: "irish-whip" }>): void {
  state.decision = null;
  const pre = stateHashForRecord(state);
  const dice: DieRoll[] = [];
  const detail: string[] = [];
  const attacker = state.wrestlers[actorId];
  const defenderId = opponentFor(state, actorId);
  if (intent.releaseHold) {
    if (state.hold?.holderId !== actorId) throw new Error("No Hold is available to release.");
    state.hold = null;
    detail.push("Voluntary release: +2 AV applies to the Whip roll only.");
  }
  if (intent.attackCharm > Math.min(3, attacker.charmRemaining)) throw new Error("Invalid Irish Whip Charm spend.");
  attacker.charmRemaining -= intent.attackCharm;
  attacker.currentEndurance -= 3;
  const skill = specialProficiency(wrestlerDefinition(state, actorId).skills.irishWhip, -5);
  const target = currentAv(state, actorId, true) + skill + charmCheckBonus(intent.attackCharm, false) + (intent.releaseHold ? 2 : 0) - currentDv(state, defenderId, true);
  const roll = rollDie(state, 20, "Irish Whip D20", dice);
  const success = roll === 1 || (roll !== 20 && roll <= target);
  detail.push(`Irish Whip: ${roll} <= AV ${currentAv(state, actorId, true)} + proficiency ${skill} + Charm ${charmCheckBonus(intent.attackCharm, false)} + release ${intent.releaseHold ? 2 : 0} - DV ${currentDv(state, defenderId, true)} = ${target}.`);
  detail.push("Irish Whip is a special-skill check: natural 1/20 apply without critical/fumble confirmation.");
  if (!success) {
    detail.push("Whip failed; only the 3 END Whip cost is paid.");
    recordEvent(state, pre, actorId, "irish-whip", `${wrestlerDefinition(state, actorId).name}'s Irish Whip fails.`, detail, dice);
    completeActivation(state, actorId);
    return;
  }
  const move = maneuver(state, intent.strikeManeuverId);
  attacker.currentEndurance -= move.endCost;
  detail.push(`Whip succeeds; ${move.name} costs ${move.endCost} END and receives +2D6 on hit.`);
  beginAttack(state, actorId, move.id, {
    attackCharm: 0,
    bonusDamageDice: 2,
    transferMomentumOnMiss: true,
    preStateHash: pre,
    dice,
    detail,
    skipEndPayment: true,
  });
}

function resolveMaintainHold(state: MatchState, actorId: WrestlerId, useRopes: boolean): void {
  state.decision = null;
  if (!state.hold || state.hold.holderId !== actorId) throw new Error("No Hold to maintain.");
  const pre = stateHashForRecord(state);
  const move = maneuver(state, state.hold.maneuverId);
  state.wrestlers[actorId].currentEndurance -= move.endCost;
  const detail = [`Maintained Hold costs ${move.endCost} END.${useRopes ? " Ropes make this phase ignore BODY and trigger a referee check." : ""}`];
  state.pendingAction = {
    kind: "attack-damage",
    actorId,
    defenderId: state.hold.defenderId,
    maneuverId: move.id,
    preStateHash: pre,
    dice: [],
    detail,
    critical: blankEffect(),
    bonusDamageDice: 0,
    consumeMomentum: false,
    useRopes,
    completesActivationFor: actorId,
    suppressFollowups: false,
  };
  if (state.wrestlers[actorId].charmRemaining > 0) {
    state.decision = { actorId, completesActivationFor: actorId, kind: "damage-charm", prompt: `${move.name} is maintained. Add Charm to this damage phase?`, actions: enumerateDamageCharm(state, actorId) };
  } else finalizeAttackDamage(state, 0);
}

function recentNetDamage(state: MatchState): number {
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const line = state.events[index].detail.find((candidate) => candidate.startsWith("Recent net damage:"));
    if (line) return Number(line.split(":")[1].trim());
  }
  return 0;
}

function scheduledUnusedPartner(state: MatchState, defenderId: WrestlerId): WrestlerId | null {
  if (state.config.mode !== "tag") return null;
  const partner = partnerOf(state, defenderId);
  if (!partner || !isOutsidePartner(state, partner) || state.wrestlers[partner].stupidMovesActive) return null;
  return state.phaseQueue.includes(partner) && state.wrestlers[partner].actedTick !== state.tick ? partner : null;
}

function openInterferenceIfAvailable(state: MatchState, defenderId: WrestlerId, target: "pin" | "hold"): boolean {
  const partner = scheduledUnusedPartner(state, defenderId);
  if (!partner) return false;
  state.phaseQueue = state.phaseQueue.filter((id) => id !== partner);
  state.decision = { actorId: partner, completesActivationFor: partner, kind: "interference", prompt: `Interfere with the pending ${target === "pin" ? "pin" : "Hold/submission"}?`, actions: enumerateInterference(state, partner, target) };
  return true;
}

/**
 * M11 cage escape. Legal only once the defender has taken
 * `ESCAPE_LEGALITY_THRESHOLD` damage (a fresh opponent hauls the climber
 * back); the D20 target is AV + Charm - DV - climb difficulty, with the
 * defender's *taken* damage making the escape easier and the climber's own
 * taken damage making it harder. Success puts both feet on the floor and ends
 * the match by escape; failure consumes the active phase.
 */
function resolveCageEscape(state: MatchState, actorId: WrestlerId, charm: number): void {
  if (state.config.variety !== "cage") throw new Error("A cage escape requires a cage match.");
  const defenderId = opponentFor(state, actorId);
  if (damageTaken(state, defenderId) < ESCAPE_LEGALITY_THRESHOLD) throw new Error("The opponent is not softened enough to escape the cage.");
  state.decision = null;
  const pre = stateHashForRecord(state);
  const dice: DieRoll[] = [];
  const detail: string[] = [];
  if (charm > Math.min(3, state.wrestlers[actorId].charmRemaining)) throw new Error("Invalid escape Charm spend.");
  state.wrestlers[actorId].charmRemaining -= charm;
  const target = currentAv(state, actorId) + charmCheckBonus(charm, false) - currentDv(state, defenderId) - ESCAPE_DIFFICULTY +
    Math.floor(damageTaken(state, defenderId) / 10) - Math.floor(damageTaken(state, actorId) / 10);
  const roll = rollDie(state, 20, "cage escape D20", dice);
  const success = roll === 1 || (roll !== 20 && roll <= target);
  detail.push(`Cage escape: ${roll} <= AV ${currentAv(state, actorId)} + Charm ${charmCheckBonus(charm, false)} - DV ${currentDv(state, defenderId)} - difficulty ${ESCAPE_DIFFICULTY} + floor(taken ${damageTaken(state, defenderId)}/10) - floor(own taken ${damageTaken(state, actorId)}/10) = ${target}.`);
  if (success) setResult(state, teamOf(state, actorId), actorId, "escape", `${wrestlerDefinition(state, actorId).name} climbs out of the cage and wins by escape.`);
  else detail.push("The escape attempt fails; the defender hauls the climber back down.");
  recordEvent(state, pre, actorId, "cage-escape", state.result ? state.result.summary : "The cage escape attempt fails.", detail, dice);
  if (!state.result) completeActivation(state, actorId);
}

/** M11 ladder setup: consumes the phase and raises the ladder; no dice. */
function resolveSetUpLadder(state: MatchState, actorId: WrestlerId): void {
  if (state.config.variety !== "ladder") throw new Error("Ladder setup requires a ladder match.");
  if (state.ladder) throw new Error("A ladder is already set up.");
  state.decision = null;
  const pre = stateHashForRecord(state);
  state.ladder = { setById: actorId, setAtTick: state.tick };
  recordEvent(state, pre, actorId, "set-up-ladder", `${wrestlerDefinition(state, actorId).name} sets up the ladder.`, [], []);
  completeActivation(state, actorId);
}

/**
 * M11 ladder retrieval: same D20 shape and softening requirement as the cage
 * escape. Success grabs the hanging object (clearing the ladder) and ends the
 * match by retrieval; failure knocks the climber off without disturbing the
 * ladder.
 */
function resolveClimbRetrieve(state: MatchState, actorId: WrestlerId, charm: number): void {
  if (state.config.variety !== "ladder") throw new Error("Ladder retrieval requires a ladder match.");
  if (!state.ladder) throw new Error("No ladder is set up.");
  const defenderId = opponentFor(state, actorId);
  if (damageTaken(state, defenderId) < ESCAPE_LEGALITY_THRESHOLD) throw new Error("The opponent is not softened enough to climb the ladder.");
  state.decision = null;
  const pre = stateHashForRecord(state);
  const dice: DieRoll[] = [];
  const detail: string[] = [];
  if (charm > Math.min(3, state.wrestlers[actorId].charmRemaining)) throw new Error("Invalid retrieval Charm spend.");
  state.wrestlers[actorId].charmRemaining -= charm;
  const target = currentAv(state, actorId) + charmCheckBonus(charm, false) - currentDv(state, defenderId) - ESCAPE_DIFFICULTY +
    Math.floor(damageTaken(state, defenderId) / 10) - Math.floor(damageTaken(state, actorId) / 10);
  const roll = rollDie(state, 20, "ladder retrieval D20", dice);
  const success = roll === 1 || (roll !== 20 && roll <= target);
  detail.push(`Ladder retrieval: ${roll} <= AV ${currentAv(state, actorId)} + Charm ${charmCheckBonus(charm, false)} - DV ${currentDv(state, defenderId)} - difficulty ${ESCAPE_DIFFICULTY} + floor(taken ${damageTaken(state, defenderId)}/10) - floor(own taken ${damageTaken(state, actorId)}/10) = ${target}.`);
  if (success) {
    state.ladder = undefined;
    setResult(state, teamOf(state, actorId), actorId, "retrieval", `${wrestlerDefinition(state, actorId).name} grabs the object from the top of the ladder and wins.`);
  } else detail.push("The retrieval fails; the climber is knocked off the ladder.");
  recordEvent(state, pre, actorId, "climb-retrieve", state.result ? state.result.summary : "The retrieval attempt fails.", detail, dice);
  if (!state.result) completeActivation(state, actorId);
}

/** M11 ladder counterplay: knocks down the opponent's set ladder; no dice. */
function resolveKnockLadder(state: MatchState, actorId: WrestlerId): void {
  if (state.config.variety !== "ladder") throw new Error("Ladder knockdown requires a ladder match.");
  if (!state.ladder) throw new Error("No ladder is set up.");
  if (state.ladder.setById === actorId) throw new Error("A wrestler cannot knock over their own ladder.");
  state.decision = null;
  const pre = stateHashForRecord(state);
  const setter = state.ladder.setById;
  state.ladder = undefined;
  recordEvent(state, pre, actorId, "knock-ladder", `${wrestlerDefinition(state, actorId).name} knocks over the ladder set up by ${wrestlerDefinition(state, setter).name}.`, [], []);
  completeActivation(state, actorId);
}

function resolvePinNow(state: MatchState): void {
  const pending = state.pendingAction;
  if (!pending || pending.kind !== "pin") throw new Error("No pin is pending.");
  state.pendingAction = null;
  state.decision = null;
  const { pinnerId, defenderId, completesActivationFor, illegal, automatic, recentDamage } = pending;
  const pre = stateHashForRecord(state);
  const dice: DieRoll[] = [];
  const detail: string[] = [];
  if (!refereeAvailable(state)) throw new Error("A pin cannot resolve while the referee is unavailable.");
  if (automatic) {
    detail.push("Knockout pin: no D20 roll required; referee availability still required.");
    setResult(state, teamOf(state, pinnerId), pinnerId, "pin", `${wrestlerDefinition(state, pinnerId).name} wins by knockout pin.`);
  } else {
    const illegalLevels = illegal ? wrestlerDefinition(state, pinnerId).skills.illegalPin : 0;
    const target = currentAv(state, pinnerId) + illegalLevels + Math.floor(recentDamage / 10) -
      (currentDv(state, defenderId) + wrestlerDefinition(state, defenderId).skills.escapePin + state.wrestlers[defenderId].currentDamage);
    const roll = rollDie(state, 20, "pin D20", dice);
    detail.push(`Pin: ${roll} <= AV ${currentAv(state, pinnerId)} + Illegal Pin ${illegalLevels} + floor(net ${recentDamage}/10) - (DV ${currentDv(state, defenderId)} + Escape Pin ${wrestlerDefinition(state, defenderId).skills.escapePin} + DAM PTS ${state.wrestlers[defenderId].currentDamage}) = ${target}.`);
    if (roll <= target) setResult(state, teamOf(state, pinnerId), pinnerId, "pin", `${wrestlerDefinition(state, pinnerId).name} wins by pin.`);
    else if (illegal) refereeCheck(state, pinnerId, illegalLevels, 0, dice, detail);
  }
  recordEvent(state, pre, pinnerId, "pin", state.result ? state.result.summary : "The pin attempt fails.", detail, dice);
  if (!state.result) completeActivation(state, completesActivationFor);
}

function resolveSubmissionNow(state: MatchState): void {
  const pending = state.pendingAction;
  if (!pending || pending.kind !== "submission") throw new Error("No submission is pending.");
  state.pendingAction = null;
  state.decision = null;
  const { attackerId, defenderId, completesActivationFor, automatic, recentDamage } = pending;
  const pre = stateHashForRecord(state);
  const dice: DieRoll[] = [];
  const detail: string[] = [];
  if (!refereeAvailable(state)) throw new Error("A submission cannot resolve while the referee is unavailable.");
  if (automatic) {
    detail.push("Critical Hold 100: automatic submission with inherited broken-extremity layoff.");
    setResult(state, teamOf(state, attackerId), attackerId, "submission", `${wrestlerDefinition(state, attackerId).name} wins by automatic submission.`);
  } else {
    const target = currentAv(state, attackerId) + Math.floor(recentDamage / 10) - (currentDv(state, defenderId) + state.wrestlers[defenderId].currentEndurance);
    const roll = rollDie(state, 20, "submission D20", dice);
    detail.push(`Submission: ${roll} <= AV ${currentAv(state, attackerId)} + floor(net ${recentDamage}/10) - (DV ${currentDv(state, defenderId)} + END ${state.wrestlers[defenderId].currentEndurance}) = ${target}.`);
    if (roll <= target) setResult(state, teamOf(state, attackerId), attackerId, "submission", `${wrestlerDefinition(state, attackerId).name} wins by submission.`);
  }
  recordEvent(state, pre, attackerId, "submission", state.result ? state.result.summary : "The submission attempt fails.", detail, dice);
  if (!state.result) completeActivation(state, completesActivationFor);
}

function resolvePinChoice(state: MatchState, actorId: WrestlerId, intent: Extract<Intent, { type: "pin" }>): void {
  const prior = state.pendingAction;
  if (!prior || prior.kind !== "pin" || prior.pinnerId !== actorId) {
    state.pendingAction = { kind: "pin", pinnerId: actorId, defenderId: opponentFor(state, actorId), completesActivationFor: actorId, illegal: intent.illegal, automatic: Boolean(intent.automatic), recentDamage: recentNetDamage(state) };
  } else {
    prior.illegal = intent.illegal;
    prior.automatic = Boolean(intent.automatic);
  }
  state.decision = null;
  const pending = state.pendingAction as Extract<PendingAction, { kind: "pin" }>;
  if (!openInterferenceIfAvailable(state, pending.defenderId, "pin")) resolvePinNow(state);
}

function resolveSubmissionChoice(state: MatchState, actorId: WrestlerId, intent: Extract<Intent, { type: "submission" }>): void {
  const pending = state.pendingAction;
  if (!pending || pending.kind !== "submission" || pending.attackerId !== actorId) throw new Error("No submission window is open.");
  pending.automatic = Boolean(intent.automatic);
  state.decision = null;
  if (!openInterferenceIfAvailable(state, pending.defenderId, "hold")) resolveSubmissionNow(state);
}

function resolvePinInterference(state: MatchState, actorId: WrestlerId, intent: Extract<Intent, { type: "pin-interference" }>): void {
  state.decision = null;
  const pre = stateHashForRecord(state);
  const dice: DieRoll[] = [];
  const detail: string[] = [];
  const definition = wrestlerDefinition(state, actorId);
  if (intent.charm > Math.min(3, state.wrestlers[actorId].charmRemaining)) throw new Error("Invalid interference Charm spend.");
  state.wrestlers[actorId].charmRemaining -= intent.charm;
  state.wrestlers[actorId].outsideActionUsedTick = state.tick;
  state.wrestlers[actorId].actedTick = state.tick;
  const opponentId = state.teams[opponentTeam(teamOf(state, actorId))].legalInRingId;
  const proficiency = specialProficiency(definition.skills.pinInterference, -3);
  const target = currentAv(state, actorId) + proficiency + charmCheckBonus(intent.charm, false) - currentDv(state, opponentId);
  const roll = rollDie(state, 20, "Pin Interference D20", dice);
  const success = roll === 1 || (roll !== 20 && roll <= target);
  detail.push(`Pin Interference: ${roll} <= AV ${currentAv(state, actorId)} + proficiency ${proficiency} + Charm ${charmCheckBonus(intent.charm, false)} - opponent DV ${currentDv(state, opponentId)} = ${target}.`);
  refereeCheck(state, actorId, definition.skills.pinInterference, 0, dice, detail);
  recordEvent(state, pre, actorId, "pin-interference", success ? `${wrestlerDefinition(state, actorId).name} breaks up the ${intent.target}.` : `${wrestlerDefinition(state, actorId).name} fails to interfere.`, detail, dice);
  if (state.result) return;
  if (success) {
    if (intent.target === "hold") state.hold = null;
    const completes = state.pendingAction?.kind === "pin" ? state.pendingAction.completesActivationFor : state.pendingAction?.kind === "submission" ? state.pendingAction.completesActivationFor : actorId;
    state.pendingAction = null;
    completeActivation(state, completes);
  } else if (state.pendingAction?.kind === "pin") resolvePinNow(state);
  else if (state.pendingAction?.kind === "submission") resolveSubmissionNow(state);
  else completeActivation(state, actorId);
}

function resolveRecover(state: MatchState, actorId: WrestlerId, intent: Extract<Intent, { type: "recover" }>): void {
  state.decision = null;
  const pre = stateHashForRecord(state);
  const dice: DieRoll[] = [];
  const detail: string[] = [];
  rollRecovery(state, actorId, intent.pool, intent.charm, dice, detail);
  if (intent.outside) state.wrestlers[actorId].outsideActionUsedTick = null;
  recordEvent(state, pre, actorId, intent.free ? "universal-recovery" : intent.outside ? "outside-recovery" : "recovery", `${wrestlerDefinition(state, actorId).name} recovers ${intent.pool}.`, detail, dice);
  if (intent.free) {
    state.currentActorId = null;
    state.decision = null;
  } else completeActivation(state, actorId);
}

function resolveEscape(state: MatchState, defenderId: WrestlerId, charm: number): boolean {
  if (!state.hold || state.hold.defenderId !== defenderId) return true;
  const pre = stateHashForRecord(state);
  const dice: DieRoll[] = [];
  const detail: string[] = [];
  const runtime = state.wrestlers[defenderId];
  if (charm > Math.min(3, runtime.charmRemaining)) throw new Error("Invalid Break Hold Charm spend.");
  runtime.charmRemaining -= charm;
  const target = holdEscapeTarget(state, defenderId, charm);
  const roll = rollDie(state, 20, "Hold escape D20", dice);
  const success = roll <= target;
  detail.push(`Escape: ${roll} <= target ${target}. Break Hold uses proficiency + Charm ${charmCheckBonus(charm, false)}; holder maneuver subtracts purchased levels only.`);
  if (success) state.hold = null;
  else state.hold.failedEscapes += 1;
  recordEvent(state, pre, defenderId, "hold-escape", success ? `${wrestlerDefinition(state, defenderId).name} escapes and may still act.` : `${wrestlerDefinition(state, defenderId).name} fails to escape; the active phase is consumed.`, detail, dice);
  return success;
}

function resolveEscapeChoice(state: MatchState, defenderId: WrestlerId, charm: number): void {
  state.decision = null;
  const success = resolveEscape(state, defenderId, charm);
  if (!success) {
    completeActivation(state, defenderId);
    return;
  }
  if (recoveryLocked(state, defenderId)) {
    state.decision = {
      actorId: defenderId, completesActivationFor: defenderId, kind: "turn", prompt: "Escape succeeded; recovery lockout still requires END recovery.",
      actions: enumerateTurnActions(state, defenderId).filter((action) => action.intent.type === "recover" && action.intent.pool === "endurance"),
    };
    return;
  }
  state.decision = { actorId: defenderId, completesActivationFor: defenderId, kind: "turn", prompt: "Escape succeeded; choose the remaining action.", actions: enumerateTurnActions(state, defenderId) };
}

function resolveDistractReferee(state: MatchState, actorId: WrestlerId, charm: number): void {
  state.decision = null;
  const pre = stateHashForRecord(state);
  const dice: DieRoll[] = [];
  const detail: string[] = [];
  const definition = wrestlerDefinition(state, actorId);
  const runtime = state.wrestlers[actorId];
  if (charm > Math.min(3, runtime.charmRemaining)) throw new Error("Invalid Distract Referee Charm spend.");
  runtime.charmRemaining -= charm;
  const proficiency = specialProficiency(definition.skills.distractReferee, -5);
  const target = currentAv(state, actorId) + proficiency + charmCheckBonus(charm, false) - state.referee.level;
  const roll = rollDie(state, 20, "Distract Referee D20", dice);
  const success = roll === 1 || (roll !== 20 && roll <= target);
  state.referee.cumulativeModifier += 2;
  detail.push(`Distract Referee: ${roll} <= AV ${currentAv(state, actorId)} + proficiency ${proficiency} + Charm ${charmCheckBonus(charm, false)} - referee level ${state.referee.level} = ${target}.`);
  detail.push("Attempt adds +2 cumulative referee alert without a referee-chart roll.");
  if (success) {
    const duration = rollDie(state, 6, "distraction duration", dice) + definition.skills.distractReferee;
    state.referee.distractedUntilTick = Math.max(state.referee.distractedUntilTick, state.tick + duration);
    for (const existingTeam of Object.values(state.teams)) {
      if (existingTeam.illegalEntrantId) existingTeam.exitDeadlineTick = state.referee.distractedUntilTick;
    }
    detail.push(`Distraction lasts ${duration} phases inclusive of the current phase.`);
    if (roll <= Math.floor(target / 2)) {
      const team = state.teams[teamOf(state, actorId)];
      team.entryEligibleId = actorId;
      team.exitDeadlineTick = state.tick + duration;
      detail.push("Half-target success: this outside partner may enter on the next active phase.");
    }
  }
  recordEvent(state, pre, actorId, "distract-referee", success ? `${wrestlerDefinition(state, actorId).name} distracts the referee.` : `${wrestlerDefinition(state, actorId).name} fails to distract the referee.`, detail, dice);
  state.wrestlers[actorId].outsideActionUsedTick = state.tick;
  completeActivation(state, actorId);
}

function resolveEnterRing(state: MatchState, actorId: WrestlerId): void {
  const team = state.teams[teamOf(state, actorId)];
  if (team.entryEligibleId !== actorId || state.tick >= state.referee.distractedUntilTick) throw new Error("Illegal entry window is not open.");
  const pre = stateHashForRecord(state);
  state.wrestlers[actorId].location = "ring";
  team.illegalEntrantId = actorId;
  team.entryEligibleId = null;
  team.exitDeadlineTick = state.referee.distractedUntilTick;
  recordEvent(state, pre, actorId, "illegal-entry", `${wrestlerDefinition(state, actorId).name} enters while the referee is distracted.`, [`One teammate must exit before tick ${team.exitDeadlineTick}. The entrant may attack now.`], []);
  state.decision = { actorId, completesActivationFor: actorId, kind: "bonus-attack", prompt: "Choose the entrant's attack.", actions: enumerateTurnActions(state, actorId).filter((action) => action.intent.type === "attack" || action.intent.type === "exit-ring") };
}

function resolveExitRing(state: MatchState, actorId: WrestlerId): void {
  const pre = stateHashForRecord(state);
  const team = state.teams[teamOf(state, actorId)];
  const wasEntrant = team.illegalEntrantId === actorId;
  state.wrestlers[actorId].location = "apron";
  if (!wasEntrant && team.illegalEntrantId) {
    team.legalInRingId = team.illegalEntrantId;
    state.referee.cumulativeModifier += 1;
  }
  team.illegalEntrantId = null;
  team.exitDeadlineTick = null;
  recordEvent(state, pre, actorId, "ring-exit", `${wrestlerDefinition(state, actorId).name} exits to the apron.`, [wasEntrant ? "The original legal wrestler remains in the ring." : "The wrong partner remains; referee alert increases by +1."], []);
  completeActivation(state, actorId);
}

function resolveTag(state: MatchState, actorId: WrestlerId, charm: number): void {
  state.decision = null;
  const pre = stateHashForRecord(state);
  const dice: DieRoll[] = [];
  const detail: string[] = [];
  const partner = partnerOf(state, actorId);
  if (!partner) throw new Error("Tag requires a partner.");
  const runtime = state.wrestlers[actorId];
  if (charm > Math.min(3, runtime.charmRemaining)) throw new Error("Invalid Tag Charm spend.");
  runtime.charmRemaining -= charm;
  const definition = wrestlerDefinition(state, actorId);
  const proficiency = specialProficiency(definition.skills.tagTeam, -5);
  const target = currentAv(state, actorId) + proficiency + charmCheckBonus(charm, false) - runtime.damageTakenThisPhase;
  const roll = rollDie(state, 20, "Tag Team D20", dice);
  const success = roll === 1 || (roll !== 20 && roll <= target);
  detail.push(`Tag Team: ${roll} <= AV ${currentAv(state, actorId)} + proficiency ${proficiency} + Charm ${charmCheckBonus(charm, false)} - same-phase net damage ${runtime.damageTakenThisPhase} = ${target}.`);
  if (!success) {
    recordEvent(state, pre, actorId, "tag", `${wrestlerDefinition(state, actorId).name} fails to tag.`, detail, dice);
    completeActivation(state, actorId);
    return;
  }
  const team = state.teams[teamOf(state, actorId)];
  team.legalInRingId = partner;
  runtime.location = "apron";
  state.wrestlers[partner].location = "ring";
  runtime.outsideActionUsedTick = state.tick;
  detail.push(`${wrestlerDefinition(state, partner).name} becomes the legal in-ring wrestler.`);
  recordEvent(state, pre, actorId, "tag", `${wrestlerDefinition(state, actorId).name} tags ${wrestlerDefinition(state, partner).name}.`, detail, dice);
  const bothScheduled = activePhases(definition).includes(state.phase) && activePhases(wrestlerDefinition(state, partner)).includes(state.phase);
  if (roll <= Math.floor(target / 2) && bothScheduled) {
    state.decision = { actorId, completesActivationFor: actorId, kind: "tag-double-team", prompt: "Half-target tag: choose a legal double-team sequence.", actions: enumerateDoubleTeams(state, actorId) };
    return;
  }
  scheduleIncomingAfterTag(state, actorId, partner);
  completeActivation(state, actorId);
}

function scheduleIncomingAfterTag(state: MatchState, outgoingId: WrestlerId, incomingId: WrestlerId): void {
  const incomingPassed = state.processedThisPhase.includes(incomingId);
  state.phaseQueue = state.phaseQueue.filter((id) => id !== outgoingId && id !== incomingId);
  if (activePhases(wrestlerDefinition(state, incomingId)).includes(state.phase)) {
    if (incomingPassed) state.processedThisPhase = state.processedThisPhase.filter((id) => id !== incomingId);
    state.wrestlers[incomingId].actedTick = null;
    state.phaseQueue.unshift(incomingId);
  }
}

function resolveDoubleTeam(state: MatchState, actorId: WrestlerId, intent: Extract<Intent, { type: "double-team" }>): void {
  state.decision = null;
  const partner = partnerOf(state, actorId);
  if (!partner) throw new Error("Double team requires a partner.");
  const defenderId = opponentFor(state, actorId);
  const pre = stateHashForRecord(state);
  const beforeEvents = state.events.length;
  if (intent.sequence === "two-strikes") {
    beginAttack(state, actorId, intent.firstManeuverId, { allowDamageCharm: false, suppressFollowups: true, completesActivationFor: actorId });
    if (!state.result) beginAttack(state, partner, intent.secondManeuverId, { allowDamageCharm: false, suppressFollowups: true, completesActivationFor: partner });
  } else if (intent.sequence === "shared-whip") {
    const dice: DieRoll[] = [];
    const detail: string[] = [];
    state.wrestlers[actorId].currentEndurance -= 3;
    const target = currentAv(state, actorId) + specialProficiency(wrestlerDefinition(state, actorId).skills.irishWhip, -5) - currentDv(state, defenderId);
    const roll = rollDie(state, 20, "shared Irish Whip D20", dice);
    const success = roll === 1 || (roll !== 20 && roll <= target);
    recordEvent(state, pre, actorId, "double-team-whip", success ? "The shared Irish Whip succeeds." : "The shared Irish Whip fails.", [`Whip: ${roll} <= ${target}.`], dice);
    if (success) {
      beginAttack(state, actorId, intent.firstManeuverId, { bonusDamageDice: 2, allowDamageCharm: false, suppressFollowups: true, completesActivationFor: actorId });
      if (!state.result) beginAttack(state, partner, intent.secondManeuverId, { bonusDamageDice: 2, allowDamageCharm: false, suppressFollowups: true, completesActivationFor: partner });
    }
  } else {
    const quicker = wrestlerDefinition(state, actorId).attributes.qui >= wrestlerDefinition(state, partner).attributes.qui ? actorId : partner;
    const slower = quicker === actorId ? partner : actorId;
    beginAttack(state, quicker, intent.firstManeuverId, { allowDamageCharm: false, suppressFollowups: true, completesActivationFor: quicker });
    if (!state.result) beginAttack(state, slower, intent.secondManeuverId, { extraAv: 2, allowDamageCharm: false, suppressFollowups: true, completesActivationFor: slower });
    state.hold = null;
  }
  if (state.result) return;
  const componentEvents = state.events.slice(beforeEvents);
  const combined = componentEvents.reduce((sum, event) => {
    const line = event.detail.find((candidate) => candidate.startsWith("Recent net damage:"));
    return sum + (line ? Number(line.split(":")[1].trim()) : 0);
  }, 0);
  const team = state.teams[teamOf(state, actorId)];
  const pinner = team.legalInRingId;
  recordEvent(state, pre, actorId, "double-team", `${wrestlerDefinition(state, actorId).name}'s team completes a ${intent.sequence} sequence.`, [`BODY was applied separately to each component.`, `Recent net damage: ${combined}`], []);
  scheduleIncomingAfterTag(state, actorId, partner);
  if (combined > 0 && refereeAvailable(state)) state.decision = makePinDecision(state, pinner, actorId, false, combined);
  else completeActivation(state, actorId);
}

function resolveReenter(state: MatchState, actorId: WrestlerId, maneuverId?: string): void {
  const pre = stateHashForRecord(state);
  state.wrestlers[actorId].location = "ring";
  state.wrestlers[actorId].thrownOutAtTick = null;
  recordEvent(state, pre, actorId, "reentry", `${wrestlerDefinition(state, actorId).name} re-enters the ring.`, [maneuverId ? `The same phase continues with ${maneuver(state, maneuverId).name}.` : "No other action is taken."], []);
  if (maneuverId) beginAttack(state, actorId, maneuverId, { allowDamageCharm: true });
  else completeActivation(state, actorId);
}

function resolveStupidMovesAtTurn(state: MatchState, actorId: WrestlerId): boolean {
  const drawback = wrestlerDefinition(state, actorId).drawbacks.find((entry) => entry.type === "stupid-moves");
  if (!drawback) return false;
  const runtime = state.wrestlers[actorId];
  const due = state.minute > 1 && (state.minute - 1) % drawback.intervalMinutes === 0 && runtime.lastStupidMovesCheckMinute < state.minute;
  if (!runtime.stupidMovesActive && !due) return false;
  if (state.hold?.defenderId === actorId && due) return false;
  const pre = stateHashForRecord(state);
  const dice: DieRoll[] = [];
  const roll = rollDie(state, 20, "Stupid Moves D20", dice);
  runtime.lastStupidMovesCheckMinute = state.minute;
  if (roll > drawback.rollThreshold) {
    runtime.stupidMovesActive = false;
    recordEvent(state, pre, actorId, "stupid-moves", `${wrestlerDefinition(state, actorId).name} regains focus and may act.`, [`${roll} > ${drawback.rollThreshold}.`], dice);
    return false;
  }
  runtime.stupidMovesActive = true;
  if (state.hold?.holderId === actorId) state.hold = null;
  recordEvent(state, pre, actorId, "stupid-moves", `${wrestlerDefinition(state, actorId).name} loses the active phase to Stupid Moves.`, [`${roll} <= ${drawback.rollThreshold}; opponent receives +5 AV while the status remains.`], dice);
  completeActivation(state, actorId);
  return true;
}

function completeActivation(state: MatchState, actorId: WrestlerId): void {
  const actor = state.wrestlers[actorId];
  actor.actedTick = state.tick;
  if (actor.nextAttackAvBonus > 0 && state.tick >= actor.nextAttackAvBonusReadyTick) {
    actor.nextAttackAvBonus = 0;
    actor.nextAttackAvBonusReadyTick = 0;
  }
  const targetId = state.teams[opponentTeam(teamOf(state, actorId))].legalInRingId;
  const target = state.wrestlers[targetId];
  if (target.nextDefenseDvPenalty > 0 && state.tick >= target.nextDefenseDvPenaltyReadyTick) {
    target.nextDefenseDvPenalty = 0;
    target.nextDefenseDvPenaltyReadyTick = 0;
  }
  state.currentActorId = null;
  state.decision = null;
}

function openTurn(state: MatchState, actorId: WrestlerId): void {
  state.currentActorId = actorId;
  if (!state.processedThisPhase.includes(actorId)) state.processedThisPhase.push(actorId);
  if (state.wrestlers[actorId].actedTick === state.tick) {
    completeActivation(state, actorId);
    return;
  }
  if (state.wrestlers[actorId].egotistPosing) {
    const pre = stateHashForRecord(state);
    state.wrestlers[actorId].egotistPosing = false;
    recordEvent(state, pre, actorId, "egotist-end", `${wrestlerDefinition(state, actorId).name} stops posing and may act.`, [], []);
  }
  if (isKnockedOut(state, actorId)) {
    const pre = stateHashForRecord(state);
    recordEvent(state, pre, actorId, "forced-skip", `${wrestlerDefinition(state, actorId).name} cannot act while knocked out.`, [], []);
    completeActivation(state, actorId);
    return;
  }
  const runtime = state.wrestlers[actorId];
  if (runtime.skipActivePhases > 0) {
    const pre = stateHashForRecord(state);
    runtime.skipActivePhases -= 1;
    recordEvent(state, pre, actorId, "forced-skip", `${wrestlerDefinition(state, actorId).name} loses this active phase.`, [], []);
    completeActivation(state, actorId);
    return;
  }
  if (resolveStupidMovesAtTurn(state, actorId)) return;
  if (state.hold?.defenderId === actorId) {
    state.decision = { actorId, completesActivationFor: actorId, kind: "hold-escape", prompt: `Attempt to escape ${maneuver(state, state.hold.maneuverId).name}.`, actions: enumerateHoldEscape(state, actorId) };
    return;
  }
  if (recoveryLocked(state, actorId) && !isOutsidePartner(state, actorId)) {
    const pool: Pool = "endurance";
    state.decision = { actorId, completesActivationFor: actorId, kind: "turn", prompt: "Recovery lockout: recover END.", actions: enumerateTurnActions(state, actorId).filter((action) => action.intent.type === "recover" && action.intent.pool === pool) };
    return;
  }
  const actions = enumerateTurnActions(state, actorId);
  if (actions.length === 0) {
    const pre = stateHashForRecord(state);
    recordEvent(state, pre, actorId, "idle", `${wrestlerDefinition(state, actorId).name} has no legal action.`, [], []);
    completeActivation(state, actorId);
    return;
  }
  state.decision = {
    actorId,
    completesActivationFor: actorId,
    kind: isOutsidePartner(state, actorId) ? "outside-recovery" : "turn",
    prompt: isOutsidePartner(state, actorId) ? `${wrestlerDefinition(state, actorId).name}'s outside-partner phase.` : `${wrestlerDefinition(state, actorId).name}'s active phase.`,
    actions,
  };
}

function resolveDodgeWindow(state: MatchState, humanIntent?: Extract<Intent, { type: "dodge-commit" }>): void {
  const eligible = state.phaseQueue.filter((id) => isLegalInRing(state, id) && state.wrestlers[id].location === "ring" && !isKnockedOut(state, id) && state.hold?.defenderId !== id && !recoveryLocked(state, id));
  const pre = stateHashForRecord(state);
  const detail: string[] = [];
  for (const id of eligible) {
    let dodge = false;
    if (teamOf(state, id) === "player") dodge = Boolean(humanIntent?.dodge);
    else {
      const decision: DecisionState = { actorId: id, completesActivationFor: id, kind: "dodge-commit", prompt: "Simultaneous Dodge commitment.", actions: enumerateDodgeCommit(state, id) };
      dodge = (chooseAiAction(state, decision).intent as Extract<Intent, { type: "dodge-commit" }>).dodge;
    }
    detail.push(`${wrestlerDefinition(state, id).name}: ${dodge ? "Dodge committed" : "keeps action"}.`);
    if (dodge) {
      if (state.hold?.holderId === id) state.hold = null;
      state.wrestlers[id].dodgingUntilTick = state.tick + 1;
      state.wrestlers[id].actedTick = state.tick;
      state.phaseQueue = state.phaseQueue.filter((candidate) => candidate !== id);
      if (!state.processedThisPhase.includes(id)) state.processedThisPhase.push(id);
    }
  }
  state.dodgeWindowResolved = true;
  state.decision = null;
  recordEvent(state, pre, "system", "dodge-reveal", "Simultaneous Dodge commitments are revealed.", detail, []);
}

function openDodgeWindow(state: MatchState): boolean {
  if (state.dodgeWindowResolved) return false;
  const eligible = state.phaseQueue.filter((id) => isLegalInRing(state, id) && state.wrestlers[id].location === "ring" && !isKnockedOut(state, id) && state.hold?.defenderId !== id && !recoveryLocked(state, id));
  const human = eligible.find((id) => teamOf(state, id) === "player");
  if (human) {
    state.decision = { actorId: human, completesActivationFor: human, kind: "dodge-commit", prompt: "Commit Dodge before this phase's actions are revealed.", actions: enumerateDodgeCommit(state, human) };
    return true;
  }
  resolveDodgeWindow(state);
  return false;
}

function enforceExpiredEntry(state: MatchState): void {
  for (const teamId of ["player", "ai"] as TeamId[]) {
    const team = state.teams[teamId];
    if (team.entryEligibleId && state.tick >= state.referee.distractedUntilTick) {
      team.entryEligibleId = null;
      if (!team.illegalEntrantId) team.exitDeadlineTick = null;
    }
    if (team.illegalEntrantId && team.exitDeadlineTick !== null && state.tick >= team.exitDeadlineTick) {
      const pre = stateHashForRecord(state);
      const offender = team.illegalEntrantId;
      const winnerTeam = opponentTeam(teamId);
      setResult(state, winnerTeam, state.teams[winnerTeam].legalInRingId, "disqualification", `${wrestlerDefinition(state, offender).name}'s team is disqualified for failing to leave the ring.`);
      recordEvent(state, pre, offender, "illegal-entry-disqualification", `${wrestlerDefinition(state, offender).name}'s team is disqualified for failing to leave the ring.`, [`Exit deadline tick ${team.exitDeadlineTick} expired at tick ${state.tick}.`], []);
      return;
    }
  }
}

function processCountouts(state: MatchState): void {
  // Cage and ladder matches never end by countout (M11): the ladder allows
  // free floor time, and the cage closes the boundary entirely.
  if (state.config.variety !== undefined) return;
  for (const teamId of ["player", "ai"] as TeamId[]) {
    const id = state.teams[teamId].legalInRingId;
    const runtime = state.wrestlers[id];
    if (runtime.location !== "floor" || runtime.thrownOutAtTick === null || runtime.thrownOutAtTick >= state.tick) continue;
    const pre = stateHashForRecord(state);
    const dice: DieRoll[] = [];
    const roll = rollDie(state, 10, "countout D10", dice);
    recordEvent(state, pre, id, "countout-check", roll === 10 ? `${wrestlerDefinition(state, id).name} is counted out.` : `${wrestlerDefinition(state, id).name} survives the countout check.`, [`Countout D10: ${roll}; only 10 loses immediately.`], dice);
    if (roll === 10) {
      const winnerTeam = opponentTeam(teamId);
      setResult(state, winnerTeam, state.teams[winnerTeam].legalInRingId, "countout", `${wrestlerDefinition(state, id).name}'s team loses by countout.`);
      return;
    }
  }
}

function startNextPhase(state: MatchState): void {
  if (state.phase === 10) {
    state.minute += 1;
    state.phase = 1;
    for (const id of state.activeWrestlerIds) state.wrestlers[id].stupidMovesActive = false;
  } else state.phase += 1;
  state.tick += 1;
  state.phaseEndProcessed = false;
  state.freeRecoveryQueue = [];
  state.processedThisPhase = [];
  state.dodgeWindowResolved = false;
  for (const id of state.activeWrestlerIds) state.wrestlers[id].damageTakenThisPhase = 0;
  if (state.momentum && state.tick >= state.momentum.expiresAtTick) state.momentum = null;
  enforceExpiredEntry(state);
  if (state.result) return;
  processCountouts(state);
  if (state.result) return;
  state.phaseQueue = state.initiative.filter((id) => state.activeWrestlerIds.includes(id) && activePhases(wrestlerDefinition(state, id)).includes(state.phase));
  const pre = stateHashForRecord(state);
  recordEvent(state, pre, "system", "phase-start", `Minute ${state.minute}, phase ${state.phase}.`, [state.phaseQueue.length ? `Scheduled: ${state.phaseQueue.map((id) => wrestlerDefinition(state, id).name).join(", ")}.` : "No wrestler is scheduled."], []);
}

function openFreeRecovery(state: MatchState, id: WrestlerId): void {
  const runtime = state.wrestlers[id];
  const incomplete = (["damage", "endurance"] as Pool[]).filter((pool) => poolCurrent(state, id, pool) < poolMaximum(state, id, pool));
  if (incomplete.length === 0) {
    const pre = stateHashForRecord(state);
    recordEvent(state, pre, id, "universal-recovery", `${wrestlerDefinition(state, id).name} is already fully recovered.`, [], []);
    return;
  }
  if (teamOf(state, id) === "player" && runtime.charmRemaining > 0) {
    const actions: LegalAction[] = [];
    for (const pool of incomplete) for (let charm = 0; charm <= Math.min(3, runtime.charmRemaining); charm += 1) actions.push({ key: `free:${pool}:${charm}`, label: `Recover ${pool === "damage" ? "DAM PTS" : "END"}${charm ? ` (+${charm} Charm)` : ""}`, detail: "Universal phase-10 recovery.", intent: { type: "recover", pool, charm, free: true } });
    state.decision = { actorId: id, completesActivationFor: id, kind: "universal-recovery", prompt: `${wrestlerDefinition(state, id).name}'s free phase-10 recovery.`, actions };
    return;
  }
  const pool = incomplete.includes(chooseRecoveryPool(state, id)) ? chooseRecoveryPool(state, id) : incomplete[0];
  resolveRecover(state, id, { type: "recover", pool, charm: 0, free: true });
}

/**
 * Search-scoped clone: copies the dynamic match state while sharing the static
 * roster/maneuver definitions, event objects, and the scripted-rolls list (all
 * append-only or read-only during play — the same boundary `hashMatchState`
 * already relies on). Only `performDecision` and the headless advance mutate
 * runtime fields, which are copied here. This keeps a single lookahead clone
 * proportional to the live runtime instead of re-serializing the whole event log.
 */
function cloneMatchStateForSearch(input: MatchState): MatchState {
  const pending = input.pendingAction;
  const clone: MatchState = {
    ...input,
    roster: input.roster,
    maneuvers: input.maneuvers,
    config: input.config,
    rng: { ...input.rng },
    wrestlers: Object.fromEntries(Object.entries(input.wrestlers).map(([id, runtime]) => [id, { ...runtime }])) as MatchState["wrestlers"],
    teams: Object.fromEntries(Object.entries(input.teams).map(([id, team]) => [id, { ...team, members: [...team.members] }])) as MatchState["teams"],
    hold: input.hold ? { ...input.hold } : null,
    momentum: input.momentum ? { ...input.momentum } : null,
    ladder: input.ladder ? { ...input.ladder } : undefined,
    referee: { ...input.referee },
    decision: input.decision ? { ...input.decision, actions: [...input.decision.actions] } : null,
    pendingAction: pending ? { ...pending, ...(pending.kind === "attack-damage" ? { dice: [...pending.dice], detail: [...pending.detail], critical: { ...pending.critical } } : {}) } : null,
    phaseQueue: [...input.phaseQueue],
    freeRecoveryQueue: [...input.freeRecoveryQueue],
    processedThisPhase: [...input.processedThisPhase],
    activeWrestlerIds: [...input.activeWrestlerIds],
    initiative: [...input.initiative],
    events: [...input.events],
    inputLog: [...input.inputLog],
  };
  searchScoped.add(clone);
  return clone;
}

/**
 * M10 search dry-run helper: applies exactly one open decision transaction to a
 * discarded clone and returns the resulting state without advancing to the next
 * decision. All dice are consumed from the clone's copied RNG, which dies with
 * the clone, so lookahead never touches the live match state or dice stream.
 */
export function resolveDecisionOnce(input: MatchState, action: LegalAction): MatchState {
  const state = cloneMatchStateForSearch(input);
  performDecision(state, action);
  return state;
}

function performDecision(state: MatchState, action: LegalAction): void {
  const decision = state.decision;
  if (!decision) throw new Error("No open decision.");
  const actorId = decision.actorId;
  const intent = action.intent;
  if (intent.type === "attack") beginAttack(state, actorId, intent.maneuverId, { releaseHold: intent.releaseHold, attackCharm: intent.attackCharm, bonusDamageDice: intent.useMomentum ? 2 : 0, consumeMomentum: intent.useMomentum });
  else if (intent.type === "irish-whip") resolveIrishWhip(state, actorId, intent);
  else if (intent.type === "choose-damage-charm") finalizeAttackDamage(state, intent.charm);
  else if (intent.type === "escape-hold") resolveEscapeChoice(state, actorId, intent.charm);
  else if (intent.type === "maintain-hold") resolveMaintainHold(state, actorId, intent.useRopes);
  else if (intent.type === "recover") resolveRecover(state, actorId, intent);
  else if (intent.type === "pin") resolvePinChoice(state, actorId, intent);
  else if (intent.type === "submission") resolveSubmissionChoice(state, actorId, intent);
  else if (intent.type === "dodge-commit") resolveDodgeWindow(state, intent);
  else if (intent.type === "tag") resolveTag(state, actorId, intent.charm);
  else if (intent.type === "double-team") resolveDoubleTeam(state, actorId, intent);
  else if (intent.type === "distract-referee") resolveDistractReferee(state, actorId, intent.charm);
  else if (intent.type === "pin-interference") resolvePinInterference(state, actorId, intent);
  else if (intent.type === "enter-ring") resolveEnterRing(state, actorId);
  else if (intent.type === "exit-ring") resolveExitRing(state, actorId);
  else if (intent.type === "reenter") resolveReenter(state, actorId, intent.attackManeuverId);
  else if (intent.type === "cage-escape") resolveCageEscape(state, actorId, intent.charm);
  else if (intent.type === "set-up-ladder") resolveSetUpLadder(state, actorId);
  else if (intent.type === "climb-retrieve") resolveClimbRetrieve(state, actorId, intent.charm);
  else if (intent.type === "knock-ladder") resolveKnockLadder(state, actorId);
  else if (intent.type === "decline-interference") {
    state.decision = null;
    if (state.pendingAction?.kind === "pin") resolvePinNow(state);
    else if (state.pendingAction?.kind === "submission") resolveSubmissionNow(state);
  } else if (intent.type === "decline-followup") {
    const wasDouble = decision.kind === "tag-double-team";
    state.pendingAction = null;
    state.decision = null;
    if (wasDouble) {
      const partner = partnerOf(state, actorId);
      if (partner) scheduleIncomingAfterTag(state, actorId, partner);
    }
    completeActivation(state, decision.completesActivationFor);
  }
}

export function advanceUntilPlayerDecision(input: MatchState): MatchState {
  // Search cursors are already discardable clones, so advancing them in place
  // avoids a full JSON round-trip per interior node. The live path still gets a
  // fresh clone so the caller's state is never mutated.
  const state = searchScoped.has(input) ? input : clone(input);
  let guard = 0;
  while (!state.result) {
    guard += 1;
    if (guard > 200_000) throw new Error("Match progression safety cap exceeded.");
    if (state.decision) {
      if (teamOf(state, state.decision.actorId) === "player" && state.decision.actions.length > 1) return state;
      const action = teamOf(state, state.decision.actorId) === "ai" ? chooseAiAction(state, state.decision) : state.decision.actions[0];
      if (!action) throw new Error(`Forced decision has no legal action: ${JSON.stringify(state.decision)}; pending ${JSON.stringify(state.pendingAction)}.`);
      if (teamOf(state, state.decision.actorId) === "ai") {
        const pre = stateHashForRecord(state);
        recordEvent(state, pre, state.decision.actorId, "ai-choice", `AI selects ${action.label}.`, [`Utility score: ${action.estimatedUtility?.toFixed(2) ?? "n/a"}.`, `Policy ${aiPolicyLabel(state)}; action came from the shared legality validator; no hidden modifier or future die was used.`], []);
      }
      performDecision(state, action);
      continue;
    }
    if (!state.dodgeWindowResolved && state.phase > 0 && state.phaseQueue.length > 0) {
      if (openDodgeWindow(state) && state.decision) continue;
    }
    if (state.phaseQueue.length > 0) {
      const next = state.phaseQueue.shift();
      if (next) openTurn(state, next);
      continue;
    }
    if (state.phase === 10 && !state.phaseEndProcessed) {
      state.phaseEndProcessed = true;
      state.freeRecoveryQueue = [...state.activeWrestlerIds];
    }
    if (state.freeRecoveryQueue.length > 0) {
      const id = state.freeRecoveryQueue.shift();
      if (id) openFreeRecovery(state, id);
      continue;
    }
    if (state.phase === 10 && state.phaseEndProcessed && state.minute >= state.config.timeLimitMinutes) {
      const pre = stateHashForRecord(state);
      setResult(state, null, null, "time-limit-draw", "The match reaches a time-limit draw.");
      recordEvent(state, pre, "system", "time-limit", "The match reaches a time-limit draw.", [], []);
      break;
    }
    startNextPhase(state);
  }
  return state;
}

/**
 * Marks a match state for discardable, in-place advancement: `advanceUntilPlayerDecision`
 * and `submitPlayerIntent` then mutate the caller's object instead of cloning it
 * (the caller must own it and never reuse it), and recorded events carry empty
 * pre/post hashes instead of a full state hash per event. Decisions, the RNG
 * stream, the input log, and `hashMatchState` of the final state are identical
 * to the live path (`hashMatchState` excludes the event array), so a marked
 * match can still be replayed via `replayFromInputLog`. Intended for headless
 * simulation loops (ladder separation tests, playtest batches) that discard
 * every intermediate state and never verify recorded event hashes.
 */
export function markDiscardable(state: MatchState): MatchState {
  searchScoped.add(state);
  return state;
}

export function submitPlayerIntent(input: MatchState, intent: Intent): MatchState {
  const state = searchScoped.has(input) ? input : clone(input);
  const actorId = state.decision?.actorId;
  if (!actorId || teamOf(state, actorId) !== "player") throw new Error("No player decision is open.");
  assertIntentLegal(state, actorId, intent);
  state.inputLog.push(clone(intent));
  const action = state.decision?.actions.find((candidate) => canonicalSerialize(candidate.intent) === canonicalSerialize(intent));
  if (!action) throw new Error("The selected action is no longer legal.");
  performDecision(state, action);
  if (state.config.scenarioId) return state;
  return advanceUntilPlayerDecision(state);
}

export function stepRulesLab(input: MatchState): MatchState {
  const state = clone(input);
  if (!state.config.scenarioId) throw new Error("Transaction stepping is available only in Rules Lab scenarios.");
  if (state.result) return state;
  if (state.decision) {
    if (teamOf(state, state.decision.actorId) === "player") return state;
    const action = chooseAiAction(state, state.decision);
    const pre = stateHashForRecord(state);
    recordEvent(state, pre, state.decision.actorId, "ai-choice", `AI selects ${action.label}.`, [`Utility score: ${action.estimatedUtility?.toFixed(2) ?? "n/a"}.`, `Policy ${aiPolicyLabel(state)}; action came from the shared legality validator; no hidden modifier or future die was used.`, "Rules Lab stepped exactly one AI transaction."], []);
    performDecision(state, action);
    return state;
  }
  if (!state.dodgeWindowResolved && state.phase > 0 && state.phaseQueue.length > 0) {
    openDodgeWindow(state);
    return state;
  }
  if (state.phaseQueue.length > 0) {
    const next = state.phaseQueue.shift();
    if (next) openTurn(state, next);
    return state;
  }
  if (state.phase === 10 && !state.phaseEndProcessed) {
    state.phaseEndProcessed = true;
    state.freeRecoveryQueue = [...state.activeWrestlerIds];
  }
  if (state.freeRecoveryQueue.length > 0) {
    const id = state.freeRecoveryQueue.shift();
    if (id) openFreeRecovery(state, id);
    return state;
  }
  if (state.phase === 10 && state.phaseEndProcessed && state.minute >= state.config.timeLimitMinutes) {
    const pre = stateHashForRecord(state);
    setResult(state, null, null, "time-limit-draw", "The match reaches a time-limit draw.");
    recordEvent(state, pre, "system", "time-limit", "The match reaches a time-limit draw.", [], []);
    return state;
  }
  startNextPhase(state);
  return state;
}

function initialRuntime(definition: MatchState["roster"][WrestlerId], location: "ring" | "apron"): MatchState["wrestlers"][WrestlerId] {
  return {
    id: definition.id,
    currentDamage: startingDamage(definition),
    currentEndurance: startingEndurance(definition),
    charmRemaining: definition.skills.charm,
    matchAvModifier: 0,
    matchDvModifier: 0,
    halfDvForMatch: false,
    stunnedUntilTick: 0,
    knockedOutUntilTick: null,
    knockedOutForMatch: false,
    skipActivePhases: 0,
    nextAttackAvBonus: 0,
    nextAttackAvBonusReadyTick: 0,
    nextDefenseDvPenalty: 0,
    nextDefenseDvPenaltyReadyTick: 0,
    injuryWeeks: 0,
    location,
    thrownOutAtTick: null,
    damageTakenThisPhase: 0,
    dodgingUntilTick: 0,
    egotistPosing: false,
    stupidMovesActive: false,
    lastStupidMovesCheckMinute: 0,
    outsideActionUsedTick: null,
    actedTick: null,
  };
}

export const RULES_LAB_SCENARIOS = [
  { id: "critical-hold-100", name: "Critical Hold 100", description: "Choose Bear Hug first; scripted dice demonstrate inherited injury and automatic submission.", scriptedRolls: [5, 1, 1, 100, 6, 6, 6, 6] },
  { id: "whip-transfer", name: "Irish Whip transfer", description: "Choose Irish Whip; scripted dice make the Whip succeed and the Strike miss.", scriptedRolls: [5, 8, 20, 20] },
  { id: "countout", name: "Countout", description: "Choose Throw Out of Ring; the next phase countout check is scripted to 10.", scriptedRolls: [5, 5, 6, 6, 6, 10] },
] as const;

function selectTeamMembers(roster: MatchState["roster"], setup: MatchSetup, teamId: TeamId, required: number): WrestlerId[] {
  const requested = setup.teamMembers?.[teamId] ?? Object.values(roster).filter((row) => row.teamId === teamId).map((row) => row.id);
  if (requested.length < required) throw new Error(`${teamId} needs ${required} wrestler${required === 1 ? "" : "s"}; received ${requested.length}.`);
  const selected = requested.slice(0, required);
  if (new Set(selected).size !== selected.length) throw new Error(`${teamId} team contains a duplicate wrestler ID.`);
  for (const id of selected) {
    const definition = roster[id];
    if (!definition) throw new Error(`${teamId} roster selection references unknown wrestler ${id}.`);
    if (definition.teamId !== teamId) throw new Error(`${id} is assigned to ${definition.teamId}, not ${teamId}.`);
  }
  return selected;
}

function buildMatchManeuvers(roster: MatchState["roster"]): Record<string, MatchState["maneuvers"][string]> {
  const catalog = structuredClone(MANEUVERS) as Record<string, MatchState["maneuvers"][string]>;
  for (const wrestler of Object.values(roster)) for (const [id, move] of Object.entries(wrestler.customManeuvers ?? {})) {
    if (catalog[id] && JSON.stringify(catalog[id]) !== JSON.stringify(move)) throw new Error(`Conflicting maneuver definition for ${id}.`);
    catalog[id] = structuredClone(move);
  }
  return catalog;
}

function initiativeOrder(state: MatchState, dice: DieRoll[]): WrestlerId[] {
  const byQuickness = new Map<number, WrestlerId[]>();
  for (const id of state.activeWrestlerIds) {
    const quickness = wrestlerDefinition(state, id).attributes.qui;
    byQuickness.set(quickness, [...(byQuickness.get(quickness) ?? []), id]);
  }
  const ordered: WrestlerId[] = [];
  for (const quickness of [...byQuickness.keys()].sort((a, b) => b - a)) {
    const tied = byQuickness.get(quickness)!;
    if (tied.length === 1) { ordered.push(tied[0]); continue; }
    let unresolved = [...tied];
    const tieValues = new Map<WrestlerId, number>();
    while (unresolved.length) {
      const rolls = unresolved.map((id) => ({ id, roll: rollDie(state, 6, `initiative tie ${id}`, dice) }));
      const counts = new Map<number, number>();
      for (const row of rolls) counts.set(row.roll, (counts.get(row.roll) ?? 0) + 1);
      const next: WrestlerId[] = [];
      for (const row of rolls) {
        if (counts.get(row.roll) === 1) tieValues.set(row.id, row.roll);
        else next.push(row.id);
      }
      unresolved = next;
    }
    ordered.push(...[...tied].sort((left, right) => (tieValues.get(right) ?? 0) - (tieValues.get(left) ?? 0) || left.localeCompare(right)));
  }
  return ordered;
}

/** Creates a normal-play match with fresh entropy while retaining the deterministic match PRNG. */
export function createRandomMatch(configuration: MatchSetup = {}, source?: RandomUint32Source): MatchState {
  return createMatch({ ...configuration, seed: generateRandomSeed(source) });
}

export function createMatch(configuration: MatchSetup = {}): MatchState {
  const dataErrors = validateRulesData();
  if (dataErrors.length) throw new Error(`Rules Data Pack validation failed:\n${dataErrors.join("\n")}`);
  if (configuration.aiDifficulty !== undefined && !(AI_DIFFICULTIES as readonly string[]).includes(configuration.aiDifficulty)) throw new Error(`Unsupported AI difficulty ${String(configuration.aiDifficulty)}.`);
  const scenario = RULES_LAB_SCENARIOS.find((entry) => entry.id === configuration.scenarioId);
  const mode = configuration.mode ?? "singles";
  if (configuration.variety !== undefined && !(MATCH_VARIETIES as readonly string[]).includes(configuration.variety)) throw new Error(`Unsupported match variety ${String(configuration.variety)}.`);
  // `standard` is normalized away so an explicit standard match hashes exactly
  // like the default, matching the M10 `aiDifficulty` normalization precedent.
  const variety = configuration.variety === "standard" ? undefined : configuration.variety;
  if (variety && mode === "tag") throw new Error(`${variety} matches are singles-only in v1 (M11).`);
  const suppliedRoster = structuredClone(configuration.roster ?? WRESTLERS);
  for (const [id, definition] of Object.entries(suppliedRoster)) if (definition.id !== id) throw new Error(`Roster key ${id} does not match definition ID ${definition.id}.`);
  const required = mode === "tag" ? 2 : 1;
  const teamMembers = {
    player: selectTeamMembers(suppliedRoster, configuration, "player", required),
    ai: selectTeamMembers(suppliedRoster, configuration, "ai", required),
  };
  const activeWrestlerIds = [...teamMembers.player, ...teamMembers.ai];
  const roster = Object.fromEntries(activeWrestlerIds.map((id) => [id, suppliedRoster[id]]));
  const maneuvers = buildMatchManeuvers(roster);
  const config: MatchConfiguration = {
    seed: configuration.seed ?? 1991,
    timeLimitMinutes: configuration.timeLimitMinutes ?? 10,
    mode,
    titleModifier: configuration.titleModifier ?? 0,
    playerRecoveryPolicy: configuration.playerRecoveryPolicy ?? "lowest-percent",
    aiRecoveryPolicy: configuration.aiRecoveryPolicy ?? "lowest-percent",
    scenarioId: configuration.scenarioId ?? null,
    scriptedRolls: configuration.scriptedRolls ?? (scenario ? [...scenario.scriptedRolls] : undefined),
    aiDifficulty: configuration.aiDifficulty,
    variety,
    roster,
    teamMembers,
  };
  const rng = createRng(config.seed, config.scriptedRolls ?? []);
  const dataHash = fnv1a32({ rules: DATA_HASH, m4: M4_DATA_HASH, roster, customManeuvers: Object.fromEntries(Object.entries(maneuvers).filter(([, move]) => move.custom)) });
  const state: MatchState = {
    rulesetId: "classic-1991-vertical-slice",
    rulesetVersion: RULESET_VERSION,
    dataHash,
    roster,
    maneuvers,
    config,
    rng,
    minute: 1,
    phase: 0,
    tick: 0,
    activeWrestlerIds,
    initiative: [],
    phaseQueue: [],
    freeRecoveryQueue: [],
    phaseEndProcessed: false,
    processedThisPhase: [],
    currentActorId: null,
    wrestlers: Object.fromEntries(activeWrestlerIds.map((id) => [id, initialRuntime(roster[id], id === teamMembers.player[0] || id === teamMembers.ai[0] ? "ring" : "apron")])),
    teams: {
      player: { id: "player", members: teamMembers.player, legalInRingId: teamMembers.player[0], illegalEntrantId: null, entryEligibleId: null, exitDeadlineTick: null },
      ai: { id: "ai", members: teamMembers.ai, legalInRingId: teamMembers.ai[0], illegalEntrantId: null, entryEligibleId: null, exitDeadlineTick: null },
    },
    hold: null,
    momentum: null,
    referee: { level: 0, cumulativeModifier: 0, distractedUntilTick: 0, knockedOutUntilTick: 0, rollPenalty: 0, rollPenaltyUntilTick: 0 },
    dodgeWindowResolved: false,
    decision: null,
    pendingAction: null,
    result: null,
    events: [],
    inputLog: [],
    nonCanonical: Boolean(config.scriptedRolls?.length),
  };
  const pre = stateHashForRecord(state);
  const dice: DieRoll[] = [];
  state.initiative = initiativeOrder(state, dice);
  state.referee.level = rollDie(state, 10, "match referee level", dice) + config.titleModifier;
  recordEvent(state, pre, "system", "match-start", `${config.mode === "tag" ? "Tag" : "Singles"} match created with seed ${config.seed}.`, [
    `Rules ${state.rulesetId}@${RULESET_VERSION}; data ${dataHash}.`,
    `Referee level: ${state.referee.level}.`,
    `Initiative: ${state.initiative.map((id) => wrestlerDefinition(state, id).name).join(" then ")}.`,
    scenario ? `Rules Lab scenario: ${scenario.name}.` : "Canonical exhibition configuration.",
    ...(config.variety ? [`Match variety: ${config.variety}.`] : []),
  ], dice);
  return config.scenarioId ? state : advanceUntilPlayerDecision(state);
}

export function visiblePinTarget(state: MatchState, actorId: WrestlerId, illegal: boolean): number {
  const defenderId = opponentFor(state, actorId);
  const recent = state.pendingAction?.kind === "pin" ? state.pendingAction.recentDamage : recentNetDamage(state);
  return currentAv(state, actorId) + (illegal ? wrestlerDefinition(state, actorId).skills.illegalPin : 0) + Math.floor(recent / 10) -
    (currentDv(state, defenderId) + wrestlerDefinition(state, defenderId).skills.escapePin + state.wrestlers[defenderId].currentDamage);
}

export function visibleSubmissionTarget(state: MatchState, actorId: WrestlerId): number {
  const defenderId = state.pendingAction?.kind === "submission" ? state.pendingAction.defenderId : opponentFor(state, actorId);
  const recent = state.pendingAction?.kind === "submission" ? state.pendingAction.recentDamage : recentNetDamage(state);
  return currentAv(state, actorId) + Math.floor(recent / 10) - (currentDv(state, defenderId) + state.wrestlers[defenderId].currentEndurance);
}

/**
 * Version of the exported replay document format (`replayVersion` field in
 * `exportReplayDocument`). Bump on any breaking change to the exported schema,
 * `config`, or `inputs` shape so older exports are detectable as drift.
 */
export const REPLAY_VERSION = 2;

export interface ExportedReplayDocument {
  replayVersion: number;
  rulesetVersion: string;
  dataHash: string;
  config: MatchConfiguration;
  inputs: Intent[];
  expectedStateHash: string;
}

/** Builds the versioned replay document the app exports (single source of truth for `replayVersion`). */
export function exportReplayDocument(match: MatchState): ExportedReplayDocument {
  return {
    replayVersion: REPLAY_VERSION,
    rulesetVersion: match.rulesetVersion,
    dataHash: match.dataHash,
    config: match.config,
    inputs: match.inputLog,
    expectedStateHash: hashMatchState(match),
  };
}

export function replayFromInputLog(source: MatchState): MatchState {
  let replay = createMatch({ ...source.config, scriptedRolls: source.config.scriptedRolls });
  for (const intent of source.inputLog) {
    if (replay.result) break;
    while (source.config.scenarioId && (!replay.decision || teamOf(replay, replay.decision.actorId) !== "player")) {
      const before = hashMatchState(replay);
      replay = stepRulesLab(replay);
      if (hashMatchState(replay) === before) break;
    }
    replay = submitPlayerIntent(replay, intent);
  }
  while (source.config.scenarioId && replay.events.length < source.events.length && !replay.result) {
    const before = hashMatchState(replay);
    replay = stepRulesLab(replay);
    if (hashMatchState(replay) === before) break;
  }
  return replay;
}
