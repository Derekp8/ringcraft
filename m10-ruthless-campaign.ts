import {
  advanceCampaignDays,
  advanceUntilPlayerDecision,
  autoAllocateCreationPoints,
  beginScheduledMatch,
  checkpointScheduledMatch,
  chooseDeterministicPolicyAction,
  commitScheduledMatchResult,
  createCampaign,
  createCreationSession,
  finalizeCreationSession,
  hashCampaignState,
  rollCreationHistory,
  rollCreationStature,
  scheduleCampaignMatch,
  setCreationIdentity,
  setCreationSide,
  submitPlayerIntent,
  suggestPlayerMatch,
} from "../src/core";
import type { AiDifficulty, CampaignState, WrestlerCareerRecord } from "../src/core";

export const M10_RUTHLESS_CAMPAIGN_SCHEMA = "m10-ruthless-campaign-v1" as const;
export const M10_CAPTURED_POLICY = "asw91-ai-policy-v1" as const;

export interface RuthlessCampaignDerivation {
  rosterSeedBase: number;
  rosterSize: number;
  playerIndex: number;
  campaignSeed: number;
  name: string;
  startDate: string;
  difficulty: AiDifficulty;
  advanceDays: number;
}

export interface RuthlessCampaignEvidence {
  committedCampaignHash: string;
  finalCampaignHash: string;
  matchFinalHash: string;
}

export interface RuthlessCampaignFixture {
  schema: typeof M10_RUTHLESS_CAMPAIGN_SCHEMA;
  capturedPolicy: typeof M10_CAPTURED_POLICY;
  derivation: RuthlessCampaignDerivation;
  evidence: RuthlessCampaignEvidence;
}

/** The canonical derivation spec; mirrors the campaign-level replay pins in tests/m10-ai.test.ts. */
export const RUTHLESS_CAMPAIGN_DERIVATION: RuthlessCampaignDerivation = Object.freeze({
  rosterSeedBase: 4300,
  rosterSize: 6,
  playerIndex: 4,
  campaignSeed: 2003,
  name: "Ruthless Career",
  startDate: "1991-01-01",
  difficulty: "ruthless",
  advanceDays: 31,
});

/** Mirrors tests/m10-ai.test.ts `makeCareerRecord` exactly (single source of truth). */
export function makeCareerRecord(seed: number, index: number): WrestlerCareerRecord {
  let session = createCreationSession(seed + index);
  session = setCreationIdentity(session, { name: `Career Wrestler ${index + 1}`, epithet: "T", affiliation: "M10 Career" });
  session = setCreationSide(session, index % 2 ? "rulebreaker" : "fan-favorite");
  session = rollCreationStature(session);
  session = rollCreationHistory(session);
  session = autoAllocateCreationPoints(session);
  return finalizeCreationSession(session).finalized!;
}

/**
 * Derives the ruthless campaign chain deterministically: play the offered match
 * headless under the v1 policy, checkpoint and commit the official result, then
 * advance a full month so the match folds into the month-end rating table and
 * February's obligations re-roll. Mirrors the campaign-level replay contract.
 */
export function deriveRuthlessCampaign(derivation: RuthlessCampaignDerivation): { committed: CampaignState; final: CampaignState; matchFinalHash: string } {
  const roster = Array.from({ length: derivation.rosterSize }, (_, index) => makeCareerRecord(derivation.rosterSeedBase, index));
  let campaign = createCampaign({
    name: derivation.name,
    seed: derivation.campaignSeed,
    startDate: derivation.startDate,
    roster,
    playerEntrantId: roster[derivation.playerIndex].id,
    playerDivision: "singles",
    aiDifficulty: derivation.difficulty,
  });
  const suggestion = suggestPlayerMatch(campaign);
  campaign = scheduleCampaignMatch(campaign, suggestion);
  const due = campaign.schedule.find((row) => row.status === "scheduled")!;
  campaign = beginScheduledMatch(campaign, due.id);
  let match = campaign.activeMatch!;
  let guard = 0;
  while (!match.result && guard < 8000) {
    match = advanceUntilPlayerDecision(match);
    if (match.result) break;
    if (!match.decision) throw new Error("stalled");
    const action = chooseDeterministicPolicyAction(match, match.decision);
    match = submitPlayerIntent(match, action.intent);
    guard += 1;
  }
  if (!match.result) throw new Error("match did not finish");
  const committed = commitScheduledMatchResult(checkpointScheduledMatch(campaign, match));
  const completed = committed.schedule.find((row) => row.id === due.id)!;
  return {
    committed,
    final: advanceCampaignDays(committed, derivation.advanceDays),
    matchFinalHash: completed.result!.finalMatchHash,
  };
}

/** Builds the fixture evidence record by re-deriving the campaign from the spec. */
export function buildRuthlessCampaignEvidence(derivation: RuthlessCampaignDerivation): RuthlessCampaignEvidence {
  const { committed, final, matchFinalHash } = deriveRuthlessCampaign(derivation);
  return {
    committedCampaignHash: hashCampaignState(committed),
    finalCampaignHash: hashCampaignState(final),
    matchFinalHash,
  };
}
