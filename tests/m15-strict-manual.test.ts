import { describe, expect, it } from "vitest";
import {
  createCampaign,
  createMatch,
  hashCampaignState,
  importCampaignJson,
  scheduleCampaignMatch,
  serializeCampaign,
  strictManualCampaignCompatibility,
  strictManualCampaignConfigViolations,
} from "../src/core";
import type { CampaignConfig } from "../src/core";
import { makeCareerRecord } from "../scripts/m10-ruthless-campaign";

function config(seed = 1991): CampaignConfig {
  const roster = Array.from({ length: 6 }, (_, index) => makeCareerRecord(25_000 + seed, index));
  return {
    name: "M15 Strict Manual",
    seed,
    startDate: "1991-01-01",
    roster,
    playerEntrantId: roster[4].id,
    playerDivision: "singles",
    aiDifficulty: "veteran",
  };
}

describe("M15 strict manual product compatibility", () => {
  it("reports every incompatible setup field individually", () => {
    const source = {
      ...config(),
      postMatchInjuryPolicy: "d20-check" as const,
      variety: "ladder" as const,
      financePolicy: "contracts" as const,
      contracts: [{ wrestlerId: "w1", weeklySalary: 100, termWeeks: 4 }],
      chemistry: [{ memberIds: ["w1", "w2"] as [string, string], label: "pair" }],
      negotiationPolicy: "offers" as const,
      renewalStrategy: "curve-fair" as const,
      bookingPolicy: "feuds" as const,
      feuds: [{ entrantIds: ["w1", "w2"] as [string, string] }],
    };
    expect(strictManualCampaignConfigViolations(source).map((entry) => entry.field)).toEqual([
      "postMatchInjuryPolicy",
      "variety",
      "financePolicy",
      "contracts",
      "chemistry",
      "negotiationPolicy",
      "renewalStrategy",
      "bookingPolicy",
      "feuds",
    ]);
  });

  it("derives compatibility without mutating canonical campaign identity", () => {
    const state = createCampaign(config(2001));
    const before = hashCampaignState(state);
    const compatibility = strictManualCampaignCompatibility(state);
    expect(compatibility).toMatchObject({ profileId: "strict-manual-derived-v1", compatible: true, label: "Strict Manual compatible", violations: [] });
    expect(hashCampaignState(state)).toBe(before);
  });

  it("keeps an existing extension-off save compatible without migration", () => {
    const source = createCampaign(config(2002));
    const serialized = serializeCampaign(source, false);
    expect(serialized).not.toContain('"strictManual"');
    const restored = importCampaignJson(serialized).state;
    expect(hashCampaignState(restored)).toBe(hashCampaignState(source));
    expect(strictManualCampaignCompatibility(restored).compatible).toBe(true);
  });

  it("detects a scheduled non-standard variety even when the campaign default is standard", () => {
    let state = createCampaign(config(2003));
    const opponent = state.rankings.singles.entries.find((row) => row.entrantId !== state.playerEntrantId)!.entrantId;
    state = scheduleCampaignMatch(state, { date: state.currentDate, entrantIds: [state.playerEntrantId, opponent], variety: "cage" });
    const compatibility = strictManualCampaignCompatibility(state);
    expect(compatibility.compatible).toBe(false);
    expect(compatibility.violations.map((entry) => entry.field)).toContain("schedule.variety");
  });

  it("detects a non-standard active match without persisting a profile flag", () => {
    const state = createCampaign(config(2004));
    const draft = structuredClone(state);
    draft.activeMatch = createMatch({ seed: 2004, variety: "ladder" });
    const compatibility = strictManualCampaignCompatibility(draft);
    expect(compatibility.compatible).toBe(false);
    expect(compatibility.violations.map((entry) => entry.field)).toContain("activeMatch.config.variety");
    expect(JSON.stringify(draft)).not.toContain('"strictManual"');
  });
});
