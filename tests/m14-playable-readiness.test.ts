import { describe, expect, it } from "vitest";
import {
  advanceUntilPlayerDecision,
  chooseDeterministicPolicyAction,
  createMatch,
  hashMatchState,
  isStrictManualMatch,
  replayFromInputLog,
  submitPlayerIntent,
} from "../src/core";
import type { MatchMode, MatchState } from "../src/core";

function playToFinish(mode: MatchMode, seed: number): MatchState {
  let state = createMatch({ seed, mode, timeLimitMinutes: 10, aiDifficulty: "standard", variety: "standard" });
  for (let guard = 0; !state.result && guard < 12_000; guard += 1) {
    state = advanceUntilPlayerDecision(state);
    if (state.result) break;
    if (!state.decision) throw new Error(`${mode} smoke match stalled without a player decision.`);
    if (!state.decision.actions.length) throw new Error(`${mode} smoke match exposed a mandatory decision with zero legal actions.`);
    state = submitPlayerIntent(state, chooseDeterministicPolicyAction(state, state.decision).intent);
  }
  if (!state.result) throw new Error(`${mode} smoke match did not reach an official finish within the guard.`);
  return state;
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
});
