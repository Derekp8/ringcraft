import {
  ATTRIBUTE_LOOKUPS,
  BODY_TABLE,
  CHARM_EFFECTS,
  DAMAGE_BONUS_BANDS,
  PHASE_SCHEDULE,
} from "./rules";
import type {
  Attributes,
  DiceExpression,
  ManeuverDefinition,
  MatchState,
  Pool,
  TeamId,
  WrestlerDefinition,
  WrestlerId,
} from "./types";

function band(value: number): number {
  return Math.min(9, Math.max(0, Math.floor((value - 1) / 10)));
}

export function baseAv(attributes: Attributes): number {
  const index = {
    pow: band(attributes.pow), agi: band(attributes.agi), qui: band(attributes.qui), tec: band(attributes.tec),
  };
  return 12 + ATTRIBUTE_LOOKUPS.powAv[index.pow] + ATTRIBUTE_LOOKUPS.agiAv[index.agi] +
    ATTRIBUTE_LOOKUPS.quiAv[index.qui] + ATTRIBUTE_LOOKUPS.tecAv[index.tec];
}

export function baseDv(attributes: Attributes): number {
  const index = {
    pow: band(attributes.pow), agi: band(attributes.agi), qui: band(attributes.qui), tec: band(attributes.tec),
  };
  return 5 + ATTRIBUTE_LOOKUPS.powDv[index.pow] + ATTRIBUTE_LOOKUPS.agiDv[index.agi] +
    ATTRIBUTE_LOOKUPS.quiDv[index.qui] + ATTRIBUTE_LOOKUPS.tecDv[index.tec];
}

export function startingDamage(definition: WrestlerDefinition): number {
  return Math.ceil((definition.attributes.pow + definition.attributes.end) / 2);
}

export function startingEndurance(definition: WrestlerDefinition): number {
  return definition.attributes.end;
}

export function recoveryModifier(definition: WrestlerDefinition): number {
  return Math.ceil(definition.attributes.end / 10);
}

export function movesPerMinute(definition: WrestlerDefinition): number {
  return Math.min(10, Math.floor(definition.attributes.agi / 10));
}

export function activePhases(definition: WrestlerDefinition): readonly number[] {
  return PHASE_SCHEDULE[movesPerMinute(definition)];
}

export function body(definition: WrestlerDefinition): number {
  const pow = definition.attributes.pow;
  const powBand = pow === 100 ? 5 : Math.floor(Math.max(1, pow) / 20);
  const weightBand = definition.weight <= 200 ? 0 : definition.weight <= 300 ? 1 : definition.weight <= 400 ? 2 : 3;
  return BODY_TABLE[powBand][weightBand];
}

export function damageBonus(definition: WrestlerDefinition): DiceExpression {
  const found = DAMAGE_BONUS_BANDS.find((entry) => definition.attributes.pow <= entry.maxPow);
  if (!found) throw new Error(`No damage-bonus band for POW ${definition.attributes.pow}.`);
  return found.expression;
}

export function charmCheckBonus(spend: number, restricted: boolean): number {
  const effect = CHARM_EFFECTS[spend as keyof typeof CHARM_EFFECTS];
  if (!effect) throw new Error(`Invalid Charm spend ${spend}.`);
  return restricted ? effect.restrictedCheck : effect.ordinaryCheck;
}

export function charmDamageDice(spend: number): number {
  const effect = CHARM_EFFECTS[spend as keyof typeof CHARM_EFFECTS];
  if (!effect) throw new Error(`Invalid Charm spend ${spend}.`);
  return effect.damageDice;
}

export function charmRecoveryBonus(spend: number): number {
  const effect = CHARM_EFFECTS[spend as keyof typeof CHARM_EFFECTS];
  if (!effect) throw new Error(`Invalid Charm spend ${spend}.`);
  return effect.recovery;
}

export function wrestlerDefinition(state: MatchState, id: WrestlerId): WrestlerDefinition {
  const found = state.roster[id];
  if (!found) throw new Error(`Unknown wrestler: ${id}`);
  return found;
}

export function maneuver(state: MatchState, id: string): ManeuverDefinition {
  const found = state.maneuvers[id];
  if (!found) throw new Error(`Unknown maneuver: ${id}`);
  return found;
}

export function teamOf(state: MatchState, id: WrestlerId): TeamId {
  return wrestlerDefinition(state, id).teamId;
}

export function opponentTeam(teamId: TeamId): TeamId {
  return teamId === "player" ? "ai" : "player";
}

export function opponentFor(state: MatchState, actorId: WrestlerId): WrestlerId {
  return state.teams[opponentTeam(teamOf(state, actorId))].legalInRingId;
}

export function partnerOf(state: MatchState, id: WrestlerId): WrestlerId | null {
  if (state.config.mode !== "tag") return null;
  return state.teams[teamOf(state, id)].members.find((member) => member !== id) ?? null;
}

export function purchasedManeuverLevel(state: MatchState, id: WrestlerId, maneuverId: string): number {
  return wrestlerDefinition(state, id).maneuverLevels[maneuverId] ?? 0;
}

export function maneuverProficiency(state: MatchState, id: WrestlerId, maneuverId: string): number {
  const purchased = purchasedManeuverLevel(state, id, maneuverId);
  return purchased > 0 ? purchased : -5;
}

export function specialProficiency(levels: number, untrainedPenalty: number): number {
  return levels > 0 ? levels : untrainedPenalty;
}

export function isKnockedOut(state: MatchState, id: WrestlerId): boolean {
  const runtime = state.wrestlers[id];
  return runtime.knockedOutForMatch || (runtime.knockedOutUntilTick !== null && state.tick < runtime.knockedOutUntilTick);
}

export function currentAv(state: MatchState, id: WrestlerId, includeNextAttack = false): number {
  if (isKnockedOut(state, id)) return 0;
  const runtime = state.wrestlers[id];
  return Math.max(0, baseAv(wrestlerDefinition(state, id).attributes) + runtime.matchAvModifier +
    (includeNextAttack && state.tick >= runtime.nextAttackAvBonusReadyTick ? runtime.nextAttackAvBonus : 0));
}

export function currentDv(state: MatchState, id: WrestlerId, includeNextDefense = false): number {
  if (isKnockedOut(state, id)) return 0;
  const runtime = state.wrestlers[id];
  const definition = wrestlerDefinition(state, id);
  let value = baseDv(definition.attributes) + runtime.matchDvModifier;
  if (runtime.currentDamage === 0) value -= 2;
  if (runtime.currentEndurance <= 0) value -= 2;
  if (runtime.halfDvForMatch || state.tick < runtime.stunnedUntilTick) value = Math.floor(value / 2);
  if (runtime.dodgingUntilTick > state.tick) value += definition.skills.dodge;
  if (includeNextDefense && state.tick >= runtime.nextDefenseDvPenaltyReadyTick) value -= runtime.nextDefenseDvPenalty;
  return Math.max(0, value);
}

export function exposureAttackBonus(state: MatchState, targetId: WrestlerId): number {
  const runtime = state.wrestlers[targetId];
  return runtime.egotistPosing || runtime.stupidMovesActive ? 5 : 0;
}

export function recoveryLocked(state: MatchState, id: WrestlerId): boolean {
  return state.wrestlers[id].currentEndurance <= -startingEndurance(wrestlerDefinition(state, id));
}

export function poolCurrent(state: MatchState, id: WrestlerId, pool: Pool): number {
  return pool === "damage" ? state.wrestlers[id].currentDamage : state.wrestlers[id].currentEndurance;
}

export function poolMaximum(state: MatchState, id: WrestlerId, pool: Pool): number {
  const definition = wrestlerDefinition(state, id);
  return pool === "damage" ? startingDamage(definition) : startingEndurance(definition);
}

export function expectedExpression(expression: DiceExpression): number {
  return expression.dice * ((expression.sides + 1) / 2) + expression.flat;
}

export function nextActiveTick(state: MatchState, id: WrestlerId, afterTick = state.tick): number {
  const phases = activePhases(wrestlerDefinition(state, id));
  if (phases.length === 0) return Number.MAX_SAFE_INTEGER;
  const currentPhase = state.phase || 0;
  for (let delta = 1; delta <= 20; delta += 1) {
    const phase = ((currentPhase + delta - 1) % 10) + 1;
    if (phases.includes(phase)) return afterTick + delta;
  }
  return Number.MAX_SAFE_INTEGER;
}

export function isLegalInRing(state: MatchState, id: WrestlerId): boolean {
  return state.teams[teamOf(state, id)].legalInRingId === id;
}

export function isOutsidePartner(state: MatchState, id: WrestlerId): boolean {
  return state.config.mode === "tag" && !isLegalInRing(state, id) && state.wrestlers[id].location === "apron";
}
