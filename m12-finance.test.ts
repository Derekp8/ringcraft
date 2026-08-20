import { describe, expect, it } from "vitest";
import {
  CHEMISTRY_RATING_BONUS,
  FINANCE_POLICY_VERSION,
  FINANCE_TABLE_HASH,
  PAYOUT_SCHEDULE,
  POPULARITY_MOVEMENT_TABLE,
  TITLE_SHOT_POPULARITY_RULES,
  advanceCampaignDays,
  campaignSummary,
  chemistryTagRatingBonus,
  contractActiveOn,
  createCampaign,
  hashCampaignState,
  importCampaignJson,
  popularityDelta,
  resolveScheduledMatchHeadless,
  rollTitleShot,
  scheduleCampaignMatch,
  serializeCampaign,
  signContract,
  suggestPlayerMatch,
  titleShotPopularityHeat,
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
  return createCampaign({
    name: "M12 Finance",
    seed,
    startDate: "1991-01-01",
    roster: roster(),
    playerEntrantId: roster()[0].id,
    playerDivision: "singles",
    financePolicy: "contracts",
    ...extra,
  });
}

describe("M12 contracts-and-finance rules data", () => {
  it("pins the policy version and table hash", () => {
    expect(FINANCE_POLICY_VERSION).toBe("classic-1991-contracts-finance-v1");
    expect(typeof FINANCE_TABLE_HASH).toBe("string");
    expect(PAYOUT_SCHEDULE.cadenceDays).toBe(7);
    expect(POPULARITY_MOVEMENT_TABLE.scale).toEqual({ floor: 0, ceiling: 100 });
    expect(POPULARITY_MOVEMENT_TABLE.clean).toEqual({ win: 3, loss: -2 });
    expect(POPULARITY_MOVEMENT_TABLE.dqCountout).toEqual({ win: 1, loss: -1 });
    expect(POPULARITY_MOVEMENT_TABLE.draw).toBe(0);
    expect(POPULARITY_MOVEMENT_TABLE.titleMatchWinnerBonus).toBe(1);
    expect(POPULARITY_MOVEMENT_TABLE.chemistryTagWinBonus).toBe(1);
  });

  it("maps result outcomes to popularity deltas with title and chemistry bonuses", () => {
    expect(popularityDelta(true, "pin", false, false)).toBe(3);
    expect(popularityDelta(true, "submission", false, false)).toBe(3);
    expect(popularityDelta(true, "escape", false, false)).toBe(3);
    expect(popularityDelta(true, "retrieval", false, false)).toBe(3);
    expect(popularityDelta(true, "disqualification", false, false)).toBe(1);
    expect(popularityDelta(true, "countout", false, false)).toBe(1);
    expect(popularityDelta(false, "pin", false, false)).toBe(-2);
    expect(popularityDelta(false, "disqualification", false, false)).toBe(-1);
    expect(popularityDelta(null, "time-limit-draw", false, false)).toBe(0);
    expect(popularityDelta(null, "disqualification", false, false)).toBe(0); // double-DQ: no winner
    expect(popularityDelta(true, "pin", true, false)).toBe(4);
    expect(popularityDelta(true, "pin", false, true)).toBe(4);
    expect(popularityDelta(true, "pin", true, true)).toBe(5);
  });

  it("keeps a contract active for exactly its termWeeks of payouts", () => {
    const contract = { startDate: "1991-01-01", termWeeks: 2 };
    expect(contractActiveOn(contract, "1991-01-01")).toBe(true);
    expect(contractActiveOn(contract, "1991-01-08")).toBe(true);
    expect(contractActiveOn(contract, "1991-01-14")).toBe(true);
    expect(contractActiveOn(contract, "1991-01-15")).toBe(true); // day termWeeks*7 is the last covered day
    expect(contractActiveOn(contract, "1991-01-16")).toBe(false);
    expect(() => contractActiveOn({ startDate: "1991-01-01", termWeeks: 0 }, "1991-01-01")).toThrow(/term/i);
  });
});

describe("M12 campaign integration", () => {
  it("leaves default campaigns untouched and hash-compatible", () => {
    const plain = createCampaign({
      name: "Plain",
      seed: 1991,
      startDate: "1991-01-01",
      roster: roster(),
      playerEntrantId: roster()[0].id,
      playerDivision: "singles",
    });
    expect(plain.financePolicy).toBeUndefined();
    expect(plain.financeVersion).toBeUndefined();
    expect(plain.finance).toBeUndefined();
    expect(validateCampaignSave(plain)).toEqual([]);
    const summary = campaignSummary(plain);
    expect(summary).not.toHaveProperty("financePayouts");
    expect(verifyCampaignRoundTrip(plain).valid).toBe(true);
  });

  it("pins the policy and ledger on enabled campaigns", () => {
    const campaign = makeCampaign(1991);
    expect(campaign.financePolicy).toBe("contracts");
    expect(campaign.financeVersion).toBe(FINANCE_POLICY_VERSION);
    expect(campaign.finance?.policyVersion).toBe(FINANCE_POLICY_VERSION);
    expect(campaign.finance?.nextPayoutDate).toBe("1991-01-08");
    expect(campaign.finance?.popularity).toEqual(
      Object.fromEntries(Object.keys(campaign.roster).map((id) => [id, 50])),
    );
    expect(campaign.finance?.payouts).toEqual([]);
    expect(campaign.finance?.popularityHistory).toEqual([]);
  });

  it("pays signing bonuses at creation and weekly salaries on the 7-day cadence until expiry", () => {
    const records = roster();
    const campaign = makeCampaign(1991, {
      contracts: [
        { wrestlerId: records[0].id, weeklySalary: 100, termWeeks: 2, signingBonus: 50 },
        { wrestlerId: records[1].id, weeklySalary: 75, termWeeks: 3 },
      ],
    });
    const finance = campaign.finance!;
    expect(finance.ledgers[records[0].id]).toBe(50);
    expect(finance.ledgers[records[1].id]).toBeUndefined();
    expect(finance.payouts).toHaveLength(1);
    expect(finance.payouts[0]).toMatchObject({ date: "1991-01-01", weekIndex: 0, total: 50 });

    const week1 = advanceCampaignDays(campaign, 7);
    expect(week1.currentDate).toBe("1991-01-08");
    expect(week1.finance!.payouts).toHaveLength(2);
    expect(week1.finance!.payouts[1]).toMatchObject({ date: "1991-01-08", weekIndex: 1, total: 175 });
    expect(week1.finance!.ledgers[records[0].id]).toBe(150);
    expect(week1.finance!.ledgers[records[1].id]).toBe(75);

    const week2 = advanceCampaignDays(week1, 7);
    expect(week2.finance!.payouts).toHaveLength(3);
    expect(week2.finance!.payouts[2]).toMatchObject({ date: "1991-01-15", weekIndex: 2, total: 175 });
    expect(week2.finance!.ledgers[records[0].id]).toBe(250);
    expect(week2.finance!.ledgers[records[1].id]).toBe(150);

    // Week 3: the 2-week contract has expired; only the 3-week contract pays.
    const week3 = advanceCampaignDays(week2, 7);
    expect(week3.finance!.payouts).toHaveLength(4);
    expect(week3.finance!.payouts[3]).toMatchObject({ date: "1991-01-22", weekIndex: 3, total: 75 });
    expect(week3.finance!.ledgers[records[0].id]).toBe(250);
    expect(week3.finance!.ledgers[records[1].id]).toBe(225);

    // Week 4: no active contracts; no payout record is created.
    const week4 = advanceCampaignDays(week3, 7);
    expect(week4.finance!.payouts).toHaveLength(4);
    expect(week4.finance!.ledgers[records[1].id]).toBe(225);
  });

  it("signs mid-career contracts with an immediate signing bonus", () => {
    const records = roster();
    const campaign = makeCampaign(1991);
    const signed = signContract(campaign, records[2].id, { weeklySalary: 120, termWeeks: 4, signingBonus: 100 });
    expect(signed.finance!.contracts[records[2].id]).toMatchObject({ weeklySalary: 120, termWeeks: 4, signingBonus: 100 });
    expect(signed.finance!.ledgers[records[2].id]).toBe(100);
    expect(signed.events.at(-1)?.type).toBe("sign-contract");
    expect(() => signContract(campaign, "nope", { weeklySalary: 1, termWeeks: 1 })).toThrow(/Unknown campaign wrestler/);
    expect(() => signContract(campaign, records[2].id, { weeklySalary: 0, termWeeks: 1 })).toThrow(/salary/i);
    expect(() => signContract(campaign, records[2].id, { weeklySalary: 1, termWeeks: 0 })).toThrow(/term/i);
    expect(() => signContract(campaign, records[2].id, { weeklySalary: 1, termWeeks: 1, signingBonus: -1 })).toThrow(/bonus/i);
    expect(() => signContract(signed, records[2].id, { weeklySalary: 1, termWeeks: 1 })).toThrow(/already has a contract/);
    const plain = createCampaign({
      name: "Plain", seed: 1991, startDate: "1991-01-01", roster: records,
      playerEntrantId: records[0].id, playerDivision: "singles",
    });
    expect(() => signContract(plain, records[0].id, { weeklySalary: 1, termWeeks: 1 })).toThrow(/extension/);
  });

  it("moves popularity by the pinned seed-2000 singles outcome", () => {
    const records = roster();
    const campaign = makeCampaign(2000);
    const scheduled = scheduleCampaignMatch(campaign, { date: campaign.currentDate, entrantIds: [records[0].id, records[1].id], timeLimitMinutes: 6 });
    const resolved = resolveScheduledMatchHeadless(scheduled, scheduled.schedule[0].id);
    const result = resolved.schedule[0].result!;
    expect(result.method).toBe("pin");
    expect(result.winnerEntrantId).toBe(records[0].id);
    const history = resolved.finance!.popularityHistory;
    expect(history).toHaveLength(2);
    const winnerMove = history.find((row) => row.wrestlerId === records[0].id)!;
    const loserMove = history.find((row) => row.wrestlerId === records[1].id)!;
    expect(winnerMove).toMatchObject({ delta: 3, from: 50, to: 53, reason: "win" });
    expect(loserMove).toMatchObject({ delta: -2, from: 50, to: 48, reason: "loss" });
    expect(resolved.finance!.popularity[records[0].id]).toBe(53);
    expect(resolved.finance!.popularity[records[1].id]).toBe(48);
    const commit = resolved.events.find((row) => row.type === "commit-match-result");
    expect(commit?.detail.some((line) => line.includes("popularity"))).toBe(true);
  });

  it("awards the title-match winner bonus on the pinned seed-7 television match", () => {
    const records = roster();
    const campaign = makeCampaign(7);
    const holder = campaign.titles.television.holderId!;
    const challenger = Object.keys(campaign.roster).find((id) => id !== holder)!;
    const scheduled = scheduleCampaignMatch(campaign, { date: campaign.currentDate, entrantIds: [challenger, holder], timeLimitMinutes: 6, titleId: "television" });
    const resolved = resolveScheduledMatchHeadless(scheduled, scheduled.schedule[0].id);
    const result = resolved.schedule[0].result!;
    expect(result.method).toBe("pin");
    const winnerMove = resolved.finance!.popularityHistory.find((row) => row.wrestlerId === result.winnerEntrantId)!;
    expect(winnerMove).toMatchObject({ delta: 4, reason: "title-match" });
    expect(resolved.titles.television.holderId).toBe(result.winnerEntrantId);
  });

  it("gives chemistry pairs the tag-win bonus on the pinned seed-1991 tag match", () => {
    const records = roster(4);
    const teams = [
      { id: "t1", name: "Team One", memberIds: [records[0].id, records[1].id] as [string, string], side: records[0].side },
      { id: "t2", name: "Team Two", memberIds: [records[2].id, records[3].id] as [string, string], side: records[2].side },
    ];
    const campaign = createCampaign({
      name: "M12 Chemistry",
      seed: 1991,
      startDate: "1991-01-01",
      roster: records,
      teams,
      playerEntrantId: "t1",
      playerDivision: "tag",
      financePolicy: "contracts",
      chemistry: [{ memberIds: [records[2].id, records[3].id], label: "Red-hot duo" }],
    });
    const scheduled = scheduleCampaignMatch(campaign, { date: campaign.currentDate, entrantIds: ["t1", "t2"], timeLimitMinutes: 6 });
    const resolved = resolveScheduledMatchHeadless(scheduled, scheduled.schedule[0].id);
    const result = resolved.schedule[0].result!;
    expect(result.method).toBe("pin");
    expect(result.winnerEntrantId).toBe("t2");
    const history = resolved.finance!.popularityHistory;
    for (const memberId of [records[2].id, records[3].id]) {
      const move = history.find((row) => row.wrestlerId === memberId)!;
      expect(move).toMatchObject({ delta: 4, reason: "chemistry-tag-win" });
    }
    // The non-chemistry losing team gets plain losses.
    for (const memberId of [records[0].id, records[1].id]) {
      expect(history.find((row) => row.wrestlerId === memberId)).toMatchObject({ delta: -2, reason: "loss" });
    }
  });

  it("is fully deterministic across identical seeds", () => {
    const resolveSeeded = (seed: number): CampaignState => {
      const campaign = makeCampaign(seed);
      const records = Object.values(campaign.roster);
      const scheduled = scheduleCampaignMatch(campaign, { date: campaign.currentDate, entrantIds: [records[0].id, records[1].id], timeLimitMinutes: 6 });
      return resolveScheduledMatchHeadless(scheduled, scheduled.schedule[0].id);
    };
    const first = resolveSeeded(2000);
    const second = resolveSeeded(2000);
    expect(hashCampaignState(first)).toBe(hashCampaignState(second));
    expect(first.finance!.popularityHistory).toEqual(second.finance!.popularityHistory);
    expect(advanceCampaignDays(makeCampaign(7), 21).finance!.payouts).toEqual(advanceCampaignDays(makeCampaign(7), 21).finance!.payouts);
  });

  it("round-trips through serialization byte-identically", () => {
    const campaign = advanceCampaignDays(makeCampaign(7), 14);
    expect(verifyCampaignRoundTrip(campaign).valid).toBe(true);
    const imported = importCampaignJson(serializeCampaign(campaign)).state;
    expect(hashCampaignState(imported)).toBe(hashCampaignState(campaign));
    expect(imported.finance).toEqual(campaign.finance);
  });

  it("rejects tampered finance state", () => {
    const campaign = makeCampaign(1991);
    const badPopularity = structuredClone(campaign);
    badPopularity.finance!.popularity[Object.keys(badPopularity.roster)[0]] = 101;
    expect(validateCampaignState(badPopularity).some((line) => line.includes("finance.popularity"))).toBe(true);
    const badVersion = structuredClone(campaign);
    badVersion.financeVersion = "wrong";
    expect(validateCampaignState(badVersion).some((line) => line.includes("financeVersion"))).toBe(true);
    const orphanLedger = structuredClone(campaign);
    orphanLedger.financePolicy = undefined;
    orphanLedger.financeVersion = undefined;
    expect(validateCampaignState(orphanLedger).some((line) => line.includes("finance: ledger present"))).toBe(true);
    const missingLedger = structuredClone(campaign);
    missingLedger.finance = undefined;
    expect(validateCampaignState(missingLedger).some((line) => line.includes("requires the finance ledger"))).toBe(true);
  });

  it("surfaces finance counters in the campaign summary when enabled", () => {
    const records = roster();
    const campaign = makeCampaign(1991, { contracts: [{ wrestlerId: records[0].id, weeklySalary: 100, termWeeks: 4 }] });
    const summary = campaignSummary(advanceCampaignDays(campaign, 7));
    expect(summary.financePayouts).toBe(1);
    expect(summary.financeLedgerTotal).toBe(100);
    expect(summary.financePopularity).toBe(50);
  });
});

describe("M12-ADJ-04 popularity gates the marquee", () => {
  it("pins the adjudicated overness rules table and the heat function", () => {
    expect(TITLE_SHOT_POPULARITY_RULES.version).toBe("m12-adjudicated-overness-v1");
    expect(TITLE_SHOT_POPULARITY_RULES.eligibilityFloor).toBe(40);
    expect(TITLE_SHOT_POPULARITY_RULES.heatStep).toBe(10);
    expect(TITLE_SHOT_POPULARITY_RULES.heatBonusPerStep).toBe(1);
    expect(TITLE_SHOT_POPULARITY_RULES.source).toContain("M12-ADJ-04");
    expect(titleShotPopularityHeat(50)).toBe(0);
    expect(titleShotPopularityHeat(59)).toBe(0);
    expect(titleShotPopularityHeat(60)).toBe(1);
    expect(titleShotPopularityHeat(90)).toBe(4);
    expect(titleShotPopularityHeat(100)).toBe(5);
    expect(titleShotPopularityHeat(40)).toBe(-1);
    expect(titleShotPopularityHeat(30)).toBe(-2);
    expect(titleShotPopularityHeat(0)).toBe(-5);
  });

  it("excludes candidates below the popularity floor from title-shot traversals", () => {
    const campaign = makeCampaign(1991);
    const entries = campaign.rankings.singles.entries;
    const top = entries.find((row) => row.entrantId !== campaign.titles["world-heavyweight"].holderId)!;
    // Only the top-ranked non-champion stays over the floor; the champion never
    // defends against a cold wrestler under M12-ADJ-04.
    const tweaked = structuredClone(campaign);
    for (const id of Object.keys(tweaked.roster)) if (id !== top.entrantId) tweaked.finance!.popularity[id] = 25;
    tweaked.finance!.popularity[top.entrantId] = 90;
    const rolled = rollTitleShot(tweaked, "world-heavyweight");
    const offer = rolled.titleShotOffers.at(-1);
    // The sole eligible candidate always converts: raw roll >= 1, heat +4, rank <= 2.
    expect(offer?.candidateId).toBe(top.entrantId);
    expect(offer?.modifiers.some((row) => row.label.includes("popularity heat") && row.amount === 4)).toBe(true);
    // A completely cold roster leaves no eligible candidates and the traversal fails loudly.
    const cold = structuredClone(campaign);
    for (const id of Object.keys(cold.roster)) cold.finance!.popularity[id] = 25;
    expect(() => rollTitleShot(cold, "world-heavyweight")).toThrow(/popularity floor/);
  });

  it("leaves non-finance campaigns ungated and unchanged", () => {
    const records = roster();
    const plain = createCampaign({
      name: "Plain",
      seed: 1991,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: records[0].id,
      playerDivision: "singles",
    });
    // No finance means no floor: the traversal always has eligible candidates and
    // the shot offer carries no popularity-heat term.
    const rolled = rollTitleShot(plain, "world-heavyweight");
    const offer = rolled.titleShotOffers.at(-1);
    expect(offer?.modifiers.some((row) => row.label.includes("popularity heat"))).toBe(false);
    expect(rolled.finance).toBeUndefined();
  });

  it("weights optional-match bookings toward the most popular available opponent", () => {
    const records = roster();
    const player = records[0].id;
    const plain = createCampaign({
      name: "Plain",
      seed: 1991,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: player,
      playerDivision: "singles",
    });
    const candidates = plain.rankings.singles.entries.map((row) => row.entrantId).filter((id) => id !== player);
    // Finance off and finance-on with flat popularity both keep rank order.
    expect(suggestPlayerMatch(plain).entrantIds[1]).toBe(candidates[0]);
    expect(suggestPlayerMatch(makeCampaign(1991)).entrantIds[1]).toBe(candidates[0]);
    // With the extension on, a hotter low-ranked candidate is booked over the field.
    const tweaked = makeCampaign(1991);
    const hot = candidates[candidates.length - 1];
    for (const id of candidates) tweaked.finance!.popularity[id] = 40;
    tweaked.finance!.popularity[hot] = 90;
    expect(suggestPlayerMatch(tweaked).entrantIds[1]).toBe(hot);
  });
});

describe("M12-ADJ-05 chemistry rating bonus", () => {
  function makeTagCampaign(seed = 1991, withChemistry = true): CampaignState {
    const records = roster(4);
    const teams = [
      { id: "t1", name: "Team One", memberIds: [records[0].id, records[1].id] as [string, string], side: records[0].side },
      { id: "t2", name: "Team Two", memberIds: [records[2].id, records[3].id] as [string, string], side: records[2].side },
    ];
    return createCampaign({
      name: "M12 Chemistry Rating",
      seed,
      startDate: "1991-01-01",
      roster: records,
      teams,
      playerEntrantId: "t2",
      playerDivision: "tag",
      financePolicy: "contracts",
      // The chemistry pair is the ranked non-champion team t2; t1 holds the
      // world-tag title (champions sit unranked and get stripped after 30 days
      // without a defense, so its totals stay baseline).
      chemistry: withChemistry ? [{ memberIds: [records[2].id, records[3].id], label: "Red-hot duo" }] : [],
    });
  }

  it("pins the M12-ADJ-05 rules table and helper", () => {
    expect(CHEMISTRY_RATING_BONUS.version).toBe("m12-adjudicated-chemistry-rating-v1");
    expect(CHEMISTRY_RATING_BONUS.tagRatedBonus).toBe(2);
    expect(CHEMISTRY_RATING_BONUS.source).toContain("M12-ADJ-05");
    expect(chemistryTagRatingBonus(false, true)).toBe(0);
    expect(chemistryTagRatingBonus(true, false)).toBe(0);
    expect(chemistryTagRatingBonus(true, true)).toBe(2);
  });

  it("grants chemistry-pair tag teams a flat monthly rating bonus at month end", () => {
    const advanced = advanceCampaignDays(makeTagCampaign(1991), 31);
    expect(advanced.currentDate).toBe("1991-02-01");
    const tagRows = advanced.rankings.tag.entries;
    const t1 = tagRows.find((row) => row.entrantId === "t1")!;
    const t2 = tagRows.find((row) => row.entrantId === "t2")!;
    // No matches were played. The chemistry team t2 finalizes at prior-rank
    // bonus (3, ranked #1) + the +2 chemistry bonus; the non-pair champion t1
    // sits unranked and was stripped mid-month, so it stays at baseline 0.
    expect(t2.totalPoints).toBe(t2.matchPoints + t2.priorRankBonus + CHEMISTRY_RATING_BONUS.tagRatedBonus);
    expect(t1.totalPoints).toBe(t1.matchPoints + t1.priorRankBonus);
    expect(t2.totalPoints).toBeGreaterThan(t1.totalPoints);
    // The bonus is recorded in the month-end event detail.
    const monthEnd = advanced.events.find((row) => row.detail.some((line) => line.includes("chemistry pair tag rating bonus")));
    expect(monthEnd?.detail.some((line) => line.includes("t2: chemistry pair tag rating bonus +2 RP for the month"))).toBe(true);
    expect(advanced.finance).toBeDefined();
  });

  it("leaves non-finance tag campaigns unbonused", () => {
    const records = roster(4);
    const teams = [
      { id: "t1", name: "Team One", memberIds: [records[0].id, records[1].id] as [string, string], side: records[0].side },
      { id: "t2", name: "Team Two", memberIds: [records[2].id, records[3].id] as [string, string], side: records[2].side },
    ];
    const plain = createCampaign({
      name: "Plain",
      seed: 1991,
      startDate: "1991-01-01",
      roster: records,
      teams,
      playerEntrantId: "t1",
      playerDivision: "tag",
    });
    const advanced = advanceCampaignDays(plain, 31);
    for (const row of advanced.rankings.tag.entries) {
      expect(row.totalPoints).toBe(row.matchPoints + row.priorRankBonus);
    }
    expect(advanced.events.some((row) => row.detail.some((line) => line.includes("chemistry pair tag rating bonus")))).toBe(false);
    expect(advanced.finance).toBeUndefined();
  });

  it("pins the month-end hash for a seeded chemistry tag campaign", () => {
    const first = advanceCampaignDays(makeTagCampaign(1991), 31);
    const second = advanceCampaignDays(makeTagCampaign(1991), 31);
    expect(hashCampaignState(first)).toBe(hashCampaignState(second));
    expect(hashCampaignState(first)).toBe("c14n-fnv1a64-v1:d3ee0a00711f495f");
  });
});
