import { describe, expect, it } from "vitest";
import {
  advanceCampaignDays,
  createCampaign,
  hashCampaignState,
  serializeCampaign,
} from "../src/core";
import type { CampaignState, WrestlerCareerRecord } from "../src/core";
import { buildFinanceSummary, buildMonthEndSummary } from "../src/ui/campaign-presentation";
import { makeUnderdogRecord } from "../scripts/m11-playtest-batch";

function roster(count = 4, seedBase = 300): WrestlerCareerRecord[] {
  return Array.from({ length: count }, (_, index) => makeUnderdogRecord(seedBase + index, index));
}

function makeCampaign(seed = 1991, extra: Record<string, unknown> = {}): CampaignState {
  return createCampaign({
    name: "M12 Finance UI",
    seed,
    startDate: "1991-01-01",
    roster: roster(),
    playerEntrantId: roster()[0].id,
    playerDivision: "singles",
    financePolicy: "contracts",
    ...extra,
  });
}

describe("M12 finance UI presenters", () => {
  it("reports finance disabled with empty rows when the extension is off", () => {
    const plain = createCampaign({
      name: "Plain",
      seed: 1991,
      startDate: "1991-01-01",
      roster: roster(),
      playerEntrantId: roster()[0].id,
      playerDivision: "singles",
    });
    const summary = buildFinanceSummary(plain);
    expect(summary.enabled).toBe(false);
    expect(summary.contracts).toEqual([]);
    expect(summary.payouts).toEqual([]);
    expect(summary.ledgerTotal).toBe(0);
    expect(summary.nextPayoutDate).toBeNull();
    expect(buildMonthEndSummary(plain)!.financeLine).toBeNull();
  });

  it("renders contracts with salary, term, ledger, and popularity", () => {
    const records = roster();
    const campaign = makeCampaign(1991, {
      contracts: [
        { wrestlerId: records[0].id, weeklySalary: 250, termWeeks: 52 },
        { wrestlerId: records[1].id, weeklySalary: 175, termWeeks: 26, signingBonus: 100 },
      ],
    });
    const summary = buildFinanceSummary(campaign);
    expect(summary.enabled).toBe(true);
    expect(summary.nextPayoutDate).toBe("1991-01-08");
    const player = summary.contracts.find((row) => row.wrestlerId === records[0].id)!;
    expect(player).toMatchObject({ weeklySalary: 250, termWeeks: 52, active: true, ledger: 0, popularity: 50 });
    const bonus = summary.contracts.find((row) => row.wrestlerId === records[1].id)!;
    expect(bonus).toMatchObject({ weeklySalary: 175, ledger: 100 });
    // Signing bonus appears as the first (weekIndex 0) payout.
    expect(summary.payouts[0]).toMatchObject({ date: "1991-01-01", weekIndex: 0, total: 100 });
    expect(summary.ledgerTotal).toBe(100);
  });

  it("shows weekly salary accumulation and contract expiry in the panel rows", () => {
    const records = roster();
    const campaign = makeCampaign(1991, {
      contracts: [{ wrestlerId: records[0].id, weeklySalary: 100, termWeeks: 2 }],
    });
    const week3 = advanceCampaignDays(advanceCampaignDays(advanceCampaignDays(campaign, 7), 7), 7);
    const summary = buildFinanceSummary(week3);
    const row = summary.contracts.find((entry) => entry.wrestlerId === records[0].id)!;
    expect(row.active).toBe(false);
    // A 2-week term covers exactly two paydays (01-08, 01-15); the 01-22
    // advance finds no active contracts, so no payout row is recorded.
    expect(row.ledger).toBe(200);
    expect(summary.payouts).toHaveLength(2);
    expect(summary.payouts[0]).toMatchObject({ date: "1991-01-15", weekIndex: 2, total: 100 });
  });

  it("adds a month-end finance line with payouts and popularity movement", () => {
    const records = roster();
    let campaign = makeCampaign(1991, {
      contracts: [{ wrestlerId: records[0].id, weeklySalary: 100, termWeeks: 52 }],
    });
    campaign = advanceCampaignDays(campaign, 14); // two weekly payouts, same month
    const summary = buildMonthEndSummary(campaign)!;
    expect(summary.financeLine).toMatch(/\$200 paid \(2 payouts\)/);
  });

  it("keeps the finance state out of the canonical hash when disabled and inside when enabled", () => {
    const records = roster();
    const plain = createCampaign({
      name: "Plain",
      seed: 1991,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: records[0].id,
      playerDivision: "singles",
    });
    const enabled = makeCampaign(1991, { contracts: [{ wrestlerId: records[0].id, weeklySalary: 100, termWeeks: 52 }] });
    const plainJson = JSON.parse(serializeCampaign(plain));
    expect(plainJson.financePolicy).toBeUndefined();
    expect(plainJson.finance).toBeUndefined();
    expect(hashCampaignState(enabled)).not.toBe(hashCampaignState(plain));
  });
});
