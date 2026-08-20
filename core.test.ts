import { describe, expect, it } from "vitest";
import {
  activePhases,
  advanceUntilPlayerDecision,
  baseAv,
  baseDv,
  body,
  canonicalHash64,
  chooseAiAction,
  createMatch,
  enumerateHoldEscape,
  enumerateInterference,
  enumerateTurnActions,
  hashMatchState,
  holdEscapeTarget,
  MANEUVERS,
  maneuverConstructionCost,
  refereeTotal,
  replayFromInputLog,
  startingDamage,
  stepRulesLab,
  submitPlayerIntent,
  validateRulesData,
  WRESTLERS,
} from "../src/core";
import type { Intent, MatchState, WrestlerId } from "../src/core";

function choose(state: MatchState, predicate: (intent: Intent) => boolean): Intent {
  const action = state.decision?.actions.find((candidate) => predicate(candidate.intent));
  if (!action) throw new Error(`Expected legal action was unavailable. Decision: ${JSON.stringify(state.decision)}`);
  return action.intent;
}

function chooseNoDodge(state: MatchState): MatchState {
  if (state.decision?.kind !== "dodge-commit") return state;
  return submitPlayerIntent(state, choose(state, (intent) => intent.type === "dodge-commit" && !intent.dodge));
}

function chooseDamageCharm(state: MatchState, charm = 0): MatchState {
  if (state.decision?.kind !== "damage-charm") return state;
  return submitPlayerIntent(state, choose(state, (intent) => intent.type === "choose-damage-charm" && intent.charm === charm));
}

function safePlayerAction(state: MatchState): Intent {
  const actions = state.decision?.actions ?? [];
  const predicates: Array<(intent: Intent) => boolean> = [
    (intent) => intent.type === "choose-damage-charm" && intent.charm === 0,
    (intent) => intent.type === "escape-hold" && intent.charm === 0,
    (intent) => intent.type === "dodge-commit" && !intent.dodge,
    (intent) => intent.type === "decline-interference",
    (intent) => intent.type === "pin" || intent.type === "submission",
    (intent) => intent.type === "recover" && intent.charm === 0,
    (intent) => intent.type === "tag" && intent.charm === 0,
    (intent) => intent.type === "double-team",
    (intent) => intent.type === "attack" && intent.attackCharm === 0 && state.roster[state.decision!.actorId].maneuverLevels[intent.maneuverId] > 0,
    (intent) => intent.type === "irish-whip" && intent.attackCharm === 0,
    (intent) => intent.type === "distract-referee" && intent.charm === 0,
    () => true,
  ];
  for (const predicate of predicates) {
    const action = actions.find((candidate) => predicate(candidate.intent));
    if (action) return action.intent;
  }
  throw new Error(`No player action in ${JSON.stringify(state.decision)}`);
}

function aggressivePlayerAction(state: MatchState): Intent {
  const actions = state.decision?.actions ?? [];
  const preferred = [
    (intent: Intent) => intent.type === "choose-damage-charm" && intent.charm === 0,
    (intent: Intent) => intent.type === "escape-hold" && intent.charm === 0,
    (intent: Intent) => intent.type === "dodge-commit" && !intent.dodge,
    (intent: Intent) => intent.type === "decline-interference",
    (intent: Intent) => intent.type === "pin" || intent.type === "submission",
    (intent: Intent) => intent.type === "double-team",
    (intent: Intent) => intent.type === "attack" && intent.attackCharm === 0 && state.roster[state.decision!.actorId].maneuverLevels[intent.maneuverId] > 0,
    (intent: Intent) => intent.type === "irish-whip" && intent.attackCharm === 0,
    (intent: Intent) => intent.type === "tag" && intent.charm === 0,
    (intent: Intent) => intent.type === "recover" && intent.charm === 0,
    (intent: Intent) => intent.type === "decline-followup",
    (_intent: Intent) => true,
  ];
  for (const predicate of preferred) {
    const action = actions.find((candidate) => predicate(candidate.intent));
    if (action) return action.intent;
  }
  throw new Error("No aggressive action available.");
}

describe("versioned Rules Data Pack", () => {
  it("contains the complete source Hold chart and reconciles every listed construction cost", () => {
    expect(validateRulesData()).toEqual([]);
    expect(Object.values(MANEUVERS).filter((move) => move.kind === "hold")).toHaveLength(24);
    expect(Object.keys(MANEUVERS).length).toBeGreaterThan(80);
    for (const move of Object.values(MANEUVERS)) expect(maneuverConstructionCost(move), move.name).toBe(move.listedCost);
  });

  it("keeps the audited source flags on representative table rows", () => {
    expect(MANEUVERS["choke-with-ropes"]).toMatchObject({ kind: "hold", illegal: true, usesDamageBonus: true, breakRating: 4 });
    expect(MANEUVERS["throw-out-of-ring"]).toMatchObject({ kind: "strike", throwsOut: true, whipEligible: true });
    expect(MANEUVERS.brainbuster).toMatchObject({ finisher: true, whipEligible: false });
  });

  it("stores a Charm pool larger than the per-use cap", () => {
    expect(WRESTLERS["player-a"].skills.charm).toBe(4);
    const state = createMatch({ seed: 7 });
    expect(state.wrestlers["player-a"].charmRemaining).toBe(4);
  });

  it("uses a versioned 64-bit canonical state hash", () => {
    const hash = canonicalHash64({ b: 2, a: 1 });
    expect(hash).toMatch(/^c14n-fnv1a64-v1:[0-9a-f]{16}$/);
    expect(hash).toBe(canonicalHash64({ a: 1, b: 2 }));
  });
});

describe("audited derived rules", () => {
  it("derives fixture values from source lookup bands", () => {
    const atlas = WRESTLERS["player-a"];
    const duke = WRESTLERS["ai-a"];
    expect(baseAv(atlas.attributes)).toBe(21);
    expect(baseDv(atlas.attributes)).toBe(12);
    expect(startingDamage(atlas)).toBe(61);
    expect(body(atlas)).toBe(3);
    expect(baseAv(duke.attributes)).toBe(21);
    expect(baseDv(duke.attributes)).toBe(11);
    expect(startingDamage(duke)).toBe(55);
    expect(body(duke)).toBe(3);
  });

  it("uses the audited 1-, 2-, and 7-move phase rows", () => {
    expect(activePhases({ ...WRESTLERS["player-a"], attributes: { ...WRESTLERS["player-a"].attributes, agi: 10 } })).toEqual([5]);
    expect(activePhases({ ...WRESTLERS["player-a"], attributes: { ...WRESTLERS["player-a"].attributes, agi: 20 } })).toEqual([5, 10]);
    expect(activePhases({ ...WRESTLERS["player-a"], attributes: { ...WRESTLERS["player-a"].attributes, agi: 70 } })).toEqual([2, 3, 5, 6, 7, 9, 10]);
  });

  it("subtracts purchased levels in referee arithmetic, never untrained proficiency", () => {
    expect(refereeTotal(7, 6, 2, 0, 0, 0)).toBe(15);
    expect(refereeTotal(7, 6, 2, 0, 0, -5)).toBe(20);
    expect(refereeTotal(7, 6, 2, 0, 0, 3)).toBe(12);
  });
});

describe("complete singles transaction surface", () => {
  it("applies Strike BODY, overflow order, and opens only a Strike pin window", () => {
    let state = chooseNoDodge(createMatch({ scriptedRolls: [5, 5, 6, 6, 6] }));
    state = submitPlayerIntent(state, choose(state, (intent) => intent.type === "attack" && intent.maneuverId === "body-slam" && intent.attackCharm === 0));
    expect(state.decision?.kind).toBe("damage-charm");
    state = chooseDamageCharm(state, 0);
    expect(state.wrestlers["ai-a"].currentDamage).toBe(39);
    expect(state.wrestlers["ai-a"].currentEndurance).toBe(55);
    expect([...state.events].reverse().find((event) => event.type === "attack")?.detail).toContain("Recent net damage: 16");
  });

  it("declares damage Charm only after a hit and spends the selected amount", () => {
    let state = chooseNoDodge(createMatch({ scriptedRolls: [5, 5, 2, 2, 2, 6, 6] }));
    state = submitPlayerIntent(state, choose(state, (intent) => intent.type === "attack" && intent.maneuverId === "body-slam" && intent.attackCharm === 0));
    expect(state.decision?.kind).toBe("damage-charm");
    expect(state.wrestlers["player-a"].charmRemaining).toBe(4);
    state = chooseDamageCharm(state, 2);
    expect(state.wrestlers["player-a"].charmRemaining).toBe(2);
    expect([...state.events].reverse().find((event) => event.type === "attack")?.detail.join(" ")).toContain("Recent net damage:");
  });

  it("rolls exactly one REC D6 and uses permanent END plus recovery Charm", () => {
    let state = chooseNoDodge(createMatch({ scriptedRolls: [5, 3] }));
    state.wrestlers["player-a"].currentEndurance = 40;
    state.decision = {
      actorId: "player-a", completesActivationFor: "player-a", kind: "turn", prompt: "test",
      actions: [{ key: "recover", label: "Recover", detail: "test", intent: { type: "recover", pool: "endurance", charm: 1 } }],
    };
    state = submitPlayerIntent(state, { type: "recover", pool: "endurance", charm: 1 });
    const recovery = state.events.find((event) => event.type === "recovery");
    expect(recovery?.dice).toHaveLength(1);
    expect(recovery?.detail[0]).toContain("ceil(permanent END 60/10) (6) + Charm 5 = 14");
  });

  it("preserves Critical Hold 100 injury and automatic submission", () => {
    let state = chooseNoDodge(createMatch({ scriptedRolls: [5, 1, 1, 100, 6, 6, 6, 6, 20] }));
    state = submitPlayerIntent(state, choose(state, (intent) => intent.type === "attack" && intent.maneuverId === "bear-hug" && intent.attackCharm === 0));
    state = chooseDamageCharm(state, 0);
    expect(state.wrestlers["ai-a"].injuryWeeks).toBe(6);
    expect(state.result?.method).toBe("submission");
    expect(state.result?.winnerTeamId).toBe("player");
  });

  it("transfers Irish Whip momentum after a successful Whip and missed Strike", () => {
    let state = chooseNoDodge(createMatch({ scriptedRolls: [5, 5, 19] }));
    state = submitPlayerIntent(state, choose(state, (intent) => intent.type === "irish-whip" && intent.strikeManeuverId === "clothesline" && intent.attackCharm === 0));
    expect(state.events.some((event) => event.detail.some((line) => line.includes("Transferred momentum")))).toBe(true);
  });

  it("offers Rulebreaker rope maintenance and ignores BODY while checking the referee", () => {
    let state = createMatch({ scriptedRolls: [5, 6, 6, 4] });
    state.phase = 2; state.tick = 2; state.currentActorId = "ai-a";
    state.hold = { holderId: "ai-a", defenderId: "player-a", maneuverId: "headlock", failedEscapes: 0, criticalEscapePenalty: 0 };
    state.decision = { actorId: "ai-a", completesActivationFor: "ai-a", kind: "turn", prompt: "test", actions: enumerateTurnActions(state, "ai-a") };
    const rope = state.decision.actions.find((action) => action.intent.type === "maintain-hold" && action.intent.useRopes);
    expect(rope).toBeDefined();
    state.decision = { ...state.decision, actions: [rope!] };
    state = advanceUntilPlayerDecision(state);
    expect(state.events.some((event) => event.detail.some((line) => line.includes("BODY ignored")))).toBe(true);
    expect(state.events.some((event) => event.detail.some((line) => line.startsWith("Referee:")))).toBe(true);
  });

  it("collects and reveals Dodge commitments before either wrestler acts", () => {
    let state = createMatch({ seed: 14 });
    expect(state.decision?.kind).toBe("dodge-commit");
    state = submitPlayerIntent(state, choose(state, (intent) => intent.type === "dodge-commit" && intent.dodge));
    const reveal = state.events.find((event) => event.type === "dodge-reveal");
    expect(reveal?.detail.some((line) => line.includes("Atlas King: Dodge committed"))).toBe(true);
  });

  it("starts countout checks on the phase after a throw-out state", () => {
    let state = createMatch({ scriptedRolls: [5, 10], timeLimitMinutes: 2 });
    state.phase = 1; state.tick = 1; state.phaseQueue = []; state.dodgeWindowResolved = true; state.phaseEndProcessed = true; state.decision = null; state.pendingAction = null;
    state.wrestlers["ai-a"].location = "floor"; state.wrestlers["ai-a"].thrownOutAtTick = 0;
    state = advanceUntilPlayerDecision(state);
    expect(state.result?.method).toBe("countout");
    expect(state.result?.winnerTeamId).toBe("player");
  });

  it("keeps mandatory END recovery legal when the exhausted wrestler is on the floor", () => {
    const state = createMatch({ seed: 4 });
    state.wrestlers["player-a"].location = "floor";
    state.wrestlers["player-a"].currentEndurance = -WRESTLERS["player-a"].attributes.end;
    const actions = enumerateTurnActions(state, "player-a");
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((action) => action.intent.type === "recover" && action.intent.pool === "endurance")).toBe(true);
  });

  it("uses purchased holder maneuver levels in Hold escape", () => {
    const state = createMatch({ seed: 9 });
    state.hold = { holderId: "ai-a", defenderId: "player-a", maneuverId: "headlock", failedEscapes: 2, criticalEscapePenalty: 0 };
    expect(holdEscapeTarget(state, "player-a")).toBe(13);
  });

  it("opens the manual's pre-roll Break Hold Charm window and spends Charm on failure", () => {
    let state = createMatch({ scriptedRolls: [5, 20] });
    state.hold = { holderId: "ai-a", defenderId: "player-a", maneuverId: "headlock", failedEscapes: 0, criticalEscapePenalty: 0 };
    state.decision = { actorId: "player-a", completesActivationFor: "player-a", kind: "hold-escape", prompt: "test", actions: enumerateHoldEscape(state, "player-a") };
    state = submitPlayerIntent(state, choose(state, (intent) => intent.type === "escape-hold" && intent.charm === 1));
    expect(state.wrestlers["player-a"].charmRemaining).toBe(3);
    expect(state.events.some((event) => event.type === "hold-escape" && event.detail.some((line) => line.includes("Charm 1")))).toBe(true);
  });
});

describe("tag-team timing and interrupts", () => {
  it("keeps the outside AI on the apron when distraction has no tactical value", () => {
    const state = createMatch({ seed: 16, mode: "tag" });
    const actions = enumerateTurnActions(state, "ai-b");
    const decision = { actorId: "ai-b" as const, completesActivationFor: "ai-b" as const, kind: "turn" as const, prompt: "Outside action", actions };
    expect(chooseAiAction(state, decision).intent.type).toBe("decline-followup");
  });

  it("declines high-alert interference against a harmless pin", () => {
    const state = createMatch({ seed: 18, mode: "tag" });
    state.referee.cumulativeModifier = 8;
    state.pendingAction = { kind: "pin", pinnerId: "player-a", defenderId: "ai-a", completesActivationFor: "player-a", illegal: false, automatic: false, recentDamage: 0 };
    const actions = enumerateInterference(state, "ai-b", "pin");
    const decision = { actorId: "ai-b" as const, completesActivationFor: "ai-b" as const, kind: "interference" as const, prompt: "Interfere?", actions };
    expect(chooseAiAction(state, decision).intent.type).toBe("decline-interference");
  });

  it("reduces the Tag target by same-phase damage and opens half-target double-team choices", () => {
    let state = createMatch({ mode: "tag", scriptedRolls: [5, 1] });
    state.phase = 2; state.tick = 2; state.phaseQueue = ["player-b", "ai-a", "ai-b"]; state.dodgeWindowResolved = true;
    state.wrestlers["player-a"].damageTakenThisPhase = 10;
    state.decision = { actorId: "player-a", completesActivationFor: "player-a", kind: "turn", prompt: "test", actions: enumerateTurnActions(state, "player-a") };
    const tag = choose(state, (intent) => intent.type === "tag" && intent.charm === 0);
    state = submitPlayerIntent(state, tag);
    expect(state.teams.player.legalInRingId).toBe("player-b");
    expect(state.decision?.kind).toBe("tag-double-team");
  });

  it("gives an unused outside partner a one-die passive recovery action", () => {
    let state = createMatch({ mode: "tag", scriptedRolls: [5, 4] });
    state.phase = 2; state.tick = 2; state.dodgeWindowResolved = true;
    state.wrestlers["player-b"].currentDamage -= 12;
    state.decision = { actorId: "player-b", completesActivationFor: "player-b", kind: "outside-recovery", prompt: "test", actions: enumerateTurnActions(state, "player-b") };
    state = submitPlayerIntent(state, choose(state, (intent) => intent.type === "recover" && Boolean(intent.outside) && intent.pool === "damage"));
    const event = state.events.find((candidate) => candidate.type === "outside-recovery");
    expect(event?.dice).toHaveLength(1);
  });

  it("opens a scheduled outside-partner Pin Interference response before the pin roll", () => {
    let state = createMatch({ mode: "tag", scriptedRolls: [5] });
    state.phase = 2; state.tick = 2; state.dodgeWindowResolved = true; state.phaseQueue = ["player-b"];
    state.pendingAction = { kind: "pin", pinnerId: "ai-a", defenderId: "player-a", completesActivationFor: "ai-a", illegal: false, automatic: false, recentDamage: 12 };
    state.decision = { actorId: "ai-a", completesActivationFor: "ai-a", kind: "pin-followup", prompt: "test", actions: [{ key: "pin", label: "Pin", detail: "test", intent: { type: "pin", illegal: false } }] };
    state = advanceUntilPlayerDecision(state);
    expect(state.decision?.kind).toBe("interference");
    expect(state.decision?.actorId).toBe("player-b");
  });

  it("does not enumerate a stale distracted-referee entry after the window expires", () => {
    const state = createMatch({ mode: "tag", seed: 12 });
    state.tick = 15;
    state.referee.distractedUntilTick = 10;
    state.teams.ai.entryEligibleId = "ai-b";
    expect(enumerateTurnActions(state, "ai-b").some((action) => action.intent.type === "enter-ring")).toBe(false);
  });

  it("does not permit distracted-referee entry without a future exit phase", () => {
    const state = createMatch({ seed: 17, mode: "tag" });
    state.tick = 9;
    state.phase = 9;
    state.referee.distractedUntilTick = 10;
    state.teams.ai.entryEligibleId = "ai-b";
    expect(enumerateTurnActions(state, "ai-b").some((action) => action.intent.type === "enter-ring")).toBe(false);

    state.referee.distractedUntilTick = 15;
    expect(enumerateTurnActions(state, "ai-b").some((action) => action.intent.type === "enter-ring")).toBe(true);
  });
});

describe("determinism, properties, and batch QA", () => {
  it("Rules Lab pauses and advances exactly one forced transaction per step", () => {
    let state = createMatch({ scenarioId: "critical-hold-100" });
    expect(state.phase).toBe(0);
    expect(state.events).toHaveLength(1);
    state = stepRulesLab(state);
    expect(state.phase).toBe(1);
    expect(state.events).toHaveLength(2);
    const before = state.events.length;
    state = stepRulesLab(state);
    expect(state.events.length - before).toBeLessThanOrEqual(1);
  });

  it("replays the same mixed decision log to the identical event and state hashes", () => {
    let state = createMatch({ seed: 1991, timeLimitMinutes: 2, mode: "tag" });
    let decisions = 0;
    while (!state.result && decisions < 80) {
      state = submitPlayerIntent(state, safePlayerAction(state));
      decisions += 1;
    }
    expect(state.result).not.toBeNull();
    const replay = replayFromInputLog(state);
    expect(hashMatchState(replay)).toBe(hashMatchState(state));
    expect(replay.events.map((event) => event.postStateHash)).toEqual(state.events.map((event) => event.postStateHash));
  });

  it("completes seeded singles and tag batches without illegal pools, asymmetry exceptions, or replay divergence", () => {
    for (const mode of ["singles", "tag"] as const) {
      const methods: Record<string, number> = {};
      const phaseCounts: number[] = [];
      const decisionCounts: number[] = [];
      for (let seed = 1; seed <= 50; seed += 1) {
        let state = createMatch({ seed, timeLimitMinutes: 2, mode });
        let decisions = 0;
        while (!state.result && decisions < 120) {
          try {
            state = submitPlayerIntent(state, safePlayerAction(state));
          } catch (error) {
            throw new Error(`${mode} seed ${seed}, decision ${JSON.stringify(state.decision)}, pending ${JSON.stringify(state.pendingAction)}, hold ${JSON.stringify(state.hold)}, recent events ${JSON.stringify(state.events.slice(-8).map((event) => [event.sequence, event.type, event.summary]))}: ${String(error)}`);
          }
          decisions += 1;
        }
        expect(state.result, `${mode} seed ${seed} must finish or draw`).not.toBeNull();
        expect(decisions).toBeLessThan(120);
        methods[state.result!.method] = (methods[state.result!.method] ?? 0) + 1;
        phaseCounts.push((state.minute - 1) * 10 + state.phase);
        decisionCounts.push(decisions);
        for (const id of state.activeWrestlerIds as WrestlerId[]) {
          expect(state.wrestlers[id].currentDamage).toBeGreaterThanOrEqual(0);
          expect(state.wrestlers[id].currentDamage).toBeLessThanOrEqual(startingDamage(state.roster[id]));
          expect(state.wrestlers[id].currentEndurance).toBeLessThanOrEqual(state.roster[id].attributes.end);
        }
        const replay = replayFromInputLog(state);
        expect(hashMatchState(replay), `${mode} seed ${seed} replay`).toBe(hashMatchState(state));
      }
      phaseCounts.sort((a, b) => a - b);
      decisionCounts.sort((a, b) => a - b);
      console.info(`[simulation:${mode}] ${JSON.stringify({ matches: 50, methods, medianPhases: phaseCounts[24], phaseRange: [phaseCounts[0], phaseCounts.at(-1)], medianPlayerDecisions: decisionCounts[24] })}`);
    }
  }, 45_000);

  it("runs ten-minute aggressive-policy smoke matches without forcing a duration claim", () => {
    for (const mode of ["singles", "tag"] as const) {
      const methods: Record<string, number> = {};
      const dqCauses: Record<string, number> = {};
      for (let seed = 101; seed <= 110; seed += 1) {
        let state = createMatch({ seed, timeLimitMinutes: 10, mode });
        let decisions = 0;
        while (!state.result && decisions < 500) {
          try {
            state = submitPlayerIntent(state, aggressivePlayerAction(state));
          } catch (error) {
            throw new Error(`${mode} seed ${seed}, decision ${JSON.stringify(state.decision)}, pending ${JSON.stringify(state.pendingAction)}, hold ${JSON.stringify(state.hold)}, teams ${JSON.stringify(state.teams)}, recent ${JSON.stringify(state.events.slice(-10).map((event) => [event.tick, event.type, event.summary]))}: ${String(error)}`);
          }
          decisions += 1;
        }
        expect(state.result, `${mode} seed ${seed}`).not.toBeNull();
        methods[state.result!.method] = (methods[state.result!.method] ?? 0) + 1;
        if (state.result!.method === "disqualification") {
          const cause = [...state.events].reverse().find((event) => event.type === "illegal-entry-disqualification" || event.detail.some((line) => line.includes("disqualification")))?.type ?? "unlogged";
          dqCauses[cause] = (dqCauses[cause] ?? 0) + 1;
        }
        expect(hashMatchState(replayFromInputLog(state))).toBe(hashMatchState(state));
      }
      console.info(`[simulation:10-minute:${mode}] ${JSON.stringify({ matches: 10, methods, dqCauses })}`);
    }
  }, 45_000);
});
