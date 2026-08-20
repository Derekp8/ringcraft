import {
  advanceUntilPlayerDecision,
  autoAllocateCreationPoints,
  careerRecordToDefinition,
  chooseDeterministicPolicyAction,
  createCreationSession,
  createMatch,
  finalizeCreationSession,
  hashMatchState,
  replayFromInputLog,
  rollCreationHistory,
  rollCreationStature,
  setCreationIdentity,
  setCreationSide,
  submitPlayerIntent,
} from "../src/core";
import type { Attributes, Intent, MatchConfiguration, MatchSetup, MatchState, MatchVariety, SkillLevels, WrestlerCareerRecord } from "../src/core";

export const M11_REPLAY_SCHEMA = "asw91-match-variety-replay-v1";

/**
 * Crafted roster records with explicitly controlled attributes: distinct QUI
 * (no initiative tie rolls, so the scripted dice sequence is predictable) and
 * AV ≈ DV (so the first scripted escape/climb roll of 19 reliably fails and
 * the second roll of 1 reliably wins). Charm 3 keeps the Charm range of the
 * escape/retrieval actions realistic.
 */
function makeRecord(seed: number, index: number, attributes: Attributes): WrestlerCareerRecord {
  let session = createCreationSession(seed);
  session = setCreationIdentity(session, { name: `Variety Wrestler ${index}`, epithet: `Seed ${seed}`, affiliation: "M11 Match Variety" });
  session = setCreationSide(session, index % 2 ? "rulebreaker" : "fan-favorite");
  session = rollCreationStature(session);
  session = rollCreationHistory(session);
  session = autoAllocateCreationPoints(session);
  const base = finalizeCreationSession(session).finalized!;
  const skills: SkillLevels = { breakHold: 1, distractReferee: 1, dodge: 1, escapePin: 1, illegalPin: 0, irishWhip: 1, pinInterference: 0, tagTeam: 1, charm: 3 };
  return {
    ...base,
    attributes,
    skills,
    maneuverLevels: { punch: 2, "body-slam": 2, "drop-kick": 2, "forearm-smash": 2, headlock: 2, sleeper: 1 },
    customManeuvers: {},
    drawbacks: [],
  };
}

export function varietyRoster(seed: number): WrestlerCareerRecord[] {
  return [
    makeRecord(seed + 1, 0, { pow: 70, agi: 60, qui: 55, tec: 65, end: 70 }),
    makeRecord(seed + 2, 1, { pow: 72, agi: 62, qui: 50, tec: 66, end: 72 }),
  ];
}

export function varietyMatchSetup(variety: MatchVariety, seed: number, scriptedRolls?: number[]): MatchSetup {
  const records = varietyRoster(seed);
  return {
    seed,
    timeLimitMinutes: 15,
    mode: "singles",
    variety,
    ...(scriptedRolls && scriptedRolls.length ? { scriptedRolls } : {}),
    roster: Object.fromEntries(records.map((record, index) => [record.id, careerRecordToDefinition(record, record.id, index === 0 ? "player" : "ai")])),
    teamMembers: { player: [records[0].id], ai: [records[1].id] },
  };
}

/**
 * Headless driver shared by the generator and verifier: advances the match,
 * resolving every open decision with the standard v1 deterministic policy
 * (player decisions go through `submitPlayerIntent` so they land in the input
 * log; AI decisions are resolved inside `advanceUntilPlayerDecision`).
 */
export function runVarietyMatchHeadless(setup: MatchSetup): MatchState {
  let state = createMatch(setup);
  let guard = 0;
  while (!state.result) {
    guard += 1;
    if (guard > 200_000) throw new Error("M11 fixture match exceeded the decision guard.");
    state = advanceUntilPlayerDecision(state);
    if (state.result) break;
    const decision = state.decision;
    if (!decision) throw new Error("M11 fixture match stalled without a decision.");
    const action = chooseDeterministicPolicyAction(state, decision);
    state = submitPlayerIntent(state, action.intent);
  }
  return state;
}

export interface VarietyReplayFixture {
  schemaVersion: typeof M11_REPLAY_SCHEMA;
  label: string;
  variety: MatchVariety;
  seed: number;
  matchConfig: MatchConfiguration;
  inputLog: Intent[];
  expectedWinMethod: NonNullable<MatchState["result"]>["method"];
  expectedWinnerId: string;
  expectedFinalMatchHash: string;
}

/**
 * Replays a fixture's recorded config + player input log and returns the
 * terminal state. AI moves are re-derived exactly like the campaign replay
 * path, so this is the strict deterministic replay contract for the variety.
 */
export function replayVarietyFixture(fixture: VarietyReplayFixture): MatchState {
  return replayFromInputLog({ config: fixture.matchConfig, inputLog: fixture.inputLog } as MatchState);
}
