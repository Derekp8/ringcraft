import { describe, expect, it } from "vitest";
import {
  advanceCampaignDays,
  createCampaign,
  expectedWeeklySalary,
  importCampaignJson,
  offerContract,
  serializeCampaign,
} from "../src/core";
import type { CampaignState, WrestlerCareerRecord } from "../src/core";
import { buildNegotiationSummary } from "../src/ui/campaign-presentation";
import { makeUnderdogRecord } from "../scripts/m11-playtest-batch";

function roster(count = 6, seedBase = 300): WrestlerCareerRecord[] {
  return Array.from({ length: count }, (_, index) => makeUnderdogRecord(seedBase + index, index));
}

function makeCampaign(seed = 1991, extra: Record<string, unknown> = {}): CampaignState {
  const records = roster();
  return createCampaign({
    name: "M12 Negotiation UI",
    seed,
    startDate: "1991-01-01",
    roster: records,
    playerEntrantId: records[0].id,
    playerDivision: "singles",
    financePolicy: "contracts",
    negotiationPolicy: "offers",
    ...extra,
  });
}

describe("M12 negotiation UI presenter", () => {
  it("reports negotiation disabled with empty rows when the extension is off", () => {
    const records = roster();
    const plain = createCampaign({
      name: "Plain",
      seed: 1991,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: records[0].id,
      playerDivision: "singles",
    });
    const summary = buildNegotiationSummary(plain);
    expect(summary.enabled).toBe(false);
    expect(summary.contracts).toEqual([]);
    expect(summary.freeAgents).toEqual([]);
    expect(summary.outstandingOffers).toEqual([]);
    expect(summary.history).toEqual([]);
    // Finance without negotiation also reports disabled.
    const financeOnly = createCampaign({
      name: "Finance Only",
      seed: 1991,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: records[0].id,
      playerDivision: "singles",
      financePolicy: "contracts",
    });
    expect(buildNegotiationSummary(financeOnly).enabled).toBe(false);
  });

  it("lists contracts with expiry, expected salary, and the expiring-soon flag", () => {
    const records = roster();
    const campaign = makeCampaign(1991, {
      contracts: [
        { wrestlerId: records[0].id, weeklySalary: 250, termWeeks: 52 },
        { wrestlerId: records[1].id, weeklySalary: 175, termWeeks: 2 },
      ],
    });
    const summary = buildNegotiationSummary(campaign);
    expect(summary.enabled).toBe(true);
    const long = summary.contracts.find((row) => row.wrestlerId === records[0].id)!;
    expect(long).toMatchObject({ weeklySalary: 250, termWeeks: 52, active: true, expiryDate: "1991-12-31" });
    expect(long.expiringSoon).toBe(false);
    expect(long.expectedSalary).toBe(expectedWeeklySalary(50));
    const short = summary.contracts.find((row) => row.wrestlerId === records[1].id)!;
    expect(short).toMatchObject({ termWeeks: 2, active: true });
    expect(short.expiryDate).toBe("1991-01-15");
    // Expiry within 14 days is flagged as expiring soon.
    expect(short.expiringSoon).toBe(true);
  });

  it("flags expired contracts and still lists them with the pending-renewal note data", () => {
    const records = roster();
    const campaign = makeCampaign(1991, {
      contracts: [{ wrestlerId: records[0].id, weeklySalary: 100, termWeeks: 2 }],
    });
    const advanced = advanceCampaignDays(campaign, 21);
    const summary = buildNegotiationSummary(advanced);
    const row = summary.contracts.find((entry) => entry.wrestlerId === records[0].id)!;
    expect(row.active).toBe(false);
    expect(row.expiringSoon).toBe(true);
  });

  it("lists free agents with popularity, expected salary, and the outstanding-offer flag", () => {
    const records = roster();
    const campaign = makeCampaign(1991, {
      contracts: [{ wrestlerId: records[0].id, weeklySalary: 250, termWeeks: 52 }],
    });
    const summary = buildNegotiationSummary(campaign);
    expect(summary.freeAgents).toHaveLength(records.length - 1);
    for (const agent of summary.freeAgents) {
      expect(agent.wrestlerId).not.toBe(records[0].id);
      expect(agent.expectedSalary).toBe(expectedWeeklySalary(agent.popularity));
      expect(agent.outstandingOffer).toBe(false);
    }
    // A fair offer signs immediately; the target leaves the free-agent list and
    // the accept basis lands in history.
    const fair = offerContract(campaign, records[1].id, { weeklySalary: 350, termWeeks: 26 });
    const after = buildNegotiationSummary(fair);
    expect(after.freeAgents.some((agent) => agent.wrestlerId === records[1].id)).toBe(false);
    const row = after.history[0];
    expect(row).toMatchObject({ wrestlerId: records[1].id, type: "accepted", weeklySalary: 350, expectedSalary: 350 });
    expect(row.basis).toContain("Fair offer");
    expect(after.contracts.some((entry) => entry.wrestlerId === records[1].id && entry.active)).toBe(true);
  });

  it("surfaces the deterministic accept/reject basis for low and short offers", () => {
    const records = roster();
    const low = offerContract(makeCampaign(1991), records[1].id, { weeklySalary: 100, termWeeks: 26 });
    const lowSummary = buildNegotiationSummary(low);
    expect(lowSummary.history[0]).toMatchObject({ wrestlerId: records[1].id, type: "rejected", weeklySalary: 100, expectedSalary: 350 });
    expect(lowSummary.history[0].basis).toContain("Low offer");
    expect(lowSummary.freeAgents.some((agent) => agent.wrestlerId === records[1].id)).toBe(true);
    // Pinned short-offer dice: seed 1991 rolls D20 11 > 10 → rejected with the
    // die recorded in the basis.
    const short = offerContract(makeCampaign(1991), records[1].id, { weeklySalary: 280, termWeeks: 26 });
    const shortSummary = buildNegotiationSummary(short);
    expect(shortSummary.history[0].type).toBe("rejected");
    expect(shortSummary.history[0].basis).toMatch(/Short offer: \$280\/week vs the \$350 expectation for popularity 50 \(D20 11 > 10 rejected\)/);
    // Seed 2000 rolls D20 6 ≤ 10 → accepted.
    const shortAccept = offerContract(makeCampaign(2000), records[1].id, { weeklySalary: 280, termWeeks: 26 });
    const shortAcceptSummary = buildNegotiationSummary(shortAccept);
    expect(shortAcceptSummary.history[0].type).toBe("accepted");
    expect(shortAcceptSummary.history[0].basis).toMatch(/D20 6 ≤ 10 accepted/);
  });

  it("orders history newest-first and caps the surfaced list", () => {
    const records = roster();
    let campaign = makeCampaign(1991);
    for (let index = 1; index <= 3; index += 1) {
      campaign = offerContract(campaign, records[index].id, { weeklySalary: 350, termWeeks: 26 });
    }
    const summary = buildNegotiationSummary(campaign);
    const dates = summary.history.map((row) => row.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(summary.history).toHaveLength(3);
  });

  it("leaves the summary deterministically derived from the campaign state", () => {
    const first = buildNegotiationSummary(offerContract(makeCampaign(7), roster()[1].id, { weeklySalary: 350, termWeeks: 26 }));
    const second = buildNegotiationSummary(offerContract(makeCampaign(7), roster()[1].id, { weeklySalary: 350, termWeeks: 26 }));
    expect(first).toEqual(second);
  });

  it("surfaces the active renewal strategy so the dashboard shows what setup chose", () => {
    // Default (no renewalStrategy) reports the expiring-salary baseline.
    expect(buildNegotiationSummary(makeCampaign(1991)).renewalStrategy).toBe("expiring-salary");
    // An explicit "expiring-salary" config normalizes to the same baseline.
    const explicit = createCampaign({
      name: "Explicit",
      seed: 1991,
      startDate: "1991-01-01",
      roster: roster(),
      playerEntrantId: roster()[0].id,
      playerDivision: "singles",
      financePolicy: "contracts",
      negotiationPolicy: "offers",
      renewalStrategy: "expiring-salary",
    });
    expect(buildNegotiationSummary(explicit).renewalStrategy).toBe("expiring-salary");
    // The M12-ADJ-09 curve-fair strategy is reported when enabled.
    const curveFair = createCampaign({
      name: "Curve Fair",
      seed: 1991,
      startDate: "1991-01-01",
      roster: roster(),
      playerEntrantId: roster()[0].id,
      playerDivision: "singles",
      financePolicy: "contracts",
      negotiationPolicy: "offers",
      renewalStrategy: "curve-fair",
    });
    expect(buildNegotiationSummary(curveFair).renewalStrategy).toBe("curve-fair");
  });

  it("keeps the renewal strategy across an import round trip", () => {
    const curveFair = createCampaign({
      name: "Curve Fair",
      seed: 1991,
      startDate: "1991-01-01",
      roster: roster(),
      playerEntrantId: roster()[0].id,
      playerDivision: "singles",
      financePolicy: "contracts",
      negotiationPolicy: "offers",
      renewalStrategy: "curve-fair",
    });
    const restored = importCampaignJson(serializeCampaign(curveFair)).state;
    expect(restored.renewalStrategy).toBe("curve-fair");
    expect(buildNegotiationSummary(restored).renewalStrategy).toBe("curve-fair");
  });
});
