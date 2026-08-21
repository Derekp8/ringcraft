import { describe, expect, it } from "vitest";
import {
  STRICT_MANUAL_PROFILE_ID,
  assertStrictManualCampaignConfig,
  assertStrictManualMatchSetup,
  createCampaign,
  createMatch,
  isStrictManualCampaign,
  isStrictManualMatch,
  strictManualCampaignConfigViolations,
  strictManualCampaignStateViolations,
} from "../src/core";
import type { CampaignConfig } from "../src/core";
import { makeCareerRecord } from "../scripts/m10-ruthless-campaign";

function baseConfig(): CampaignConfig {
  const roster = Array.from({ length: 6 }, (_, index) => makeCareerRecord(14_000, index));
  return {
    name: "M14 Strict Manual",
    seed: 1991,
    startDate: "1991-01-01",
    roster,
    playerEntrantId: roster[4].id,
    playerDivision: "singles",
    aiDifficulty: "ruthless",
  };
}

describe("M14 strict manual compatibility", () => {
  it("is a stable derived profile and allows AI difficulty without changing rules", () => {
    expect(STRICT_MANUAL_PROFILE_ID).toBe("strict-manual-derived-v1");
    const config = baseConfig();
    expect(strictManualCampaignConfigViolations(config)).toEqual([]);
    expect(() => assertStrictManualCampaignConfig(config)).not.toThrow();

    const campaign = createCampaign(config);
    expect(strictManualCampaignStateViolations(campaign)).toEqual([]);
    expect(isStrictManualCampaign(campaign)).toBe(true);

    const match = createMatch({ seed: 1991, mode: "singles", aiDifficulty: "ruthless", variety: "standard" });
    expect(isStrictManualMatch(match)).toBe(true);
  });

  it("rejects adjudicated/digital campaign extensions", () => {
    const config = {
      ...baseConfig(),
      postMatchInjuryPolicy: "d20-check" as const,
      variety: "cage" as const,
      financePolicy: "contracts" as const,
      contracts: [{ wrestlerId: "w1", weeklySalary: 100, termWeeks: 4 }],
      chemistry: [{ memberIds: ["w1", "w2"] as [string, string], label: "pair" }],
      negotiationPolicy: "offers" as const,
      renewalStrategy: "curve-fair" as const,
      bookingPolicy: "feuds" as const,
      feuds: [{ entrantIds: ["w1", "w2"] as [string, string] }],
    };
    const fields = strictManualCampaignConfigViolations(config).map((entry) => entry.field);
    expect(fields).toEqual([
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
    expect(() => assertStrictManualCampaignConfig(config)).toThrow(/Strict Manual Mode rejected configuration/);
  });

  it("treats persisted extension state as non-strict after load/clone", () => {
    const campaign = createCampaign(baseConfig());
    const finance = structuredClone(campaign);
    finance.financePolicy = "contracts";
    expect(isStrictManualCampaign(finance)).toBe(false);
    expect(strictManualCampaignStateViolations(finance).map((entry) => entry.field)).toContain("financePolicy");
  });

  it("rejects cage/ladder setup but accepts absent or standard variety", () => {
    expect(() => assertStrictManualMatchSetup({ mode: "singles" })).not.toThrow();
    expect(() => assertStrictManualMatchSetup({ mode: "tag", variety: "standard" })).not.toThrow();
    expect(() => assertStrictManualMatchSetup({ mode: "singles", variety: "ladder" })).toThrow(/variety/);
  });
});
