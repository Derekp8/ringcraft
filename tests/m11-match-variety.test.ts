import { describe, expect, it } from "vitest";
import {
  ESCAPE_DIFFICULTY,
  ESCAPE_LEGALITY_THRESHOLD,
  WRESTLERS,
  advanceUntilPlayerDecision,
  autoAllocateCreationPoints,
  beginScheduledMatch,
  choosePolicyAction,
  createCampaign,
  createCreationSession,
  createMatch,
  enumerateTurnActions,
  evaluateState,
  finalizeCreationSession,
  hashMatchState,
  replayFromInputLog,
  rollCreationHistory,
  rollCreationStature,
  scheduleCampaignMatch,
  serializeCampaign,
  setCreationIdentity,
  setCreationSide,
  startingDamage,
  submitPlayerIntent,
  suggestPlayerMatch,
  validateCampaignState,
} from "../src/core";
import type { Intent, MatchState, WrestlerCareerRecord } from "../src/core";
import { replayVarietyFixture, runVarietyMatchHeadless, varietyMatchSetup } from "../scripts/m11-match-variety";
import type { VarietyReplayFixture } from "../scripts/m11-match-variety";
import cageFixture from "../fixtures/m11/cage-replay.json";
import ladderFixture from "../fixtures/m11/ladder-replay.json";

function choose(state: MatchState, predicate: (intent: Intent) => boolean): Intent {
  const action = state.decision?.actions.find((candidate) => predicate(candidate.intent));
  if (!action) throw new Error(`Expected legal action was unavailable. Decision: ${JSON.stringify(state.decision)}`);
  return action.intent;
}

function drivePlayer(state: MatchState, predicate: (intent: Intent) => boolean): MatchState {
  return submitPlayerIntent(state, choose(state, predicate));
}

/** Softens a wrestler past the M11 escape/retrieval legality threshold. */
function soften(state: MatchState, id: string, taken = ESCAPE_LEGALITY_THRESHOLD + 5): MatchState {
  state.wrestlers[id].currentDamage = startingDamage(WRESTLERS[id]) - taken;
  return state;
}

describe("M11 match variety: default identity and validation", () => {
  it("keeps standard matches byte-identical (no ladder/variety keys in serialization)", () => {
    const standard = createMatch({ seed: 1991 });
    const serialized = JSON.stringify(standard);
    expect(serialized).not.toContain('"ladder"');
    expect(serialized).not.toContain('"variety"');
    expect(standard.config.variety).toBeUndefined();
    expect(standard.ladder).toBeUndefined();
    expect(standard.config.scriptedRolls).toBeUndefined();
  });

  it("normalizes an explicit standard variety to the default", () => {
    const explicit = createMatch({ seed: 1991, variety: "standard" });
    const plain = createMatch({ seed: 1991 });
    expect(explicit.config.variety).toBeUndefined();
    expect(hashMatchState(explicit)).toBe(hashMatchState(plain));
  });

  it("rejects unknown varieties and tag cage/ladder matches", () => {
    expect(() => createMatch({ variety: "battle-royal" as never })).toThrow("Unsupported match variety");
    expect(() => createMatch({ variety: "cage", mode: "tag" })).toThrow("singles-only");
    expect(() => createMatch({ variety: "ladder", mode: "tag" })).toThrow("singles-only");
  });

  it("pins the default-identity contract through the fixture verifier", () => {
    const standard = createMatch({ ...(cageFixture as VarietyReplayFixture).matchConfig, variety: undefined, scriptedRolls: undefined });
    expect(JSON.stringify(standard)).not.toContain('"ladder"');
    expect(JSON.stringify(standard)).not.toContain('"variety"');
  });
});

describe("M11 cage matches", () => {
  it("reaches an escape win and replays byte-identically", () => {
    const fixture = cageFixture as VarietyReplayFixture;
    const replayed = replayVarietyFixture(fixture);
    expect(replayed.result?.method).toBe("escape");
    expect(replayed.result?.winnerId).toBe(fixture.expectedWinnerId);
    expect(hashMatchState(replayed)).toBe(fixture.expectedFinalMatchHash);
    // A fresh headless re-derivation under the standard policy reproduces the pin too.
    const derived = runVarietyMatchHeadless(varietyMatchSetup("cage", fixture.seed, fixture.matchConfig.scriptedRolls ?? []));
    expect(hashMatchState(derived)).toBe(fixture.expectedFinalMatchHash);
  });

  it("exposes the cage-escape action with the Charm range once the defender is softened", () => {
    const fresh = createMatch({ variety: "cage", seed: 3 });
    const freshActions = enumerateTurnActions(fresh, fresh.decision!.actorId);
    expect(freshActions.some((action) => action.intent.type === "cage-escape")).toBe(false);
    const state = soften(fresh, "ai-a");
    const actions = enumerateTurnActions(state, state.decision!.actorId);
    const escapes = actions.filter((action) => action.intent.type === "cage-escape");
    expect(escapes.map((action) => (action.intent as Extract<Intent, { type: "cage-escape" }>).charm)).toEqual([0, 1, 2, 3]);
  });

  it("lets the player escape with a scripted roll and ends by escape", () => {
    let state = soften(createMatch({ variety: "cage", scriptedRolls: [5, 1] }), "ai-a");
    state.phase = 2; state.tick = 2; state.currentActorId = "player-a";
    state.decision = { actorId: "player-a", completesActivationFor: "player-a", kind: "turn", prompt: "test", actions: enumerateTurnActions(state, "player-a") };
    const escape = choose(state, (intent) => intent.type === "cage-escape" && (intent as Extract<Intent, { type: "cage-escape" }>).charm === 0);
    state = submitPlayerIntent(state, escape);
    expect(state.result?.method).toBe("escape");
    expect(state.result?.winnerTeamId).toBe("player");
    expect(state.events.some((event) => event.summary.includes("climbs out of the cage"))).toBe(true);
  });

  it("keeps a thrown-out move inside the ring (cage boundary)", () => {
    let state = createMatch({ variety: "cage", scriptedRolls: [5, 1, 6, 6, 6] });
    state = drivePlayer(state, (intent) => intent.type === "dodge-commit" && !intent.dodge);
    state = drivePlayer(state, (intent) => intent.type === "attack" && intent.maneuverId === "throw-out-of-ring");
    state = drivePlayer(state, (intent) => intent.type === "choose-damage-charm" && intent.charm === 0);
    expect(state.wrestlers["ai-a"].location).toBe("ring");
    expect(state.wrestlers["ai-a"].thrownOutAtTick).toBeNull();
    expect(state.events.some((event) => event.detail.some((line) => line.includes("Cage wall")))).toBe(true);
    // A thrown-out wrestler can never be counted out because nobody reaches the floor.
    state.wrestlers["ai-a"].location = "floor";
    state.wrestlers["ai-a"].thrownOutAtTick = 0;
    state = advanceUntilPlayerDecision(state);
    expect(state.result?.method).not.toBe("countout");
  });

  it("suppresses the disqualification result at referee 31+", () => {
    let state = createMatch({ variety: "cage", scriptedRolls: [10, 6, 10, 10, 10] });
    state.phase = 2; state.tick = 2; state.currentActorId = "ai-a";
    state.hold = { holderId: "ai-a", defenderId: "player-a", maneuverId: "headlock", failedEscapes: 0, criticalEscapePenalty: 0 };
    state.wrestlers["ai-a"].charmRemaining = 0;
    state.decision = { actorId: "ai-a", completesActivationFor: "ai-a", kind: "turn", prompt: "test", actions: enumerateTurnActions(state, "ai-a") };
    const rope = state.decision.actions.find((action) => action.intent.type === "maintain-hold" && action.intent.useRopes);
    expect(rope).toBeDefined();
    state.decision = { ...state.decision!, actions: [rope!] };
    state = advanceUntilPlayerDecision(state);
    expect(state.result).toBeNull();
    expect(state.events.some((event) => event.detail.some((line) => line.includes("no disqualification")))).toBe(true);
  });

  it("still disqualifies the identical referee situation in a standard match", () => {
    let state = createMatch({ scriptedRolls: [10, 6, 10, 10, 10] });
    state.phase = 2; state.tick = 2; state.currentActorId = "ai-a";
    state.hold = { holderId: "ai-a", defenderId: "player-a", maneuverId: "headlock", failedEscapes: 0, criticalEscapePenalty: 0 };
    state.wrestlers["ai-a"].charmRemaining = 0;
    state.decision = { actorId: "ai-a", completesActivationFor: "ai-a", kind: "turn", prompt: "test", actions: enumerateTurnActions(state, "ai-a") };
    const rope = state.decision.actions.find((action) => action.intent.type === "maintain-hold" && action.intent.useRopes);
    state.decision = { ...state.decision!, actions: [rope!] };
    state = advanceUntilPlayerDecision(state);
    expect(state.result?.method).toBe("disqualification");
  });
});

describe("M11 ladder matches", () => {
  it("reaches a retrieval win and replays byte-identically", () => {
    const fixture = ladderFixture as VarietyReplayFixture;
    const replayed = replayVarietyFixture(fixture);
    expect(replayed.result?.method).toBe("retrieval");
    expect(replayed.result?.winnerId).toBe(fixture.expectedWinnerId);
    expect(hashMatchState(replayed)).toBe(fixture.expectedFinalMatchHash);
    const derived = runVarietyMatchHeadless(varietyMatchSetup("ladder", fixture.seed, fixture.matchConfig.scriptedRolls ?? []));
    expect(hashMatchState(derived)).toBe(fixture.expectedFinalMatchHash);
  });

  it("exposes set-up, climb, and knock-down actions in the right ladder states", () => {
    const down = createMatch({ variety: "ladder", seed: 3 });
    let actions = enumerateTurnActions(down, down.decision!.actorId);
    expect(actions.some((action) => action.intent.type === "set-up-ladder")).toBe(true);
    expect(actions.some((action) => action.intent.type === "climb-retrieve")).toBe(false);

    const up = soften(createMatch({ variety: "ladder", seed: 3 }), "ai-a");
    up.ladder = { setById: "ai-a", setAtTick: 1 };
    actions = enumerateTurnActions(up, "player-a");
    expect(actions.some((action) => action.intent.type === "set-up-ladder")).toBe(false);
    const climbs = actions.filter((action) => action.intent.type === "climb-retrieve");
    expect(climbs.map((action) => (action.intent as Extract<Intent, { type: "climb-retrieve" }>).charm)).toEqual([0, 1, 2, 3]);
    expect(actions.some((action) => action.intent.type === "knock-ladder")).toBe(true);

    const own = soften(createMatch({ variety: "ladder", seed: 3 }), "ai-a");
    own.ladder = { setById: "player-a", setAtTick: 1 };
    actions = enumerateTurnActions(own, "player-a");
    expect(actions.some((action) => action.intent.type === "knock-ladder")).toBe(false);
  });

  it("lets the player knock down the opponent's ladder and then climb a re-set one to win", () => {
    let state = soften(createMatch({ variety: "ladder", scriptedRolls: [5, 1] }), "ai-a");
    state.phase = 2; state.tick = 2; state.currentActorId = "player-a";
    state.ladder = { setById: "ai-a", setAtTick: 1 };
    state.decision = { actorId: "player-a", completesActivationFor: "player-a", kind: "turn", prompt: "test", actions: enumerateTurnActions(state, "player-a") };
    state = submitPlayerIntent(state, choose(state, (intent) => intent.type === "knock-ladder"));
    expect(state.ladder).toBeUndefined();

    // A re-set ladder by the player is retrievable with the scripted success roll.
    state.ladder = { setById: "player-a", setAtTick: state.tick };
    state.decision = { actorId: "player-a", completesActivationFor: "player-a", kind: "turn", prompt: "test", actions: enumerateTurnActions(state, "player-a") };
    state = submitPlayerIntent(state, choose(state, (intent) => intent.type === "climb-retrieve" && intent.charm === 0));
    expect(state.result?.method).toBe("retrieval");
    expect(state.result?.winnerTeamId).toBe("player");
  });

  it("never ends by countout even when a wrestler is on the floor", () => {
    let state = createMatch({ variety: "ladder", scriptedRolls: [5, 10], timeLimitMinutes: 2 });
    state.phase = 1; state.tick = 1; state.phaseQueue = []; state.dodgeWindowResolved = true; state.phaseEndProcessed = true; state.decision = null; state.pendingAction = null;
    state.wrestlers["ai-a"].location = "floor"; state.wrestlers["ai-a"].thrownOutAtTick = 0;
    state = advanceUntilPlayerDecision(state);
    expect(state.result?.method).not.toBe("countout");
  });
});

describe("M11 AI policy coverage", () => {
  it("ranks a set ladder's climb above every other action once the defender is softened", () => {
    const state = soften(createMatch({ variety: "ladder", seed: 7 }), "ai-a");
    state.ladder = { setById: "ai-a", setAtTick: 1 };
    state.decision = { actorId: "player-a", completesActivationFor: "player-a", kind: "turn", prompt: "test", actions: enumerateTurnActions(state, "player-a") };
    const pick = choosePolicyAction(state, state.decision);
    expect(pick.intent.type).toBe("climb-retrieve");
  });

  it("prefers a cage escape to any attack once it is legal", () => {
    const state = soften(createMatch({ variety: "cage", seed: 7 }), "ai-a");
    state.decision = { actorId: "player-a", completesActivationFor: "player-a", kind: "turn", prompt: "test", actions: enumerateTurnActions(state, "player-a") };
    const pick = choosePolicyAction(state, state.decision);
    expect(pick.intent.type).toBe("cage-escape");
  });

  it("reflects ladder ownership in the positional evaluation", () => {
    const base = createMatch({ variety: "ladder", seed: 42 });
    const owned = { ...base, ladder: { setById: "player-a", setAtTick: 1 } };
    const denied = { ...base, ladder: { setById: "ai-a", setAtTick: 1 } };
    const baseline = evaluateState(base, "player-a");
    expect(evaluateState(owned, "player-a")).toBe(baseline + 800);
    expect(evaluateState(denied, "player-a")).toBe(baseline - 800);
  });

  it("pins the escape/retrieval tuning constants", () => {
    expect(ESCAPE_DIFFICULTY).toBe(5);
    expect(ESCAPE_LEGALITY_THRESHOLD).toBe(15);
  });

  it("replays a ruthless ladder run deterministically from its own input log", () => {
    let ruthless = createMatch({ variety: "ladder", seed: 99, aiDifficulty: "ruthless", scriptedRolls: [5, 1] });
    ruthless = advanceUntilPlayerDecision(ruthless);
    if (ruthless.decision) ruthless = submitPlayerIntent(ruthless, choose(ruthless, (intent) => intent.type === "dodge-commit" && !intent.dodge));
    ruthless = advanceUntilPlayerDecision(ruthless);
    const replayed = replayFromInputLog(ruthless);
    expect(hashMatchState(replayed)).toBe(hashMatchState(ruthless));
  });
});

function makeCareerRecord(seed: number, index: number): WrestlerCareerRecord {
  let session = createCreationSession(seed);
  session = setCreationIdentity(session, { name: `M11 Wrestler ${index}`, epithet: "M11", affiliation: "M11 Campaign" });
  session = setCreationSide(session, index % 2 ? "rulebreaker" : "fan-favorite");
  session = rollCreationStature(session);
  session = rollCreationHistory(session);
  session = autoAllocateCreationPoints(session);
  return finalizeCreationSession(session).finalized!;
}

describe("M11 campaign wiring", () => {
  it("schedules and begins a cage match with a variety override", () => {
    const roster = Array.from({ length: 6 }, (_, index) => makeCareerRecord(4300, index));
    const campaign = createCampaign({ name: "M11 Cage Career", seed: 42, startDate: "1991-01-01", roster, playerEntrantId: roster[4].id, playerDivision: "singles" });
    expect(campaign.variety).toBeUndefined();
    const suggestion = suggestPlayerMatch(campaign);
    const scheduled = scheduleCampaignMatch(campaign, { ...suggestion, variety: "cage" });
    const due = scheduled.schedule.find((row) => row.status === "scheduled")!;
    expect(due.variety).toBe("cage");
    const playing = beginScheduledMatch(scheduled, due.id);
    expect(playing.activeMatch?.config.variety).toBe("cage");
    expect(validateCampaignState(playing)).toEqual([]);
  });

  it("leaves standard campaign serialization free of the variety field", () => {
    const roster = Array.from({ length: 6 }, (_, index) => makeCareerRecord(4400, index));
    const campaign = createCampaign({ name: "Standard Career", seed: 43, startDate: "1991-01-01", roster, playerEntrantId: roster[4].id, playerDivision: "singles" });
    expect(JSON.stringify(campaign)).not.toContain('"variety"');
    const json = serializeCampaign(campaign, false);
    expect(json).not.toContain('"variety"');
  });
});
