import { describe, expect, it } from "vitest";
import {
  NEGOTIATION_POLICY_VERSION,
  NEGOTIATION_RULES,
  NEGOTIATION_TABLE_HASH,
  SALARY_CURVE,
  acceptanceThreshold,
  advanceCampaignDays,
  campaignSummary,
  createCampaign,
  expectedWeeklySalary,
  hashCampaignState,
  importCampaignJson,
  offerContract,
  offerVerdict,
  serializeCampaign,
  validateCampaignSave,
  validateCampaignState,
  verifyCampaignRoundTrip,
} from "../src/core";
import type { CampaignState } from "../src/core";
import { makeUnderdogRecord } from "../scripts/m11-playtest-batch";

function roster(count = 4, seedBase = 300): ReturnType<typeof makeUnderdogRecord>[] {
  return Array.from({ length: count }, (_, index) => makeUnderdogRecord(seedBase + index, index));
}

function makeCampaign(seed = 1991, extra: Record<string, unknown> = {}): CampaignState {
  const records = roster();
  return createCampaign({
    name: "M12 Negotiation",
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

describe("M12 contract-negotiation rules data", () => {
  it("pins the policy version, table hash, and rules tables", () => {
    expect(NEGOTIATION_POLICY_VERSION).toBe("classic-1991-contract-negotiation-v1");
    expect(typeof NEGOTIATION_TABLE_HASH).toBe("string");
    expect(SALARY_CURVE).toMatchObject({ baseWeekly: 100, perPopularityPoint: 5, maxWeekly: 1000 });
    expect(SALARY_CURVE.source).toContain("M12-ADJ-07");
    expect(NEGOTIATION_RULES).toMatchObject({ fairThresholdPercent: 100, lowThresholdPercent: 60, acceptanceDie: 20 });
    expect(NEGOTIATION_RULES.source).toContain("M12-ADJ-06");
  });

  it("derives expected weekly salary from popularity on the curve", () => {
    expect(expectedWeeklySalary(0)).toBe(100);
    expect(expectedWeeklySalary(30)).toBe(250);
    expect(expectedWeeklySalary(50)).toBe(350);
    expect(expectedWeeklySalary(90)).toBe(550);
    expect(expectedWeeklySalary(100)).toBe(600);
    expect(expectedWeeklySalary(1000)).toBe(1000); // clamped at maxWeekly
  });

  it("grades offers fair/short/low and scales the D20 threshold linearly", () => {
    expect(offerVerdict(350, 350)).toBe("fair");
    expect(offerVerdict(400, 350)).toBe("fair");
    expect(offerVerdict(280, 350)).toBe("short");
    expect(offerVerdict(210, 350)).toBe("short"); // exactly 60% is still short
    expect(offerVerdict(209, 350)).toBe("low"); // 59.7% < 60%
    expect(offerVerdict(100, 350)).toBe("low");
    expect(acceptanceThreshold(280, 350)).toBe(10); // 80% → 50/50
    expect(acceptanceThreshold(245, 350)).toBe(5); // 70% → 25%
    expect(acceptanceThreshold(332, 350)).toBe(17); // 95% → 85%
    expect(acceptanceThreshold(210, 350)).toBe(0); // 60% → never on the die
  });
});

describe("M12 negotiation campaign integration", () => {
  it("leaves finance-only campaigns untouched and hash-compatible", () => {
    const records = roster();
    const plain = createCampaign({
      name: "Plain",
      seed: 1991,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: records[0].id,
      playerDivision: "singles",
      financePolicy: "contracts",
    });
    expect(plain.negotiationPolicy).toBeUndefined();
    expect(plain.negotiationVersion).toBeUndefined();
    expect(plain.negotiation).toBeUndefined();
    expect(validateCampaignSave(plain)).toEqual([]);
    const summary = campaignSummary(plain);
    expect(summary).not.toHaveProperty("negotiationOffers");
    expect(verifyCampaignRoundTrip(plain).valid).toBe(true);
    // The negotiation ledger changes nothing about finance-only behavior.
    const records2 = roster();
    const withNegotiation = createCampaign({
      name: "Neg",
      seed: 1991,
      startDate: "1991-01-01",
      roster: records2,
      playerEntrantId: records2[0].id,
      playerDivision: "singles",
      financePolicy: "contracts",
      negotiationPolicy: "offers",
    });
    expect(withNegotiation.negotiationPolicy).toBe("offers");
    expect(withNegotiation.negotiationVersion).toBe(NEGOTIATION_POLICY_VERSION);
    expect(withNegotiation.negotiation?.policyVersion).toBe(NEGOTIATION_POLICY_VERSION);
    expect(withNegotiation.negotiation?.offers).toEqual([]);
    expect(withNegotiation.negotiation?.history).toEqual([]);
  });

  it("rejects negotiation configuration without the finance extension", () => {
    const records = roster();
    expect(() =>
      createCampaign({
        name: "Bad",
        seed: 1991,
        startDate: "1991-01-01",
        roster: records,
        playerEntrantId: records[0].id,
        playerDivision: "singles",
        negotiationPolicy: "offers",
      }),
    ).toThrow(/financePolicy/);
  });

  it("fair offers auto-accept and sign immediately with no dice", () => {
    const records = roster();
    const campaign = makeCampaign(1991);
    // records[1] has no contract; popularity 50 → expectation 350; $400 is fair.
    const offered = offerContract(campaign, records[1].id, { weeklySalary: 400, termWeeks: 4, signingBonus: 100 });
    const offer = offered.negotiation!.offers.at(-1)!;
    expect(offer.status).toBe("accepted");
    expect(offer.reason).toBe("player");
    expect(offer.expectedSalary).toBe(350);
    expect(offer.basis).toContain("Fair offer");
    expect(offer.basis).toContain("$400/week");
    expect(offered.finance!.contracts[records[1].id]).toMatchObject({ weeklySalary: 400, termWeeks: 4, signingBonus: 100, startDate: "1991-01-01" });
    expect(offered.finance!.ledgers[records[1].id]).toBe(100);
    expect(offered.finance!.payouts).toHaveLength(1);
    expect(offered.finance!.payouts[0]).toMatchObject({ date: "1991-01-01", weekIndex: 0, total: 100 });
    expect(offered.negotiation!.history).toHaveLength(1);
    expect(offered.negotiation!.history[0]).toMatchObject({ type: "accepted", weeklySalary: 400, expectedSalary: 350 });
    // No dice are consumed by a fair decision.
    const event = offered.events.at(-1)!;
    expect(event.type).toBe("offer-contract");
    expect(event.dice).toEqual([]);
  });

  it("low offers auto-reject with no contract and no dice", () => {
    const records = roster();
    const campaign = makeCampaign(1991);
    const offered = offerContract(campaign, records[1].id, { weeklySalary: 150, termWeeks: 4 });
    const offer = offered.negotiation!.offers.at(-1)!;
    expect(offer.status).toBe("rejected");
    expect(offer.basis).toContain("Low offer");
    expect(offered.finance!.contracts[records[1].id]).toBeUndefined();
    expect(offered.negotiation!.history.at(-1)).toMatchObject({ type: "rejected", expectedSalary: 350 });
    expect(offered.events.at(-1)!.dice).toEqual([]);
    // The wrestler remains available for a later, fairer offer.
    const second = offerContract(offered, records[1].id, { weeklySalary: 350, termWeeks: 4 });
    expect(second.negotiation!.offers.at(-1)!.status).toBe("accepted");
  });

  it("short offers resolve on a recorded D20, pinned by seed", () => {
    // Popularity 50 → expectation 350; $280 is 80% → threshold 10.
    const records = roster();
    const seed1991 = makeCampaign(1991);
    const rejected = offerContract(seed1991, records[1].id, { weeklySalary: 280, termWeeks: 4, signingBonus: 100 });
    const rejectedOffer = rejected.negotiation!.offers.at(-1)!;
    expect(rejectedOffer.status).toBe("rejected");
    expect(rejectedOffer.basis).toContain("D20 11 > 10 rejected");
    expect(rejected.events.at(-1)!.dice).toHaveLength(1);
    expect(rejected.finance!.contracts[records[1].id]).toBeUndefined();

    const records2 = roster();
    const seed2000 = makeCampaign(2000);
    const accepted = offerContract(seed2000, records2[1].id, { weeklySalary: 280, termWeeks: 4, signingBonus: 100 });
    const acceptedOffer = accepted.negotiation!.offers.at(-1)!;
    expect(acceptedOffer.status).toBe("accepted");
    expect(acceptedOffer.basis).toContain("D20 6 ≤ 10 accepted");
    expect(accepted.events.at(-1)!.dice).toHaveLength(1);
    expect(accepted.finance!.contracts[records2[1].id]).toMatchObject({ weeklySalary: 280, termWeeks: 4, signingBonus: 100 });
    expect(accepted.finance!.ledgers[records2[1].id]).toBe(100);
  });

  it("validates offer inputs", () => {
    const records = roster();
    const campaign = makeCampaign(1991);
    expect(() => offerContract(campaign, "nope", { weeklySalary: 400, termWeeks: 4 })).toThrow(/Unknown campaign wrestler/);
    expect(() => offerContract(campaign, records[1].id, { weeklySalary: 0, termWeeks: 4 })).toThrow(/salary/);
    expect(() => offerContract(campaign, records[1].id, { weeklySalary: 400, termWeeks: 0 })).toThrow(/term/);
    expect(() => offerContract(campaign, records[1].id, { weeklySalary: 400, termWeeks: 4, signingBonus: -1 })).toThrow(/bonus/);
    const signed = offerContract(campaign, records[1].id, { weeklySalary: 400, termWeeks: 4 });
    expect(() => offerContract(signed, records[1].id, { weeklySalary: 400, termWeeks: 4 })).toThrow(/already has a contract/);
    const plain = createCampaign({
      name: "Plain",
      seed: 1991,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: records[0].id,
      playerDivision: "singles",
      financePolicy: "contracts",
    });
    expect(() => offerContract(plain, records[1].id, { weeklySalary: 400, termWeeks: 4 })).toThrow(/extension/);
  });

  it("re-signs a cold wrestler at expiry and keeps the payout cadence unbroken", () => {
    const records = roster();
    const campaign = makeCampaign(1991, {
      contracts: [{ wrestlerId: records[1].id, weeklySalary: 100, termWeeks: 1 }],
    });
    campaign.finance!.popularity[records[1].id] = 0; // expectation 100 = the expiring salary → fair
    const advanced = advanceCampaignDays(campaign, 8);
    expect(advanced.currentDate).toBe("1991-01-09");
    const renewal = advanced.negotiation!.offers.at(-1)!;
    expect(renewal.status).toBe("accepted");
    expect(renewal.reason).toBe("renewal");
    expect(renewal.expectedSalary).toBe(100);
    expect(renewal.basis).toContain("Fair offer");
    // The renewal signs a new contract starting the first inactive day.
    expect(advanced.finance!.contracts[records[1].id]).toMatchObject({ weeklySalary: 100, termWeeks: 1, startDate: "1991-01-09", signingBonus: 0 });
    // Payroll continues: week-1 payout (01-08) plus the renewed week (01-15).
    const twoWeeks = advanceCampaignDays(advanced, 7);
    expect(twoWeeks.finance!.payouts).toHaveLength(2);
    expect(twoWeeks.finance!.ledgers[records[1].id]).toBe(200);
  });

  it("lets a baseline wrestler walk at expiry instead of re-signing for less", () => {
    const records = roster();
    const campaign = makeCampaign(1991, {
      contracts: [{ wrestlerId: records[1].id, weeklySalary: 100, termWeeks: 1 }],
    });
    campaign.finance!.popularity[records[1].id] = 50; // expectation 350 → $100 is low
    const advanced = advanceCampaignDays(campaign, 8);
    const renewal = advanced.negotiation!.offers.at(-1)!;
    expect(renewal.status).toBe("rejected");
    expect(renewal.reason).toBe("renewal");
    expect(renewal.basis).toContain("Low offer");
    expect(renewal.basis).toContain("expectation for popularity 50");
    // The expired contract stays inert; nothing pays in the empty week.
    expect(advanced.finance!.contracts[records[1].id]).toMatchObject({ startDate: "1991-01-01", weeklySalary: 100 });
    const later = advanceCampaignDays(advanced, 7);
    expect(later.finance!.payouts).toHaveLength(1); // only the 01-08 payout
    expect(later.finance!.ledgers[records[1].id]).toBe(100);
  });

  it("lets an over-achieving wrestler walk when their salary no longer matches popularity", () => {
    const records = roster();
    const campaign = makeCampaign(1991, {
      contracts: [{ wrestlerId: records[1].id, weeklySalary: 300, termWeeks: 1 }],
    });
    campaign.finance!.popularity[records[1].id] = 90; // expectation 550 → $300 is low
    const advanced = advanceCampaignDays(campaign, 8);
    const renewal = advanced.negotiation!.offers.at(-1)!;
    expect(renewal.status).toBe("rejected");
    expect(renewal.expectedSalary).toBe(550);
    expect(renewal.basis).toContain("$300/week is under the $550 expectation");
  });

  it("resolves short renewals on a recorded D20, pinned by seed", () => {
    // Popularity 30 → expectation 250; $200 is 80% → threshold 10.
    const records = roster();
    const campaign = makeCampaign(1991, {
      contracts: [{ wrestlerId: records[1].id, weeklySalary: 200, termWeeks: 1 }],
    });
    campaign.finance!.popularity[records[1].id] = 30;
    const advanced = advanceCampaignDays(campaign, 8);
    const renewal = advanced.negotiation!.offers.at(-1)!;
    expect(renewal.reason).toBe("renewal");
    expect(renewal.status).toBe("rejected");
    expect(renewal.basis).toContain("D20 11 > 10 rejected");

    const records2 = roster();
    const seed2000 = makeCampaign(2000, {
      contracts: [{ wrestlerId: records2[1].id, weeklySalary: 200, termWeeks: 1 }],
    });
    seed2000.finance!.popularity[records2[1].id] = 30;
    const accepted = advanceCampaignDays(seed2000, 8);
    const acceptedRenewal = accepted.negotiation!.offers.at(-1)!;
    expect(acceptedRenewal.status).toBe("accepted");
    expect(acceptedRenewal.basis).toContain("D20 6 ≤ 10 accepted");
    expect(accepted.finance!.contracts[records2[1].id]).toMatchObject({ weeklySalary: 200, startDate: "1991-01-09" });
  });

  it("is fully deterministic across identical seeds", () => {
    const run = (seed: number): CampaignState => {
      const records = roster();
      const campaign = makeCampaign(seed, {
        contracts: [{ wrestlerId: records[1].id, weeklySalary: 200, termWeeks: 1 }],
      });
      campaign.finance!.popularity[records[1].id] = 30;
      return advanceCampaignDays(campaign, 8);
    };
    expect(hashCampaignState(run(1991))).toBe(hashCampaignState(run(1991)));
    expect(run(1991).negotiation!.offers).toEqual(run(1991).negotiation!.offers);
    expect(run(1991).negotiation!.history).toEqual(run(1991).negotiation!.history);
  });

  it("round-trips through serialization byte-identically", () => {
    const records = roster();
    const campaign = makeCampaign(2000, {
      contracts: [{ wrestlerId: records[1].id, weeklySalary: 200, termWeeks: 1 }],
    });
    campaign.finance!.popularity[records[1].id] = 30;
    const advanced = advanceCampaignDays(campaign, 8);
    expect(verifyCampaignRoundTrip(advanced).valid).toBe(true);
    const imported = importCampaignJson(serializeCampaign(advanced)).state;
    expect(hashCampaignState(imported)).toBe(hashCampaignState(advanced));
    expect(imported.negotiation).toEqual(advanced.negotiation);
  });

  it("rejects tampered negotiation state", () => {
    const campaign = makeCampaign(1991);
    const badVersion = structuredClone(campaign);
    badVersion.negotiationVersion = "wrong";
    expect(validateCampaignState(badVersion).some((line) => line.includes("negotiationVersion"))).toBe(true);
    const orphanLedger = structuredClone(campaign);
    orphanLedger.negotiationPolicy = undefined;
    orphanLedger.negotiationVersion = undefined;
    expect(validateCampaignState(orphanLedger).some((line) => line.includes("negotiation: ledger present"))).toBe(true);
    const missingLedger = structuredClone(campaign);
    missingLedger.negotiation = undefined;
    expect(validateCampaignState(missingLedger).some((line) => line.includes("requires the negotiation ledger"))).toBe(true);
    const noFinance = structuredClone(campaign);
    noFinance.financePolicy = undefined;
    noFinance.financeVersion = undefined;
    noFinance.finance = undefined;
    expect(validateCampaignState(noFinance).some((line) => line.includes("requires the M12 contracts-and-finance"))).toBe(true);
    const badOffer = structuredClone(campaign);
    badOffer.negotiation!.offers.push({
      id: "contract-offer-dupe",
      wrestlerId: "ghost",
      weeklySalary: 100,
      termWeeks: 1,
      signingBonus: 0,
      offeredAt: "1991-01-01",
      expectedSalary: 350,
      status: "offered",
      reason: "player",
      basis: "tampered",
    });
    expect(validateCampaignState(badOffer).some((line) => line.includes("unknown wrestler"))).toBe(true);
  });

  it("surfaces negotiation counters in the campaign summary when enabled", () => {
    const records = roster();
    const campaign = makeCampaign(1991);
    const offered = offerContract(campaign, records[1].id, { weeklySalary: 400, termWeeks: 4 });
    const summary = campaignSummary(offered);
    expect(summary.negotiationOffers).toBe(1);
    expect(summary.negotiationAccepted).toBe(1);
  });
});

describe("M12-ADJ-09 curve-fair renewal strategy", () => {
  it("keeps the default renewal byte-identical to an explicit expiring-salary campaign", () => {
    const records = roster();
    const base = makeCampaign(1991, {
      contracts: [{ wrestlerId: records[1].id, weeklySalary: 100, termWeeks: 1 }],
    });
    base.finance!.popularity[records[1].id] = 0;
    const explicit = makeCampaign(1991, {
      contracts: [{ wrestlerId: records[1].id, weeklySalary: 100, termWeeks: 1 }],
      renewalStrategy: "expiring-salary",
    });
    explicit.finance!.popularity[records[1].id] = 0;
    expect(hashCampaignState(base)).toBe(hashCampaignState(explicit));
    expect((base as unknown as Record<string, unknown>).renewalStrategy).toBeUndefined();
    expect((explicit as unknown as Record<string, unknown>).renewalStrategy).toBeUndefined();
    const advanced = advanceCampaignDays(base, 8);
    const renewal = advanced.negotiation!.offers.at(-1)!;
    expect(renewal.status).toBe("accepted");
    expect(renewal.weeklySalary).toBe(100);
  });

  it("re-signs a wrestler who outgrew their salary at the curve expectation", () => {
    const records = roster();
    const campaign = makeCampaign(1991, {
      contracts: [{ wrestlerId: records[1].id, weeklySalary: 300, termWeeks: 1 }],
      renewalStrategy: "curve-fair",
    });
    campaign.finance!.popularity[records[1].id] = 90; // expectation 550; $300 grades low
    const advanced = advanceCampaignDays(campaign, 8);
    const renewal = advanced.negotiation!.offers.at(-1)!;
    expect(renewal.reason).toBe("renewal");
    expect(renewal.status).toBe("accepted");
    expect(renewal.weeklySalary).toBe(550);
    expect(renewal.expectedSalary).toBe(550);
    expect(renewal.basis).toContain("Fair offer: $550/week meets the $550 expectation");
    expect(advanced.events.at(-1)!.dice).toHaveLength(0);
    // The renewed contract restarts at the curve rate on the first inactive day.
    expect(advanced.finance!.contracts[records[1].id]).toMatchObject({ weeklySalary: 550, startDate: "1991-01-09" });
    // The M12-ADJ-09 AI-action line is recorded in the event detail.
    expect(advanced.events.at(-1)!.detail.join(" ")).toContain("campaign AI matched the $550 salary-curve expectation");
    // Payroll continues at the new rate: week-1 payout at the old $300, then
    // the renewed week pays the curve $550 (cumulative ledger 850).
    const later = advanceCampaignDays(advanced, 7);
    expect(later.finance!.ledgers[records[1].id]).toBe(850);
    expect(later.finance!.payouts.at(-1)!.total).toBe(550);
  });

  it("bumps short offers to fair instead of rolling, consuming zero dice", () => {
    // Popularity 30 → expectation 250; $200 is 80% (short). The pre-amendment
    // seed-1991 renewal rolls D20 11 and rejects; the AI bump lands on fair and
    // needs no roll, so the D20 sequence is untouched.
    const records = roster();
    const campaign = makeCampaign(1991, {
      contracts: [{ wrestlerId: records[1].id, weeklySalary: 200, termWeeks: 1 }],
      renewalStrategy: "curve-fair",
    });
    campaign.finance!.popularity[records[1].id] = 30;
    const advanced = advanceCampaignDays(campaign, 8);
    const renewal = advanced.negotiation!.offers.at(-1)!;
    expect(renewal.status).toBe("accepted");
    expect(renewal.weeklySalary).toBe(250);
    expect(advanced.events.at(-1)!.dice).toHaveLength(0);
    // The next short offer on another wrestler consumes the first negotiation
    // D20 — seed 1991 rolls 11, exactly as if the renewal had never rolled.
    const records2 = roster();
    const second = makeCampaign(1991, {
      contracts: [{ wrestlerId: records2[1].id, weeklySalary: 200, termWeeks: 1 }],
      renewalStrategy: "curve-fair",
    });
    second.finance!.popularity[records2[1].id] = 30;
    const advanced2 = advanceCampaignDays(second, 8);
    expect(advanced2.events.at(-1)!.dice).toHaveLength(0);
    const manual = structuredClone(advanced2);
    manual.finance!.popularity[records2[2].id] = 30;
    const manual2 = offerContract(manual, records2[2].id, { weeklySalary: 200, termWeeks: 4 });
    const offer = manual2.negotiation!.offers.at(-1)!;
    expect(offer.status).toBe("rejected");
    expect(offer.basis).toContain("D20 11 > 10 rejected");
    expect(manual2.events.at(-1)!.dice).toHaveLength(1);
  });

  it("leaves already-fair expiring salaries offered unchanged", () => {
    const records = roster();
    const campaign = makeCampaign(1991, {
      contracts: [{ wrestlerId: records[1].id, weeklySalary: 100, termWeeks: 1 }],
      renewalStrategy: "curve-fair",
    });
    campaign.finance!.popularity[records[1].id] = 0; // expectation 100 = expiring salary → already fair
    const advanced = advanceCampaignDays(campaign, 8);
    const renewal = advanced.negotiation!.offers.at(-1)!;
    expect(renewal.status).toBe("accepted");
    expect(renewal.weeklySalary).toBe(100);
    expect(renewal.basis).toContain("Fair offer: $100/week meets the $100 expectation");
    expect(advanced.events.at(-1)!.dice).toHaveLength(0);
    expect(advanced.events.at(-1)!.detail.join(" ")).not.toContain("M12-ADJ-09");
  });

  it("rejects curve-fair at creation without the negotiation extension", () => {
    const records = roster();
    expect(() =>
      createCampaign({
        name: "No Negotiation",
        seed: 1991,
        startDate: "1991-01-01",
        roster: records,
        playerEntrantId: records[0].id,
        playerDivision: "singles",
        financePolicy: "contracts",
        renewalStrategy: "curve-fair",
      })
    ).toThrow(/contract-negotiation extension/);
    expect(() => makeCampaign(1991, { renewalStrategy: "hyper-aggressive" })).toThrow(/renewal strategy/);
  });

  it("rejects tampered renewal strategy state", () => {
    const records = roster();
    const campaign = makeCampaign(1991, {
      contracts: [{ wrestlerId: records[1].id, weeklySalary: 300, termWeeks: 1 }],
      renewalStrategy: "curve-fair",
    });
    expect(campaign.renewalStrategy).toBe("curve-fair");
    const orphaned = structuredClone(campaign);
    orphaned.negotiationPolicy = undefined;
    orphaned.negotiationVersion = undefined;
    orphaned.negotiation = undefined;
    expect(validateCampaignState(orphaned).some((line) => line.includes("renewalStrategy: present without the offers"))).toBe(true);
    const invalid = structuredClone(campaign);
    (invalid as { renewalStrategy: string }).renewalStrategy = "hyper-aggressive";
    expect(validateCampaignState(invalid).some((line) => line.includes("renewalStrategy: invalid value"))).toBe(true);
  });

  it("round-trips a curve-fair campaign byte-identically", () => {
    const records = roster();
    const campaign = makeCampaign(2000, {
      contracts: [{ wrestlerId: records[1].id, weeklySalary: 300, termWeeks: 1 }],
      renewalStrategy: "curve-fair",
    });
    campaign.finance!.popularity[records[1].id] = 90;
    const advanced = advanceCampaignDays(campaign, 8);
    expect(verifyCampaignRoundTrip(advanced).valid).toBe(true);
    const imported = importCampaignJson(serializeCampaign(advanced)).state;
    expect(hashCampaignState(imported)).toBe(hashCampaignState(advanced));
    expect(imported.renewalStrategy).toBe("curve-fair");
    expect(imported.negotiation).toEqual(advanced.negotiation);
  });
});
