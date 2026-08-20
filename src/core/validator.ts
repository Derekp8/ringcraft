import {
  charmCheckBonus,
  currentAv,
  currentDv,
  expectedExpression,
  exposureAttackBonus,
  isKnockedOut,
  isLegalInRing,
  isOutsidePartner,
  maneuver,
  maneuverProficiency,
  nextActiveTick,
  opponentFor,
  partnerOf,
  poolCurrent,
  poolMaximum,
  purchasedManeuverLevel,
  recoveryLocked,
  specialProficiency,
  teamOf,
  wrestlerDefinition,
} from "./derived";
import { canonicalSerialize } from "./hash";
import { ESCAPE_DIFFICULTY, ESCAPE_LEGALITY_THRESHOLD } from "./types";
import type { Intent, LegalAction, MatchState, Pool, WrestlerId } from "./types";

/** Damage actually taken by a wrestler (the pool starts full and drains). */

function refereeCanCount(state: MatchState): boolean {
  return state.tick >= state.referee.distractedUntilTick && state.tick >= state.referee.knockedOutUntilTick;
}

function damageTaken(state: MatchState, id: WrestlerId): number {
  return poolMaximum(state, id, "damage") - poolCurrent(state, id, "damage");
}

function charmSpends(state: MatchState, actorId: WrestlerId): number[] {
  return Array.from({ length: Math.min(3, state.wrestlers[actorId].charmRemaining) + 1 }, (_, value) => value);
}

function maneuverEligible(state: MatchState, actorId: WrestlerId, maneuverId: string): boolean {
  const definition = wrestlerDefinition(state, actorId);
  const move = maneuver(state, maneuverId);
  if (move.illegal && definition.side !== "rulebreaker") return false;
  const attribute = move.kind === "hold" ? definition.attributes.tec : definition.attributes.pow;
  return attribute >= move.minAttribute;
}

function attackActions(
  state: MatchState,
  actorId: WrestlerId,
  options: { releaseHold?: boolean; bonusOnly?: boolean; purchasedOnly?: boolean } = {},
): LegalAction[] {
  const defenderId = opponentFor(state, actorId);
  const targetDv = currentDv(state, defenderId, true);
  const av = currentAv(state, actorId, true);
  const actions: LegalAction[] = [];
  const moves = Object.values(state.maneuvers).filter((move) => {
    if (!maneuverEligible(state, actorId, move.id)) return false;
    if (options.releaseHold && move.kind !== "strike") return false;
    if (options.purchasedOnly && purchasedManeuverLevel(state, actorId, move.id) <= 0) return false;
    return true;
  });

  for (const move of moves) {
    for (const charm of charmSpends(state, actorId)) {
      const target = av + maneuverProficiency(state, actorId, move.id) + charmCheckBonus(charm, Boolean(move.submission || move.finisher)) +
        (options.releaseHold ? 2 : 0) + exposureAttackBonus(state, defenderId) - targetDv;
      const purchased = purchasedManeuverLevel(state, actorId, move.id);
      actions.push({
        key: `attack:${move.id}:${charm}:${options.releaseHold ? 1 : 0}`,
        label: `${options.releaseHold ? "Release + " : ""}${move.name}${purchased ? "" : " (untrained)"}`,
        detail: `${move.kind === "hold" ? "Hold" : "Strike"} - target ${target} - ${move.endCost} END - avg. base ${expectedExpression(move.damage).toFixed(1)}${move.illegal ? " - illegal" : ""}`,
        intent: { type: "attack", maneuverId: move.id, attackCharm: charm, releaseHold: options.releaseHold },
      });
    }
  }

  const momentum = state.momentum?.ownerId === actorId && state.tick < state.momentum.expiresAtTick;
  if (momentum && !options.releaseHold) {
    for (const move of moves.filter((candidate) => candidate.kind === "strike" && candidate.whipEligible)) {
      for (const charm of charmSpends(state, actorId)) {
        actions.push({
          key: `momentum:${move.id}:${charm}`,
          label: `${move.name} + transferred momentum`,
          detail: `Consume transferred Irish Whip momentum for +2D6 on hit; ${move.endCost} END.`,
          intent: { type: "attack", maneuverId: move.id, attackCharm: charm, useMomentum: true },
        });
      }
    }
  }
  return actions;
}

function whipActions(state: MatchState, actorId: WrestlerId, releaseHold = false): LegalAction[] {
  const definition = wrestlerDefinition(state, actorId);
  const defenderId = opponentFor(state, actorId);
  const proficiency = specialProficiency(definition.skills.irishWhip, -5);
  const actions: LegalAction[] = [];
  for (const move of Object.values(state.maneuvers)) {
    if (move.kind !== "strike" || !move.whipEligible || move.finisher || !maneuverEligible(state, actorId, move.id)) continue;
    for (const charm of charmSpends(state, actorId)) {
      const target = currentAv(state, actorId, true) + proficiency + charmCheckBonus(charm, false) +
        (releaseHold ? 2 : 0) + exposureAttackBonus(state, defenderId) - currentDv(state, defenderId, true);
      actions.push({
        key: `whip:${move.id}:${charm}:${releaseHold ? 1 : 0}`,
        label: `${releaseHold ? "Release + " : ""}Irish Whip -> ${move.name}`,
        detail: `Whip target ${target}; 3 END, then ${move.endCost} END and +2D6 if the Strike hits.`,
        intent: { type: "irish-whip", strikeManeuverId: move.id, attackCharm: charm, releaseHold },
      });
    }
  }
  return actions;
}

function recoveryActions(state: MatchState, actorId: WrestlerId, options: { free?: boolean; outside?: boolean } = {}): LegalAction[] {
  const actions: LegalAction[] = [];
  for (const pool of ["damage", "endurance"] as Pool[]) {
    if (poolCurrent(state, actorId, pool) >= poolMaximum(state, actorId, pool)) continue;
    const spends = options.outside ? [0] : charmSpends(state, actorId);
    for (const charm of spends) {
      actions.push({
        key: `recover:${pool}:${charm}:${options.free ? 1 : 0}:${options.outside ? 1 : 0}`,
        label: `${options.free ? "Free " : ""}Recover ${pool === "damage" ? "DAM PTS" : "END"}${charm ? ` (+${charm} Charm)` : ""}`,
        detail: `${options.outside ? "Unused outside-partner phase" : "Roll 1D6 plus permanent END modifier"}${charm ? `; Charm adds ${charm === 1 ? 5 : charm === 2 ? 10 : 15}` : ""}.`,
        intent: { type: "recover", pool, charm, free: options.free, outside: options.outside },
      });
    }
  }
  return actions;
}

function tagActions(state: MatchState, actorId: WrestlerId): LegalAction[] {
  if (state.config.mode !== "tag" || !isLegalInRing(state, actorId) || state.wrestlers[actorId].location !== "ring") return [];
  const partner = partnerOf(state, actorId);
  if (!partner || state.wrestlers[partner].location !== "apron" || state.wrestlers[partner].stupidMovesActive) return [];
  const skill = wrestlerDefinition(state, actorId).skills.tagTeam;
  return charmSpends(state, actorId).map((charm) => {
    const target = currentAv(state, actorId) + specialProficiency(skill, -5) + charmCheckBonus(charm, false) - state.wrestlers[actorId].damageTakenThisPhase;
    return {
      key: `tag:${charm}`,
      label: `Tag partner${charm ? ` (+${charm} Charm)` : ""}`,
      detail: `Target ${target}; same-phase net damage subtracts from the check.`,
      intent: { type: "tag" as const, charm },
    };
  });
}

function outsideActions(state: MatchState, actorId: WrestlerId): LegalAction[] {
  const actions = recoveryActions(state, actorId, { outside: true });
  actions.push({ key: "stay-apron", label: "Stay on the apron", detail: "Take no outside action; no recovery is needed or selected.", intent: { type: "decline-followup" } });
  const definition = wrestlerDefinition(state, actorId);
  const team = state.teams[teamOf(state, actorId)];
  const hasExitBeforeRefereeReturns = team.members.some((id) => nextActiveTick(state, id) < state.referee.distractedUntilTick);
  if (team.entryEligibleId === actorId && state.tick < state.referee.distractedUntilTick && hasExitBeforeRefereeReturns) {
    actions.unshift({ key: "enter-ring", label: "Enter during distraction", detail: "Enter and attack; one teammate must exit before the distraction ends.", intent: { type: "enter-ring" } });
  }
  if (!state.wrestlers[actorId].stupidMovesActive) {
    for (const charm of charmSpends(state, actorId)) {
      const proficiency = specialProficiency(definition.skills.distractReferee, -5);
      const target = currentAv(state, actorId) + proficiency + charmCheckBonus(charm, false) - state.referee.level;
      actions.push({ key: `distract:${charm}`, label: `Distract referee${charm ? ` (+${charm} Charm)` : ""}`, detail: `Target ${target}; every attempt adds +2 referee alert.`, intent: { type: "distract-referee", charm } });
    }
    if (state.hold?.defenderId === state.teams[teamOf(state, actorId)].legalInRingId) {
      for (const charm of charmSpends(state, actorId)) {
        actions.push({ key: `interfere-hold:${charm}`, label: `Break partner's Hold${charm ? ` (+${charm} Charm)` : ""}`, detail: "Pin Interference check; referee check occurs on success or failure.", intent: { type: "pin-interference", target: "hold", charm } });
      }
    }
  }
  return actions;
}

export function enumerateTurnActions(state: MatchState, actorId: WrestlerId): LegalAction[] {
  if (state.result || isKnockedOut(state, actorId)) return [];
  const runtime = state.wrestlers[actorId];
  const team = state.teams[teamOf(state, actorId)];
  if (recoveryLocked(state, actorId)) return recoveryActions(state, actorId).filter((action) => action.intent.type === "recover" && action.intent.pool === "endurance");
  if (runtime.location === "floor") {
    const actions: LegalAction[] = [{ key: "reenter", label: "Re-enter ring", detail: "Re-enter without another action.", intent: { type: "reenter" } }];
    for (const moveId of Object.keys(wrestlerDefinition(state, actorId).maneuverLevels)) {
      const move = state.maneuvers[moveId];
      if (!move || !maneuverEligible(state, actorId, moveId)) continue;
      actions.push({ key: `reenter:${moveId}`, label: `Re-enter + ${move.name}`, detail: "Re-enter and attack in the same phase; no Dodge or recovery.", intent: { type: "reenter", attackManeuverId: moveId } });
    }
    return actions;
  }
  if (state.config.mode === "tag" && isOutsidePartner(state, actorId)) return outsideActions(state, actorId);
  if (state.config.mode === "tag" && runtime.location === "ring" && team.legalInRingId !== actorId) {
    return [
      { key: "exit-ring", label: "Exit to the apron", detail: "Consume this phase and satisfy the distracted-referee exit requirement.", intent: { type: "exit-ring" } },
      ...attackActions(state, actorId, { purchasedOnly: false }),
    ];
  }
  if (!isLegalInRing(state, actorId)) return [];
  if (opponentFor(state, actorId) && state.wrestlers[opponentFor(state, actorId)].location === "floor") return recoveryActions(state, actorId);

  if (state.hold?.holderId === actorId) {
    const move = maneuver(state, state.hold.maneuverId);
    const actions: LegalAction[] = [{ key: "maintain-hold", label: `Maintain ${move.name}`, detail: `Pay ${move.endCost} END and deal another damage cycle.`, intent: { type: "maintain-hold", useRopes: false } }];
    if (!move.illegal && wrestlerDefinition(state, actorId).side === "rulebreaker") {
      actions.push({ key: "maintain-hold:ropes", label: `Maintain ${move.name} with ropes`, detail: "Ignore BODY and trigger a referee check.", intent: { type: "maintain-hold", useRopes: true } });
    }
    return [...actions, ...attackActions(state, actorId, { releaseHold: true }), ...whipActions(state, actorId, true)];
  }

  const actions = [...attackActions(state, actorId), ...whipActions(state, actorId), ...tagActions(state, actorId), ...recoveryActions(state, actorId)];
  if (state.config.mode === "tag" && state.teams[teamOf(state, actorId)].illegalEntrantId && state.wrestlers[actorId].location === "ring") {
    actions.unshift({ key: "exit-ring:legal", label: "Exit and leave partner legal", detail: "Satisfy the distraction exit requirement; referee alert increases by +1 because the entrant remains.", intent: { type: "exit-ring" } });
  }
  const targetId = opponentFor(state, actorId);
  if (isKnockedOut(state, targetId) && refereeCanCount(state)) {
    actions.unshift({ key: "pin:knockout", label: "Cover for the pin", detail: "The opponent is knocked out; no D20 roll is required.", intent: { type: "pin", illegal: false, automatic: true } });
  }
  // M11 match variety actions: the win conditions for cage/ladder matches. The
  // escape/retrieval check (AV + Charm - DV - climb difficulty, with the
  // defender's taken damage making the climb easier and the climber's own taken
  // damage making it harder) is legal only once the defender is softened past
  // ESCAPE_LEGALITY_THRESHOLD, so a fresh opponent cannot simply be climbed out
  // on. Ladder also has setup and knock-down counterplay. Tag-only paths are
  // unreachable because cage and ladder matches are singles-only.
  const variety = state.config.variety;
  const defenderBeaten = damageTaken(state, targetId) >= ESCAPE_LEGALITY_THRESHOLD;
  if (variety === "cage") {
    if (defenderBeaten) {
      for (const charm of charmSpends(state, actorId)) {
        const target = currentAv(state, actorId) + charmCheckBonus(charm, false) - currentDv(state, targetId) - ESCAPE_DIFFICULTY +
          Math.floor(damageTaken(state, targetId) / 10) - Math.floor(damageTaken(state, actorId) / 10);
        actions.push({
          key: `cage-escape:${charm}`,
          label: charm ? `Climb out of the cage (+${charm} Charm)` : "Climb out of the cage",
          detail: `Escape check target ${target}; the opponent is softened enough to climb out.`,
          intent: { type: "cage-escape", charm },
        });
      }
    }
  } else if (variety === "ladder") {
    if (!state.ladder) {
      actions.push({ key: "ladder:set-up", label: "Set up the ladder", detail: "Consume the phase; a set ladder then allows a retrieval check.", intent: { type: "set-up-ladder" } });
    } else {
      if (defenderBeaten) {
        for (const charm of charmSpends(state, actorId)) {
          const target = currentAv(state, actorId) + charmCheckBonus(charm, false) - currentDv(state, targetId) - ESCAPE_DIFFICULTY +
            Math.floor(damageTaken(state, targetId) / 10) - Math.floor(damageTaken(state, actorId) / 10);
          actions.push({
            key: `ladder:climb:${charm}`,
            label: charm ? `Climb and retrieve the object (+${charm} Charm)` : "Climb and retrieve the object",
            detail: `Retrieval check target ${target}; the opponent is softened enough to climb.`,
            intent: { type: "climb-retrieve", charm },
          });
        }
      }
      if (state.ladder.setById !== actorId) {
        actions.push({ key: "ladder:knock", label: "Knock the ladder down", detail: "Deny the opponent's win condition; consumes the phase.", intent: { type: "knock-ladder" } });
      }
    }
  }
  return actions;
}

export function enumerateDodgeCommit(state: MatchState, actorId: WrestlerId): LegalAction[] {
  const level = wrestlerDefinition(state, actorId).skills.dodge;
  return [
    { key: "dodge:no", label: "Do not Dodge", detail: "Keep the scheduled action.", intent: { type: "dodge-commit", dodge: false } },
    { key: "dodge:yes", label: "Dodge", detail: `Consume the phase and add ${level} DV through its end.`, intent: { type: "dodge-commit", dodge: true } },
  ];
}

export function enumerateDamageCharm(state: MatchState, actorId: WrestlerId): LegalAction[] {
  return charmSpends(state, actorId).map((charm) => ({
    key: `damage-charm:${charm}`, label: charm ? `Add ${charm}D6 with ${charm} Charm` : "Roll damage without Charm",
    detail: charm ? "Declared after the hit and critical result, before damage dice." : "Preserve the remaining Charm pool.",
    intent: { type: "choose-damage-charm", charm },
  }));
}

export function enumerateHoldEscape(state: MatchState, actorId: WrestlerId): LegalAction[] {
  return charmSpends(state, actorId).map((charm) => ({
    key: `escape-hold:${charm}`,
    label: charm ? `Escape Hold (+${charm} Charm)` : "Escape Hold",
    detail: `Mandatory Break Hold check; target ${holdEscapeTarget(state, actorId, charm)}. Charm is spent even if escape fails.`,
    intent: { type: "escape-hold", charm },
  }));
}

export function enumeratePinFollowup(state: MatchState, actorId: WrestlerId, automatic: boolean): LegalAction[] {
  const actions: LegalAction[] = [{ key: "pin:legal", label: automatic ? "Cover - automatic count" : "Attempt pin", detail: automatic ? "No D20 roll is required." : "Use the visible pin target.", intent: { type: "pin", illegal: false, automatic } }];
  if (!automatic && wrestlerDefinition(state, actorId).skills.illegalPin > 0) actions.push({ key: "pin:illegal", label: "Attempt illegal pin", detail: "A failed attempt triggers the referee.", intent: { type: "pin", illegal: true } });
  actions.push({ key: "decline", label: "Decline", detail: "End this active phase.", intent: { type: "decline-followup" } });
  return actions;
}

export function enumerateSubmissionFollowup(actorId: WrestlerId, automatic: boolean): LegalAction[] {
  return [
    { key: "submission", label: automatic ? "Resolve automatic submission" : "Demand submission", detail: automatic ? "Critical Hold 100 ends the match." : "Roll against the visible target.", intent: { type: "submission", automatic } },
    ...(automatic ? [] : [{ key: "decline", label: "Maintain without submission check", detail: "Keep the Hold and end the phase.", intent: { type: "decline-followup" } as Intent }]),
  ];
}

export function enumerateInterference(state: MatchState, actorId: WrestlerId, target: "pin" | "hold"): LegalAction[] {
  const actions: LegalAction[] = [{ key: "decline-interference", label: "Do not interfere", detail: "Allow the pending result to continue.", intent: { type: "decline-interference" } }];
  for (const charm of charmSpends(state, actorId)) actions.push({ key: `interfere:${target}:${charm}`, label: `Interfere${charm ? ` (+${charm} Charm)` : ""}`, detail: "Consumes the outside partner's scheduled action and triggers a referee check.", intent: { type: "pin-interference", target, charm } });
  return actions;
}

export function enumerateDoubleTeams(state: MatchState, actorId: WrestlerId): LegalAction[] {
  const partner = partnerOf(state, actorId);
  if (!partner) return [];
  const actorStrikes = Object.keys(wrestlerDefinition(state, actorId).maneuverLevels).filter((id) => state.maneuvers[id]?.kind === "strike").slice(0, 3);
  const partnerStrikes = Object.keys(wrestlerDefinition(state, partner).maneuverLevels).filter((id) => state.maneuvers[id]?.kind === "strike").slice(0, 3);
  const actions: LegalAction[] = [];
  const opponentId = opponentFor(state, actorId);
  const actorPosition = state.initiative.indexOf(actorId);
  const partnerPosition = state.initiative.indexOf(partner);
  const opponentPosition = state.initiative.indexOf(opponentId);
  const sameSideOfOpponent = (actorPosition < opponentPosition && partnerPosition < opponentPosition) || (actorPosition > opponentPosition && partnerPosition > opponentPosition);
  if (sameSideOfOpponent) for (const first of actorStrikes) for (const second of partnerStrikes) actions.push({ key: `double:strikes:${first}:${second}`, label: `${maneuver(state, first).name} + ${maneuver(state, second).name}`, detail: "Two Strike checks; BODY applies separately and net damage combines for a pin.", intent: { type: "double-team", sequence: "two-strikes", firstManeuverId: first, secondManeuverId: second } });
  const shared = Object.values(state.maneuvers).filter((move) => move.kind === "strike" && move.whipEligible && !move.finisher && maneuverEligible(state, actorId, move.id) && maneuverEligible(state, partner, move.id)).slice(0, 3);
  for (const move of shared) actions.push({ key: `double:whip:${move.id}`, label: `Shared Whip -> ${move.name}`, detail: "One whip check; both partners use the same Strike with +2D6 each.", intent: { type: "double-team", sequence: "shared-whip", firstManeuverId: move.id, secondManeuverId: move.id } });
  const quicker = wrestlerDefinition(state, actorId).attributes.qui >= wrestlerDefinition(state, partner).attributes.qui ? actorId : partner;
  const slower = quicker === actorId ? partner : actorId;
  const holdId = Object.keys(wrestlerDefinition(state, quicker).maneuverLevels).find((id) => state.maneuvers[id]?.kind === "hold");
  const strikeId = Object.keys(wrestlerDefinition(state, slower).maneuverLevels).find((id) => state.maneuvers[id]?.kind === "strike");
  if (holdId && strikeId) actions.push({ key: `double:hold-strike:${holdId}:${strikeId}`, label: `${maneuver(state, holdId).name} + ${maneuver(state, strikeId).name}`, detail: "Quicker partner applies the Hold; slower partner gets +2 AV, then the Hold ends.", intent: { type: "double-team", sequence: "hold-strike", firstManeuverId: holdId, secondManeuverId: strikeId } });
  actions.push({ key: "decline-double", label: "Complete the tag without a double team", detail: "Swap roles and continue phase timing.", intent: { type: "decline-followup" } });
  return actions;
}

export function assertIntentLegal(state: MatchState, actorId: WrestlerId, intent: Intent): void {
  const decision = state.decision;
  if (!decision || decision.actorId !== actorId) throw new Error("No decision is open for this actor.");
  const encoded = canonicalSerialize(intent);
  if (!decision.actions.some((action) => canonicalSerialize(action.intent) === encoded)) throw new Error(`Illegal intent for ${actorId}: ${encoded}`);
}

export function attackTarget(state: MatchState, actorId: WrestlerId, maneuverId: string, charm: number, release: boolean, extraAv = 0): number {
  const move = maneuver(state, maneuverId);
  const defenderId = opponentFor(state, actorId);
  return currentAv(state, actorId, true) + maneuverProficiency(state, actorId, maneuverId) + charmCheckBonus(charm, Boolean(move.submission || move.finisher)) +
    (release ? 2 : 0) + extraAv + exposureAttackBonus(state, defenderId) - currentDv(state, defenderId, true);
}

export function holdEscapeTarget(state: MatchState, defenderId: WrestlerId, charm = 0): number {
  if (!state.hold || state.hold.defenderId !== defenderId) throw new Error("Wrestler is not held.");
  const holderId = state.hold.holderId;
  const move = maneuver(state, state.hold.maneuverId);
  const breakProficiency = specialProficiency(wrestlerDefinition(state, defenderId).skills.breakHold, -1);
  return currentDv(state, defenderId) + breakProficiency + charmCheckBonus(charm, false) + state.hold.failedEscapes - state.hold.criticalEscapePenalty -
    purchasedManeuverLevel(state, holderId, move.id) - (move.breakRating ?? 0);
}
