import { describe, expect, it } from "vitest";
import {
  POST_MATCH_INJURY_POLICY_VERSION,
  POST_MATCH_INJURY_TABLE_HASH,
  createCampaign,
  createCreationSession,
  finalizeCreationSession,
  hashCampaignState,
  importCampaignJson,
  postMatchInjuryEligible,
  resolvePostMatchInjury,
  resolveScheduledMatchHeadless,
  scheduleCampaignMatch,
  serializeCampaign,
  setCreationIdentity,
  setCreationSide,
  validateCampaignState,
  autoAllocateCreationPoints,
  rollCreationHistory,
  rollCreationStature,
} from "../src/core";
import type { CampaignInjury, CampaignState, WrestlerCareerRecord } from "../src/core";

function makeRecord(seed: number, index: number): WrestlerCareerRecord {
  let session = createCreationSession(seed + index);
  session = setCreationIdentity(session, { name: `Injury Test Wrestler ${index}`, epithet: "T", affiliation: "Injury Test Roster" });
  session = setCreationSide(session, index % 2 ? "rulebreaker" : "fan-favorite");
  session = rollCreationStature(session);
  session = rollCreationHistory(session);
  session = autoAllocateCreationPoints(session);
  return finalizeCreationSession(session).finalized!;
}

function makeCampaign(seed: number, policy: "off" | "d20-check" = "off"): CampaignState {
  const roster = Array.from({ length: 4 }, (_, index) => makeRecord(seed, index));
  return createCampaign({
    name: "Injury Test",
    seed,
    startDate: "1991-01-01",
    roster,
    playerEntrantId: roster[0].id,
    playerDivision: "singles",
    postMatchInjuryPolicy: policy,
  });
}

function postMatchInjuries(state: CampaignState): CampaignInjury[] {
  return state.injuries.filter((row) => row.detail.startsWith("Post-match"));
}

function resolveOneMatch(state: CampaignState): CampaignState {
  const scheduled = scheduleCampaignMatch(state, { date: state.currentDate, entrantIds: [Object.keys(state.roster)[0], Object.keys(state.roster)[1]] });
  return resolveScheduledMatchHeadless(scheduled, scheduled.schedule[0].id);
}

describe("post-match injury table rules", () => {
  it("keeps an independent version and hash identity", () => {
    expect(POST_MATCH_INJURY_POLICY_VERSION).toBe("classic-1991-post-match-injury-v1");
    expect(typeof POST_MATCH_INJURY_TABLE_HASH).toBe("string");
  });

  it("checks eligibility only for beat-down or knocked-out participants", () => {
    expect(postMatchInjuryEligible(0, 40, false)).toBe(false);
    expect(postMatchInjuryEligible(19, 40, false)).toBe(false);
    expect(postMatchInjuryEligible(20, 40, false)).toBe(true);
    expect(postMatchInjuryEligible(21, 40, false)).toBe(true);
    expect(postMatchInjuryEligible(0, 40, true)).toBe(true);
    expect(() => postMatchInjuryEligible(5, 0, false)).toThrow(/damage pool/i);
    expect(() => postMatchInjuryEligible(-1, 40, false)).toThrow(/damage taken/i);
  });

  it("maps the D20 check to source-vocabulary severities and week durations", () => {
    expect(resolvePostMatchInjury(1, 6)).toEqual({ severity: "broken-extremity", weeks: 6 });
    expect(resolvePostMatchInjury(1, 1)).toEqual({ severity: "broken-extremity", weeks: 1 });
    expect(resolvePostMatchInjury(2, 6)).toEqual({ severity: "sprain", weeks: 3 });
    expect(resolvePostMatchInjury(3, 1)).toEqual({ severity: "sprain", weeks: 1 });
    expect(resolvePostMatchInjury(3, 2)).toEqual({ severity: "sprain", weeks: 1 });
    expect(resolvePostMatchInjury(3, 3)).toEqual({ severity: "sprain", weeks: 2 });
    expect(resolvePostMatchInjury(4, 6)).toBeNull();
    expect(resolvePostMatchInjury(20, 1)).toBeNull();
    expect(() => resolvePostMatchInjury(0, 6)).toThrow(/D20/i);
    expect(() => resolvePostMatchInjury(21, 6)).toThrow(/D20/i);
    expect(() => resolvePostMatchInjury(1, 0)).toThrow(/D6/i);
  });
});

describe("post-match injury campaign integration", () => {
  it("leaves default campaigns untouched and hash-compatible", () => {
    const campaign = makeCampaign(1991);
    expect(campaign.postMatchInjuryPolicy).toBeUndefined();
    expect(campaign.postMatchInjuryVersion).toBeUndefined();
    const resolved = resolveOneMatch(campaign);
    expect(postMatchInjuries(resolved)).toEqual([]);
    expect(resolved.events.some((row) => row.detail.some((line) => line.includes("post-match injury")))).toBe(false);
  });

  it("pins the policy and table version on enabled campaigns", () => {
    const campaign = makeCampaign(1991, "d20-check");
    expect(campaign.postMatchInjuryPolicy).toBe("d20-check");
    expect(campaign.postMatchInjuryVersion).toBe(POST_MATCH_INJURY_POLICY_VERSION);
  });

  it("produces deterministic post-match injuries across identical seeds", () => {
    const first = resolveOneMatch(makeCampaign(2000, "d20-check"));
    const second = resolveOneMatch(makeCampaign(2000, "d20-check"));
    expect(postMatchInjuries(first)).toEqual(postMatchInjuries(second));
    expect(hashCampaignState(first)).toBe(hashCampaignState(second));
  });

  it("records the pinned seed-2000 sprain exactly", () => {
    const resolved = resolveOneMatch(makeCampaign(2000, "d20-check"));
    const injuries = postMatchInjuries(resolved);
    expect(injuries).toHaveLength(1);
    expect(injuries[0].weeks).toBe(3);
    expect(injuries[0].active).toBe(true);
    expect(injuries[0].detail).toMatch(/^Post-match sprain \(check [23]\): 3 week\(s\) out/);
    expect(injuries[0].returnDate > injuries[0].occurredDate).toBe(true);
    const commit = resolved.events.find((row) => row.type === "commit-match-result");
    expect(commit?.dice.some((die) => die.sides === 20)).toBe(true);
  });

  it("runs the check only for eligible participants and records it in the event log", () => {
    const resolved = resolveOneMatch(makeCampaign(1992, "d20-check"));
    expect(postMatchInjuries(resolved)).toEqual([]);
    const commit = resolved.events.find((row) => row.type === "commit-match-result")!;
    const lines = commit.detail.join(" ");
    expect(lines).toMatch(/post-match injury check \d+ (cleared|\()/);
    expect(lines).toMatch(/post-match injury check skipped \(\d+\/\d+ damage taken\)/);
  });

  it("survives export/import with a stable canonical hash", () => {
    const resolved = resolveOneMatch(makeCampaign(2000, "d20-check"));
    const imported = importCampaignJson(serializeCampaign(resolved)).state;
    expect(imported.postMatchInjuryPolicy).toBe("d20-check");
    expect(imported.postMatchInjuryVersion).toBe(POST_MATCH_INJURY_POLICY_VERSION);
    expect(imported.injuries).toEqual(resolved.injuries);
    expect(hashCampaignState(imported)).toBe(hashCampaignState(resolved));
  });

  it("rejects a policy/version mismatch and accepts clean saves", () => {
    const campaign = makeCampaign(1991, "d20-check");
    expect(validateCampaignState(campaign)).toEqual([]);
    const tampered: CampaignState = { ...campaign, postMatchInjuryVersion: "wrong-version" };
    expect(validateCampaignState(tampered)).toEqual(expect.arrayContaining([expect.stringContaining("postMatchInjuryVersion")]));
    const orphaned: CampaignState = { ...campaign, postMatchInjuryPolicy: undefined, postMatchInjuryVersion: POST_MATCH_INJURY_POLICY_VERSION };
    expect(validateCampaignState(orphaned)).toEqual(expect.arrayContaining([expect.stringContaining("postMatchInjuryVersion")]));
  });

  it("blocks scheduling for a wrestler with an active post-match layoff", () => {
    const resolved = resolveOneMatch(makeCampaign(2000, "d20-check"));
    const injured = postMatchInjuries(resolved).find((row) => row.active)!;
    const opponent = Object.keys(resolved.roster).find((id) => id !== injured.wrestlerId)!;
    expect(() => scheduleCampaignMatch(resolved, { date: resolved.currentDate, entrantIds: [injured.wrestlerId, opponent] })).toThrow(/injured/i);
  });
});
