import { describe, expect, it } from "vitest";
import {
  advanceUntilPlayerDecision,
  beginScheduledMatch,
  checkpointScheduledMatch,
  chooseDeterministicPolicyAction,
  commitScheduledMatchResult,
  createCampaign,
  createMatch,
  hashCampaignState,
  hashMatchState,
  importCampaignJson,
  isStrictManualCampaign,
  isStrictManualMatch,
  replayFromInputLog,
  replayScheduledCampaignMatch,
  scheduleCampaignMatch,
  serializeCampaign,
  submitPlayerIntent,
  suggestPlayerMatch,
} from "../src/core";
import type { CampaignState, MatchMode, MatchState } from "../src/core";
import { makeCareerRecord } from "../scripts/m10-ruthless-campaign";

function playExistingMatchToFinish(initial: MatchState): MatchState {
  let state = initial;
  for (let guard = 0; !state.result && guard < 12_000; guard += 1) {
    state = advanceUntilPlayerDecision(state);
    if (state.result) break;
    if (!state.decision) throw new Error(`${state.config.mode} smoke match stalled without a player decision.`);
    if (!state.decision.actions.length) throw new Error(`${state.config.mode} smoke match exposed a mandatory decision with zero legal actions.`);
    state = submitPlayerIntent(state, chooseDeterministicPolicyAction(state, state.decision).intent);
  }
  if (!state.result) throw new Error(`${state.config.mode} smoke match did not reach an official finish within the guard.`);
  return state;
}

function playToFinish(mode: MatchMode, seed: number): MatchState {
  return playExistingMatchToFinish(createMatch({ seed, mode, timeLimitMinutes: 10, aiDifficulty: "standard", variety: "standard" }));
}

function playDecisions(initial: MatchState, count: number): MatchState {
  let state = initial;
  for (let index = 0; index < count && !state.result; index += 1) {
    state = advanceUntilPlayerDecision(state);
    if (state.result) break;
    if (!state.decision?.actions.length) throw new Error("Recovery smoke could not reach a legal player decision.");
    state = submitPlayerIntent(state, chooseDeterministicPolicyAction(state, state.decision).intent);
  }
  return state;
}

function career(seed: number): CampaignState {
  const roster = Array.from({ length: 8 }, (_, index) => makeCareerRecord(seed + 10_000, index));
  return createCampaign({
    name: `M14 Career ${seed}`,
    seed,
    startDate: "1991-01-01",
    roster,
    playerEntrantId: roster[4].id,
    playerDivision: "singles",
    aiDifficulty: "standard",
  });
}

describe("M14 playable readiness smoke", () => {
  it.each([
    { mode: "singles" as const, seed: 19_910_101 },
    { mode: "tag" as const, seed: 19_910_202 },
  ])("plays $mode from initialization to official finish and replays identically", ({ mode, seed }) => {
    const completed = playToFinish(mode, seed);
    expect(completed.result).toBeTruthy();
    expect(completed.inputLog.length).toBeGreaterThan(0);
    expect(completed.events.length).toBeGreaterThan(0);
    expect(isStrictManualMatch(completed)).toBe(true);

    const replayed = replayFromInputLog(completed);
    expect(replayed.result).toEqual(completed.result);
    expect(hashMatchState(replayed)).toBe(hashMatchState(completed));
    expect(replayed.events.map((event) => event.dice)).toEqual(completed.events.map((event) => event.dice));
  });

  it("plays a Career match, commits it exactly once, saves/reloads, and replays the result", () => {
    let state = career(19_910_303);
    expect(isStrictManualCampaign(state)).toBe(true);
    state = scheduleCampaignMatch(state, suggestPlayerMatch(state));
    const matchId = state.schedule[0].id;
    state = beginScheduledMatch(state, matchId);
    const completedMatch = playExistingMatchToFinish(state.activeMatch!);
    state = checkpointScheduledMatch(state, completedMatch);
    state = commitScheduledMatchResult(state);

    expect(state.schedule[0].status).toBe("completed");
    expect(state.appliedMatchIds).toEqual([matchId]);
    expect(state.schedule[0].result?.finalMatchHash).toBe(hashMatchState(replayScheduledCampaignMatch(state, matchId)));
    expect(() => commitScheduledMatchResult(state)).toThrow(/No active match/);

    const expectedHash = hashCampaignState(state);
    const restored = importCampaignJson(serializeCampaign(state, false)).state;
    expect(hashCampaignState(restored)).toBe(expectedHash);
    expect(restored.rng).toEqual(state.rng);
    expect(restored.appliedMatchIds).toEqual([matchId]);
  }, 30_000);

  it("resumes a checkpointed in-progress Career match without changing the eventual match or campaign identity", () => {
    let source = career(19_910_404);
    source = scheduleCampaignMatch(source, suggestPlayerMatch(source));
    const matchId = source.schedule[0].id;
    source = beginScheduledMatch(source, matchId);
    const partial = playDecisions(source.activeMatch!, 4);
    expect(partial.result).toBeFalsy();
    source = checkpointScheduledMatch(source, partial);

    const recovered = importCampaignJson(serializeCampaign(source, false)).state;
    expect(recovered.activeMatch).toBeTruthy();
    expect(hashMatchState(recovered.activeMatch!)).toBe(hashMatchState(partial));
    expect(recovered.activeMatch!.rng).toEqual(partial.rng);

    const uninterruptedMatch = playExistingMatchToFinish(partial);
    let uninterruptedCampaign = checkpointScheduledMatch(source, uninterruptedMatch);
    uninterruptedCampaign = commitScheduledMatchResult(uninterruptedCampaign);

    const recoveredMatch = playExistingMatchToFinish(recovered.activeMatch!);
    let recoveredCampaign = checkpointScheduledMatch(recovered, recoveredMatch);
    recoveredCampaign = commitScheduledMatchResult(recoveredCampaign);

    expect(hashMatchState(recoveredMatch)).toBe(hashMatchState(uninterruptedMatch));
    expect(recoveredMatch.events.map((event) => event.dice)).toEqual(uninterruptedMatch.events.map((event) => event.dice));
    expect(hashCampaignState(recoveredCampaign)).toBe(hashCampaignState(uninterruptedCampaign));
    expect(recoveredCampaign.schedule.find((row) => row.id === matchId)?.result?.finalMatchHash)
      .toBe(uninterruptedCampaign.schedule.find((row) => row.id === matchId)?.result?.finalMatchHash);
  }, 30_000);
});
