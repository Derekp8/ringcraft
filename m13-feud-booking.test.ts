import { describe, expect, it } from "vitest";
import {
  BOOKING_POLICY_VERSION,
  BOOKING_TABLE_HASH,
  FEUD_DECAY_TABLE,
  FEUD_HEAT_TABLE,
  FEUD_TITLE_SHOT_TERM,
  advanceCampaignDays,
  campaignSummary,
  createCampaign,
  feudHeatDelta,
  feudTitleShotTerm,
  grantExtraTitleShot,
  hashCampaignState,
  importCampaignJson,
  resolveScheduledMatchHeadless,
  respondToTitleShot,
  rollTitleShot,
  scheduleCampaignMatch,
  serializeCampaign,
  startFeud,
  suggestPlayerMatch,
  titleShotExtraGrantLine,
  titleShotGrantLine,
  titleShotRollLine,
  validateCampaignSave,
  validateCampaignState,
  verifyCampaignRoundTrip,
} from "../src/core";
import type { CampaignState } from "../src/core";
import { makeUnderdogRecord } from "../scripts/m11-playtest-batch";

function roster(count = 4, seedBase = 300): ReturnType<typeof makeUnderdogRecord>[] {
  return Array.from({ length: count }, (_, index) => makeUnderdogRecord(seedBase + index, index));
}

/** A booking-enabled singles campaign; the player is records[0] and feuds with records[1] by default. */
function makeCampaign(seed = 1991, extra: Record<string, unknown> = {}): CampaignState {
  const records = roster();
  return createCampaign({
    name: "M13 Feuds",
    seed,
    startDate: "1991-01-01",
    roster: records,
    playerEntrantId: records[0].id,
    playerDivision: "singles",
    bookingPolicy: "feuds",
    feuds: [{ entrantIds: [records[0].id, records[1].id], label: "red-hot grudge" }],
    ...extra,
  });
}

/** A booking campaign where the player holds no title, so optional-booking preferences are observable. */
function nonChampionCampaign(seed = 1991, feuds: Array<{ entrantIds: [string, string]; label: string; initialHeat?: number }>): CampaignState {
  const records = roster();
  return createCampaign({
    name: "M13 No Title",
    seed,
    startDate: "1991-01-01",
    roster: records,
    playerEntrantId: records[0].id,
    playerDivision: "singles",
    champions: { "world-heavyweight": records[3].id },
    bookingPolicy: "feuds",
    feuds,
  });
}

describe("M13 feud-and-title-booking rules data", () => {
  it("pins the policy version, table hash, and rules tables", () => {
    expect(BOOKING_POLICY_VERSION).toBe("classic-1991-feud-booking-v1");
    expect(typeof BOOKING_TABLE_HASH).toBe("string");
    expect(FEUD_HEAT_TABLE.scale).toEqual({ floor: 0, ceiling: 100 });
    expect(FEUD_HEAT_TABLE.clean).toEqual({ win: 3 });
    expect(FEUD_HEAT_TABLE.dqCountoutWin).toBe(5);
    expect(FEUD_HEAT_TABLE.loss).toBe(2);
    expect(FEUD_HEAT_TABLE.draw).toBe(4);
    expect(FEUD_HEAT_TABLE.titleMatchBonus).toBe(1);
    expect(FEUD_DECAY_TABLE.monthlyDecay).toBe(5);
    expect(FEUD_DECAY_TABLE.coolingThreshold).toBe(20);
    expect(FEUD_TITLE_SHOT_TERM).toMatchObject({ step: 20, bonus: 1 });
    expect(FEUD_HEAT_TABLE.source).toContain("M13-ADJ-01");
    expect(FEUD_DECAY_TABLE.source).toContain("M13-ADJ-01");
    expect(FEUD_TITLE_SHOT_TERM.source).toContain("M13-ADJ-03");
  });

  it("maps result outcomes to feud heat deltas with the title-match bonus", () => {
    expect(feudHeatDelta(true, "pin", false)).toBe(3);
    expect(feudHeatDelta(true, "submission", false)).toBe(3);
    expect(feudHeatDelta(true, "escape", false)).toBe(3);
    expect(feudHeatDelta(true, "retrieval", false)).toBe(3);
    expect(feudHeatDelta(true, "disqualification", false)).toBe(5);
    expect(feudHeatDelta(true, "countout", false)).toBe(5);
    expect(feudHeatDelta(false, "pin", false)).toBe(2);
    expect(feudHeatDelta(false, "disqualification", false)).toBe(2);
    expect(feudHeatDelta(null, "time-limit-draw", false)).toBe(4);
    expect(feudHeatDelta(null, "disqualification", false)).toBe(4); // double-DQ: no winner
    expect(feudHeatDelta(true, "pin", true)).toBe(4);
    expect(feudHeatDelta(false, "pin", true)).toBe(3);
  });

  it("grades the feud title-shot term by 20-point heat steps", () => {
    expect(feudTitleShotTerm(0)).toBe(0);
    expect(feudTitleShotTerm(19)).toBe(0);
    expect(feudTitleShotTerm(20)).toBe(1);
    expect(feudTitleShotTerm(39)).toBe(1);
    expect(feudTitleShotTerm(60)).toBe(3);
    expect(feudTitleShotTerm(100)).toBe(5);
  });
});

describe("M13 campaign integration", () => {
  it("leaves default campaigns untouched and hash-compatible", () => {
    const records = roster();
    const plain = createCampaign({
      name: "Plain",
      seed: 1991,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: records[0].id,
      playerDivision: "singles",
    });
    expect(plain.bookingPolicy).toBeUndefined();
    expect(plain.bookingVersion).toBeUndefined();
    expect(plain.booking).toBeUndefined();
    expect(validateCampaignSave(plain)).toEqual([]);
    const summary = campaignSummary(plain);
    expect(summary).not.toHaveProperty("feudCount");
    expect(verifyCampaignRoundTrip(plain).valid).toBe(true);
  });

  it("pins the policy and feud ledger on enabled campaigns", () => {
    const records = roster();
    const campaign = makeCampaign(1991);
    expect(campaign.bookingPolicy).toBe("feuds");
    expect(campaign.bookingVersion).toBe(BOOKING_POLICY_VERSION);
    expect(campaign.booking?.policyVersion).toBe(BOOKING_POLICY_VERSION);
    expect(campaign.booking?.feuds).toHaveLength(1);
    const feud = campaign.booking!.feuds[0];
    expect(feud.entrantIds).toEqual([records[0].id, records[1].id]);
    expect(feud.label).toBe("red-hot grudge");
    expect(feud.heat).toBe(50);
    expect(feud.status).toBe("active");
    expect(feud.startedAt).toBe("1991-01-01");
    expect(feud.lastMatchDate).toBeNull();
    expect(feud.matchCount).toBe(0);
    expect(campaign.booking?.feudHistory).toEqual([]);
    expect(campaign.booking?.monthSuggestions).toEqual([]);
    expect(feud.id).toMatch(/^feud-/);
  });

  it("moves feud heat from the pinned seed-2000 singles outcome", () => {
    const records = roster();
    const campaign = makeCampaign(2000);
    const feud = campaign.booking!.feuds[0];
    const scheduled = scheduleCampaignMatch(campaign, { date: campaign.currentDate, entrantIds: [records[0].id, records[1].id], timeLimitMinutes: 6 });
    const resolved = resolveScheduledMatchHeadless(scheduled, scheduled.schedule[0].id);
    const result = resolved.schedule[0].result!;
    expect(result.method).toBe("pin");
    expect(result.winnerEntrantId).toBe(records[0].id);
    const after = resolved.booking!.feuds[0];
    expect(after.heat).toBe(53);
    expect(after.status).toBe("active");
    expect(after.matchCount).toBe(1);
    expect(after.lastMatchDate).toBe(resolved.currentDate);
    const movement = resolved.booking!.feudHistory[0];
    expect(movement).toMatchObject({ delta: 3, from: 50, to: 53, reason: "win", feudId: feud.id, matchId: resolved.schedule[0].id });
    expect(resolved.events.find((row) => row.type === "commit-match-result")?.detail.some((line) => line.includes("Feud red-hot grudge"))).toBe(true);
  });

  it("adds the title-match bonus to heat on the pinned seed-7 television match", () => {
    const records = roster();
    const campaign = makeCampaign(7);
    const holder = campaign.titles.television.holderId!;
    const challenger = Object.keys(campaign.roster).find((id) => id !== holder)!;
    // Overwrite the configured feud with the title-match pair.
    const withFeud = structuredClone(campaign);
    withFeud.booking!.feuds = [{ ...campaign.booking!.feuds[0], id: "feud-title-pair", entrantIds: [challenger, holder] }];
    const scheduled = scheduleCampaignMatch(withFeud, { date: withFeud.currentDate, entrantIds: [challenger, holder], timeLimitMinutes: 6, titleId: "television" });
    const resolved = resolveScheduledMatchHeadless(scheduled, scheduled.schedule[0].id);
    const result = resolved.schedule[0].result!;
    expect(result.method).toBe("pin");
    const feud = resolved.booking!.feuds[0];
    const wonA = result.winnerEntrantId === challenger;
    expect(feud.heat).toBe(50 + feudHeatDelta(wonA, result.method, true));
    expect(resolved.booking!.feudHistory[0].reason).toBe(wonA ? "win" : "loss");
    expect(resolved.booking!.feudHistory[0].delta).toBe(feudHeatDelta(wonA, result.method, true));
  });

  it("decays cold feuds monthly and revives them on the next match", () => {
    const records = roster();
    const campaign = makeCampaign(1991, {
      feuds: [{ entrantIds: [records[0].id, records[1].id], label: "cooling grudge", initialHeat: 22 }],
    });
    const advanced = advanceCampaignDays(campaign, 31);
    expect(advanced.currentDate).toBe("1991-02-01");
    const cooled = advanced.booking!.feuds[0];
    expect(cooled.heat).toBe(17);
    expect(cooled.status).toBe("cooling");
    expect(advanced.booking!.feudHistory[0]).toMatchObject({ delta: -5, from: 22, to: 17, reason: "monthly-decay" });
    // The next feud match revives the feud: heat 17 + the result's deterministic
    // delta (win +3 / loss +2 / draw +4), active again regardless of the outcome.
    const scheduled = scheduleCampaignMatch(advanced, { date: advanced.currentDate, entrantIds: [records[0].id, records[1].id], timeLimitMinutes: 6 });
    const resolved = resolveScheduledMatchHeadless(scheduled, scheduled.schedule[0].id);
    const result = resolved.schedule[0].result!;
    const revived = resolved.booking!.feuds[0];
    const expectedDelta = feudHeatDelta(result.winnerEntrantId === records[0].id, result.method, false);
    expect(revived.heat).toBe(17 + expectedDelta);
    expect(revived.status).toBe("active");
    expect(revived.matchCount).toBe(1);
    expect(resolved.booking!.feudHistory.at(-1)).toMatchObject({ delta: expectedDelta, from: 17, to: 17 + expectedDelta, reason: result.winnerEntrantId === records[0].id ? "win" : "loss" });
  });

  it("emits a deterministic month-end booking card for the player", () => {
    const records = roster();
    const player = records[0].id;
    const rival = records[1].id;
    const campaign = createCampaign({
      name: "M13 Booking Card",
      seed: 2000, // seed 2000: world title rolls 1 required defense in January
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: player,
      playerDivision: "singles",
      champions: { "world-heavyweight": player },
      bookingPolicy: "feuds",
      feuds: [{ entrantIds: [player, rival], label: "top grudge", initialHeat: 80 }],
    });
    // Complete January's single mandatory defense (day 2, so the defense stays
    // within the 30-day rolling window) and the title survives month end.
    const challenger = campaign.rankings.singles.entries[0].entrantId;
    const day2 = advanceCampaignDays(campaign, 1);
    const defended = scheduleCampaignMatch(day2, { date: day2.currentDate, entrantIds: [challenger, player], timeLimitMinutes: 6, titleId: "world-heavyweight" });
    const resolved = resolveScheduledMatchHeadless(defended, defended.schedule[0].id);
    expect(resolved.schedule[0].result!.winnerEntrantId).toBe(player);
    expect(resolved.titles["world-heavyweight"].holderId).toBe(player);
    const advanced = advanceCampaignDays(resolved, 30);
    expect(advanced.titles["world-heavyweight"].holderId).toBe(player);
    expect(advanced.booking!.monthSuggestions).toHaveLength(1);
    const card = advanced.booking!.monthSuggestions[0];
    expect(card.month).toBe("1991-02");
    expect(card.playerEntrantId).toBe(player);
    // Priority 1: February's fresh mandatory defense is booked first.
    expect(card.items[0].kind).toBe("required-defense");
    expect(card.items[0].titleId).toBe("world-heavyweight");
    expect(card.items[0].opponentId).not.toBe(player);
    // Priority 2: the hottest active feud rival is the draw (heat 80 + 2 loss from the defense).
    expect(card.items[1].kind).toBe("feud");
    expect(card.items[1].opponentId).toBe(rival);
    expect(card.items[1].feudId).toBe(advanced.booking!.feuds[0].id);
    // Priority 3: an optional most-popular/highest-ranked opponent fills the card.
    expect(card.items[2].kind).toBe("optional");
    expect(card.items.map((item) => item.priority)).toEqual([1, 2, 3]);
    const monthEnd = advanced.events.find((row) => row.detail.some((line) => line.includes("Booking card for 1991-02")));
    expect(monthEnd?.detail.some((line) => line.includes("1. required-defense vs"))).toBe(true);
  });

  it("lets the player's hottest feud rival win the optional-booking preference", () => {
    const records = roster();
    const player = records[0].id;
    const hotRival = records[2].id; // ranked #2
    const coldRival = records[1].id; // ranked #1 (international holder, ranked #1)
    const campaign = nonChampionCampaign(1991, [
      { entrantIds: [player, coldRival], label: "cold grudge", initialHeat: 10 },
      { entrantIds: [player, hotRival], label: "hot grudge", initialHeat: 90 },
    ]);
    // Without the feud preference the top-ranked available opponent (coldRival)
    // would be booked; the hot feud rival wins instead.
    expect(suggestPlayerMatch(campaign).entrantIds[1]).toBe(hotRival);
  });

  it("does not book a cooling feud rival ahead of the field", () => {
    const records = roster();
    const player = records[0].id;
    const rival = records[2].id;
    const campaign = nonChampionCampaign(1991, [
      { entrantIds: [player, rival], label: "cooled grudge", initialHeat: 10 },
    ]);
    campaign.booking!.feuds[0].status = "cooling";
    const suggestion = suggestPlayerMatch(campaign);
    expect(suggestion.entrantIds[1]).not.toBe(rival);
  });

  it("starts new feuds as a transaction and validates inputs", () => {
    const campaign = makeCampaign(1991);
    const records = Object.values(campaign.roster);
    const started = startFeud(campaign, [records[1].id, records[2].id], { label: "fresh grudge", initialHeat: 70 });
    expect(started.booking!.feuds).toHaveLength(2);
    const fresh = started.booking!.feuds.at(-1)!;
    expect(fresh).toMatchObject({ label: "fresh grudge", heat: 70, status: "active", startedAt: "1991-01-01" });
    expect(started.events.at(-1)?.type).toBe("start-feud");
    // The pair just started is a duplicate of an existing feud.
    expect(() => startFeud(started, [records[1].id, records[2].id])).toThrow(/already exists/);
    expect(() => startFeud(campaign, [records[1].id, records[1].id])).toThrow(/different/);
    expect(() => startFeud(campaign, [records[1].id, "nope"])).toThrow(/Unknown entrant/);
    const plainRecords = roster();
    const plain = createCampaign({
      name: "Plain",
      seed: 1991,
      startDate: "1991-01-01",
      roster: plainRecords,
      playerEntrantId: plainRecords[0].id,
      playerDivision: "singles",
    });
    expect(() => startFeud(plain, [records[1].id, records[2].id])).toThrow(/extension/);
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
    expect(first.booking!.feudHistory).toEqual(second.booking!.feudHistory);
    const advancedA = advanceCampaignDays(makeCampaign(1991), 31);
    const advancedB = advanceCampaignDays(makeCampaign(1991), 31);
    expect(advancedA.booking!.monthSuggestions).toEqual(advancedB.booking!.monthSuggestions);
  });

  it("round-trips through serialization byte-identically", () => {
    const campaign = advanceCampaignDays(makeCampaign(7), 31);
    expect(verifyCampaignRoundTrip(campaign).valid).toBe(true);
    const imported = importCampaignJson(serializeCampaign(campaign)).state;
    expect(hashCampaignState(imported)).toBe(hashCampaignState(campaign));
    expect(imported.booking).toEqual(campaign.booking);
  });

  it("rejects tampered booking state", () => {
    const campaign = makeCampaign(1991);
    const badVersion = structuredClone(campaign);
    badVersion.bookingVersion = "wrong";
    expect(validateCampaignState(badVersion).some((line) => line.includes("bookingVersion"))).toBe(true);
    const orphanLedger = structuredClone(campaign);
    orphanLedger.bookingPolicy = undefined;
    orphanLedger.bookingVersion = undefined;
    expect(validateCampaignState(orphanLedger).some((line) => line.includes("booking: ledger present"))).toBe(true);
    const missingLedger = structuredClone(campaign);
    missingLedger.booking = undefined;
    expect(validateCampaignState(missingLedger).some((line) => line.includes("requires the booking ledger"))).toBe(true);
    const badHeat = structuredClone(campaign);
    badHeat.booking!.feuds[0].heat = 101;
    expect(validateCampaignState(badHeat).some((line) => line.includes("heat outside"))).toBe(true);
    const dupFeud = structuredClone(campaign);
    dupFeud.booking!.feuds.push({ ...dupFeud.booking!.feuds[0] });
    expect(validateCampaignState(dupFeud).some((line) => line.includes("duplicate feud ID"))).toBe(true);
    const unknownEntrant = structuredClone(campaign);
    unknownEntrant.booking!.feuds[0].entrantIds[1] = "ghost";
    expect(validateCampaignState(unknownEntrant).some((line) => line.includes("unknown entrant"))).toBe(true);
  });

  it("surfaces booking counters in the campaign summary when enabled", () => {
    const summary = campaignSummary(advanceCampaignDays(makeCampaign(1991), 31));
    expect(summary.feudCount).toBe(1);
    expect(summary.feudHeat).toBe(45);
    expect(summary.bookingSuggestions).toBe(1);
  });
});

describe("M13-ADJ-03 the feud is the draw", () => {
  function championCampaign(seed = 1991, feudHeat: number): CampaignState {
    const records = roster();
    const player = records[0].id;
    const rival = records[1].id; // ranked #1 non-champion, first title-shot candidate
    return createCampaign({
      name: "M13 Feud Draw",
      seed,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: player,
      playerDivision: "singles",
      champions: { "world-heavyweight": player },
      bookingPolicy: "feuds",
      feuds: [{ entrantIds: [player, rival], label: "championship grudge", initialHeat: feudHeat }],
    });
  }

  it("pins the graded feud term on title-shot offers", () => {
    const campaign = championCampaign(1991, 60);
    const rival = campaign.booking!.feuds[0].entrantIds[1];
    const rolled = rollTitleShot(campaign, "world-heavyweight");
    const offer = rolled.titleShotOffers.at(-1)!;
    expect(offer.candidateId).toBe(rival);
    const feudTerm = offer.modifiers.find((row) => row.label.includes("feud heat 60 vs champion"));
    expect(feudTerm).toMatchObject({ amount: 3 });
    // The roll detail names the feud term deterministically.
    expect(offer.detail.some((line) => line.includes("feud heat 60 vs champion"))).toBe(true);
  });

  it("gives no feud term to a cooling feud or an absent feud", () => {
    const cooling = championCampaign(1991, 10);
    cooling.booking!.feuds[0].status = "cooling";
    const rolled = rollTitleShot(cooling, "world-heavyweight");
    expect(rolled.titleShotOffers.at(-1)!.modifiers.some((row) => row.label.includes("feud heat"))).toBe(false);
    const records = roster();
    const noFeud = createCampaign({
      name: "No Feud",
      seed: 1991,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: records[0].id,
      playerDivision: "singles",
      champions: { "world-heavyweight": records[0].id },
      bookingPolicy: "feuds",
    });
    const rolled2 = rollTitleShot(noFeud, "world-heavyweight");
    expect(rolled2.titleShotOffers.at(-1)!.modifiers.some((row) => row.label.includes("feud heat"))).toBe(false);
  });

  it("stacks the feud term with the M12 popularity heat term", () => {
    const records = roster();
    const player = records[0].id;
    const rival = records[1].id;
    const campaign = createCampaign({
      name: "M13 Feud + Finance",
      seed: 1991,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: player,
      playerDivision: "singles",
      champions: { "world-heavyweight": player },
      financePolicy: "contracts",
      bookingPolicy: "feuds",
      feuds: [{ entrantIds: [player, rival], label: "championship grudge", initialHeat: 60 }],
    });
    campaign.finance!.popularity[rival] = 90;
    const rolled = rollTitleShot(campaign, "world-heavyweight");
    const offer = rolled.titleShotOffers.at(-1)!;
    expect(offer.candidateId).toBe(rival);
    const popularity = offer.modifiers.find((row) => row.label.includes("popularity heat 90"));
    const feud = offer.modifiers.find((row) => row.label.includes("feud heat 60 vs champion"));
    expect(popularity).toMatchObject({ amount: 4 });
    expect(feud).toMatchObject({ amount: 3 });
  });

  it("never makes an out-of-range (unranked) entrant a title-shot candidate", () => {
    // The singles ranking limit is 10; an 11th non-champion is unranked and
    // therefore outside the candidate range even at maximum feud heat.
    const records = Array.from({ length: 12 }, (_, index) => makeUnderdogRecord(300 + index, index));
    const player = records[0].id;
    const campaign = createCampaign({
      name: "M13 Gate",
      seed: 1991,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: player,
      playerDivision: "singles",
      champions: { "world-heavyweight": player },
      bookingPolicy: "feuds",
      feuds: [{ entrantIds: [player, records[1].id], label: "out-of-range grudge", initialHeat: 100 }],
    });
    // Find an entrant outside the singles ranking limit (10 ranked entries).
    const ranked = new Set(campaign.rankings.singles.entries.map((row) => row.entrantId));
    const unranked = Object.keys(campaign.roster).find((id) => id !== player && !ranked.has(id))!;
    campaign.booking!.feuds[0].entrantIds = [player, unranked];
    campaign.booking!.feuds[0].label = "out-of-range grudge";
    expect(campaign.rankings.singles.entries.some((row) => row.entrantId === unranked)).toBe(false);
    const rolled = rollTitleShot(campaign, "world-heavyweight");
    const offer = rolled.titleShotOffers.at(-1)!;
    expect(offer.candidateId).not.toBe(unranked);
    expect(offer.modifiers.some((row) => row.label.includes("feud heat"))).toBe(false);
  });

  it("never bypasses the M12 popularity floor", () => {
    const records = roster();
    const player = records[0].id;
    const cold = createCampaign({
      name: "M13 Cold Gate",
      seed: 1991,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: player,
      playerDivision: "singles",
      champions: { "world-heavyweight": player },
      financePolicy: "contracts",
      bookingPolicy: "feuds",
      feuds: [{ entrantIds: [player, records[1].id], label: "cold grudge", initialHeat: 100 }],
    });
    for (const id of Object.keys(cold.roster)) cold.finance!.popularity[id] = 25;
    expect(() => rollTitleShot(cold, "world-heavyweight")).toThrow(/popularity floor/);
  });
});

describe("M13 tag-team feud rivals", () => {
  /** A booking-enabled tag campaign; the player is t1 and feuds with t2 by default. */
  function teamCampaign(seed = 1991, extra: Record<string, unknown> = {}): CampaignState {
    const records = roster(8);
    const teams = [0, 1, 2, 3].map((index) => ({
      id: `t${index + 1}`,
      name: `Team ${index + 1}`,
      memberIds: [records[index * 2].id, records[index * 2 + 1].id] as [string, string],
      side: records[index * 2].side,
    }));
    return createCampaign({
      name: "M13 Tag Feuds",
      seed,
      startDate: "1991-01-01",
      roster: records,
      teams,
      playerEntrantId: "t1",
      playerDivision: "tag",
      bookingPolicy: "feuds",
      feuds: [{ entrantIds: ["t1", "t2"], label: "tag grudge" }],
      ...extra,
    });
  }

  it("creates team feuds and validates their entrants like singles feuds", () => {
    const campaign = teamCampaign(1991);
    const feud = campaign.booking!.feuds[0];
    expect(feud.entrantIds).toEqual(["t1", "t2"]);
    expect(feud.label).toBe("tag grudge");
    expect(feud.heat).toBe(50);
    expect(feud.status).toBe("active");
    expect(feud.id).toMatch(/^feud-/);
    expect(campaign.booking!.feudHistory).toEqual([]);
    expect(validateCampaignState(campaign)).toEqual([]);
    // Unknown or duplicate team entrants are rejected at creation.
    expect(() => teamCampaign(1991, { feuds: [{ entrantIds: ["t1", "ghost"], label: "bad" }] })).toThrow(/unknown entrant/);
    expect(() => teamCampaign(1991, { feuds: [{ entrantIds: ["t1", "t1"], label: "self" }] })).toThrow(/same entrant twice/);
    expect(() => teamCampaign(1991, { feuds: [{ entrantIds: ["t1", "t2"], label: "a" }, { entrantIds: ["t2", "t1"], label: "b" }] })).toThrow(/Duplicate feud/);
  });

  it("moves tag feud heat from the pinned seed-1991 tag outcome", () => {
    const campaign = teamCampaign(1991);
    const feud = campaign.booking!.feuds[0];
    const scheduled = scheduleCampaignMatch(campaign, { date: campaign.currentDate, entrantIds: ["t1", "t2"], timeLimitMinutes: 6 });
    const resolved = resolveScheduledMatchHeadless(scheduled, scheduled.schedule[0].id);
    const result = resolved.schedule[0].result!;
    expect(result.method).toBe("pin");
    expect(result.winnerEntrantId).toBe("t2");
    const after = resolved.booking!.feuds[0];
    expect(after.heat).toBe(52);
    expect(after.status).toBe("active");
    expect(after.matchCount).toBe(1);
    expect(after.lastMatchDate).toBe(resolved.currentDate);
    const movement = resolved.booking!.feudHistory[0];
    expect(movement).toMatchObject({ delta: 2, from: 50, to: 52, reason: "loss", feudId: feud.id, matchId: resolved.schedule[0].id });
    expect(resolved.events.find((row) => row.type === "commit-match-result")?.detail.some((line) => line.includes("Feud tag grudge (t1 vs t2): heat 50 → 52 (+2); 1 feud match(es)."))).toBe(true);
  });

  it("adds the title-match bonus to tag feud heat", () => {
    const campaign = teamCampaign(7, { champions: { "world-tag": "t2", "american-tag": "t3" } });
    const scheduled = scheduleCampaignMatch(campaign, { date: campaign.currentDate, entrantIds: ["t1", "t2"], timeLimitMinutes: 6, titleId: "world-tag" });
    const resolved = resolveScheduledMatchHeadless(scheduled, scheduled.schedule[0].id);
    const result = resolved.schedule[0].result!;
    expect(result.method).toBe("pin");
    expect(result.winnerEntrantId).toBe("t2");
    const feud = resolved.booking!.feuds[0];
    const wonA = result.winnerEntrantId === "t1";
    // Pinned absolutely: t1 loses by pin in a title match → loss +2 plus the
    // +1 title-match bonus, and the movement row names the loss reason.
    expect(feudHeatDelta(wonA, result.method, true)).toBe(3);
    expect(feud.heat).toBe(53);
    expect(resolved.booking!.feudHistory[0]).toMatchObject({ delta: 3, from: 50, to: 53, reason: wonA ? "win" : "loss" });
  });

  it("decays a cold tag feud monthly and revives it on the next tag match", () => {
    const campaign = teamCampaign(1991, {
      feuds: [{ entrantIds: ["t1", "t2"], label: "cooling tag grudge", initialHeat: 22 }],
    });
    const advanced = advanceCampaignDays(campaign, 31);
    expect(advanced.currentDate).toBe("1991-02-01");
    const cooled = advanced.booking!.feuds[0];
    expect(cooled.heat).toBe(17);
    expect(cooled.status).toBe("cooling");
    expect(advanced.booking!.feudHistory[0]).toMatchObject({ delta: -5, from: 22, to: 17, reason: "monthly-decay" });
    const scheduled = scheduleCampaignMatch(advanced, { date: advanced.currentDate, entrantIds: ["t1", "t2"], timeLimitMinutes: 6 });
    const resolved = resolveScheduledMatchHeadless(scheduled, scheduled.schedule[0].id);
    const result = resolved.schedule[0].result!;
    const revived = resolved.booking!.feuds[0];
    const expectedDelta = feudHeatDelta(result.winnerEntrantId === "t1", result.method, false);
    expect(revived.heat).toBe(17 + expectedDelta);
    expect(revived.status).toBe("active");
    expect(revived.matchCount).toBe(1);
    expect(resolved.booking!.feudHistory.at(-1)).toMatchObject({ delta: expectedDelta, from: 17, to: 17 + expectedDelta });
  });

  it("emits a month-end booking card naming the player team's feud rival", () => {
    const campaign = teamCampaign(2000, {
      champions: { "world-tag": "t2", "american-tag": "t3" },
      feuds: [{ entrantIds: ["t1", "t2"], label: "top tag grudge", initialHeat: 90 }],
    });
    const advanced = advanceCampaignDays(campaign, 31);
    expect(advanced.booking!.monthSuggestions).toHaveLength(1);
    const card = advanced.booking!.monthSuggestions[0];
    expect(card.month).toBe("1991-02");
    expect(card.playerEntrantId).toBe("t1");
    // t1 holds no title, so the feud item is the card's top priority and the
    // optional opponent fills the rest.
    expect(card.items[0].kind).toBe("feud");
    expect(card.items[0].opponentId).toBe("t2");
    expect(card.items[0].feudId).toBe(advanced.booking!.feuds[0].id);
    expect(card.items[1].kind).toBe("optional");
    expect(card.items.map((item) => item.priority)).toEqual([2, 3]);
    const monthEnd = advanced.events.find((row) => row.detail.some((line) => line.includes("Booking card for 1991-02")));
    // The feud item carries hardcoded priority 2 when no defense is due.
    expect(monthEnd?.detail.some((line) => line.includes("2. feud vs t2"))).toBe(true);
  });

  it("lets the player team's hottest feud rival win the optional-booking preference", () => {
    // t4 holds both tag titles; t2 is the top-ranked available team and a cold
    // feud rival, t3 the hot feud rival. Without the feud preference the
    // top-ranked available opponent would be booked; the hot feud rival wins.
    const campaign = teamCampaign(1991, {
      champions: { "world-tag": "t4", "american-tag": "t4" },
      feuds: [
        { entrantIds: ["t1", "t2"], label: "cold tag grudge", initialHeat: 10 },
        { entrantIds: ["t1", "t3"], label: "hot tag grudge", initialHeat: 90 },
      ],
    });
    expect(suggestPlayerMatch(campaign).entrantIds[1]).toBe("t3");
    // A cooling feud rival is skipped: only the cold active feud remains, so
    // its rival (t2) becomes the preferred pick instead.
    campaign.booking!.feuds[1].status = "cooling";
    expect(suggestPlayerMatch(campaign).entrantIds[1]).toBe("t2");
  });

  it("is deterministic and round-trips for tag feud campaigns", () => {
    const resolveSeeded = (seed: number): CampaignState => {
      const campaign = teamCampaign(seed);
      const scheduled = scheduleCampaignMatch(campaign, { date: campaign.currentDate, entrantIds: ["t1", "t2"], timeLimitMinutes: 6 });
      return resolveScheduledMatchHeadless(scheduled, scheduled.schedule[0].id);
    };
    const first = resolveSeeded(1991);
    const second = resolveSeeded(1991);
    expect(hashCampaignState(first)).toBe(hashCampaignState(second));
    expect(first.booking!.feudHistory).toEqual(second.booking!.feudHistory);
    const advanced = advanceCampaignDays(teamCampaign(1991), 31);
    expect(verifyCampaignRoundTrip(advanced).valid).toBe(true);
    const imported = importCampaignJson(serializeCampaign(advanced)).state;
    expect(hashCampaignState(imported)).toBe(hashCampaignState(advanced));
    expect(imported.booking).toEqual(advanced.booking);
    expect(validateCampaignSave(advanced)).toEqual([]);
    const summary = campaignSummary(advanced);
    expect(summary.feudCount).toBe(1);
    expect(summary.feudHeat).toBe(45);
    expect(summary.bookingSuggestions).toBe(1);
  });

  it("rejects tampered tag booking state", () => {
    const campaign = teamCampaign(1991);
    const badHeat = structuredClone(campaign);
    badHeat.booking!.feuds[0].heat = 101;
    expect(validateCampaignState(badHeat).some((line) => line.includes("heat outside"))).toBe(true);
    const dupFeud = structuredClone(campaign);
    dupFeud.booking!.feuds.push({ ...dupFeud.booking!.feuds[0] });
    expect(validateCampaignState(dupFeud).some((line) => line.includes("duplicate feud ID"))).toBe(true);
    const unknownEntrant = structuredClone(campaign);
    unknownEntrant.booking!.feuds[0].entrantIds[1] = "ghost";
    expect(validateCampaignState(unknownEntrant).some((line) => line.includes("unknown entrant"))).toBe(true);
  });
});

describe("M13-ADJ-04 mixed-entrant feud hardening", () => {
  /** A booking campaign with one persistent team, so a mixed pair is constructible. */
  function mixedPairCampaign(seed = 1991): { records: ReturnType<typeof roster>; teamId: string; campaign: CampaignState } {
    const records = roster();
    const teamId = "career-team-1";
    const campaign = createCampaign({
      name: "M13 Mixed",
      seed,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: records[0].id,
      playerDivision: "singles",
      bookingPolicy: "feuds",
      teams: [{ id: teamId, name: "Career Team 1", memberIds: [records[2].id, records[3].id] as [string, string], side: records[2].side }],
    });
    return { records, teamId, campaign };
  }

  it("rejects a mixed wrestler-vs-team feud at startFeud", () => {
    const { records, teamId, campaign } = mixedPairCampaign(1991);
    expect(() => startFeud(campaign, [records[0].id, teamId])).toThrow(/same kind/);
    expect(() => startFeud(campaign, [teamId, records[0].id])).toThrow(/same kind/);
    expect(campaign.booking!.feuds).toHaveLength(0);
  });

  it("rejects a mixed feud in the campaign config at creation", () => {
    const records = roster();
    expect(() =>
      createCampaign({
        name: "M13 Mixed Config",
        seed: 1991,
        startDate: "1991-01-01",
        roster: records,
        playerEntrantId: records[0].id,
        playerDivision: "singles",
        bookingPolicy: "feuds",
        teams: [{ id: "career-team-1", name: "Career Team 1", memberIds: [records[2].id, records[3].id] as [string, string], side: records[2].side }],
        feuds: [{ entrantIds: [records[0].id, "career-team-1"] }],
      })
    ).toThrow(/mixes a singles entrant with a tag entrant/);
  });

  it("turns a tampered mixed feud into a targeted validation error instead of crashing month-end", () => {
    const { records, teamId, campaign } = mixedPairCampaign(1991);
    campaign.booking!.feuds.push({
      id: "feud-mixed",
      entrantIds: [records[0].id, teamId],
      label: "mixed grudge",
      heat: 50,
      status: "active",
      startedAt: "1991-01-01",
      lastMatchDate: null,
      matchCount: 0,
    });
    // The defensive guard skips the unresolvable feud rival, so month-end
    // finalization completes and validation names the exact problem instead of
    // throwing wrestlerIdsForEntrant's "Unknown wrestler entrant" mid-mutation.
    expect(() => advanceCampaignDays(campaign, 31)).toThrow(/mixed-entrant feud/);
    expect(validateCampaignState(campaign).some((line) => line.includes("mixed-entrant feud"))).toBe(true);
    expect(validateCampaignState(campaign).some((line) => line.includes("singles entrant"))).toBe(true);
  });

  it("still accepts a same-kind team feud and advances cleanly", () => {
    const records = roster();
    const campaign = createCampaign({
      name: "M13 Tag Pair",
      seed: 2000,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: records[0].id,
      playerDivision: "singles",
      bookingPolicy: "feuds",
      teams: [
        { id: "career-team-1", name: "Career Team 1", memberIds: [records[2].id, records[3].id] as [string, string], side: records[2].side },
        { id: "career-team-2", name: "Career Team 2", memberIds: [records[0].id, records[1].id] as [string, string], side: records[0].side },
      ],
    });
    const withTagFeud = startFeud(campaign, ["career-team-1", "career-team-2"], { label: "team grudge", initialHeat: 60 });
    expect(withTagFeud.booking!.feuds.at(-1)).toMatchObject({ label: "team grudge", heat: 60, status: "active" });
    const advanced = advanceCampaignDays(withTagFeud, 31);
    expect(advanced.booking!.feuds.some((feud) => feud.label === "team grudge")).toBe(true);
  });
});

describe("M13 tag feud heat and booking extensions", () => {
  /** A tag campaign where t1 and t2 feud without titles (heat 50). */
  function tagPairCampaign(seed: number): CampaignState {
    const records = roster(8);
    const teams = [0, 1, 2, 3].map((index) => ({
      id: `t${index + 1}`,
      name: `Team ${index + 1}`,
      memberIds: [records[index * 2].id, records[index * 2 + 1].id] as [string, string],
      side: records[index * 2].side,
    }));
    return createCampaign({
      name: "M13 Tag Pair",
      seed,
      startDate: "1991-01-01",
      roster: records,
      teams,
      playerEntrantId: "t1",
      playerDivision: "tag",
      bookingPolicy: "feuds",
      feuds: [{ entrantIds: ["t1", "t2"], label: "tag grudge", initialHeat: 50 }],
    });
  }

  /** A tag campaign where t1 holds the world-tag title and feuds with the top-ranked t2. */
  function tagChampionCampaign(seed = 1991, feudHeat = 60): CampaignState {
    const records = roster(8);
    const teams = [0, 1, 2, 3].map((index) => ({
      id: `t${index + 1}`,
      name: `Team ${index + 1}`,
      memberIds: [records[index * 2].id, records[index * 2 + 1].id] as [string, string],
      side: records[index * 2].side,
    }));
    return createCampaign({
      name: "M13 Tag Term",
      seed,
      startDate: "1991-01-01",
      roster: records,
      teams,
      playerEntrantId: "t1",
      playerDivision: "tag",
      champions: { "world-tag": "t1", "american-tag": "t3" },
      bookingPolicy: "feuds",
      feuds: [{ entrantIds: ["t1", "t2"], label: "championship tag grudge", initialHeat: feudHeat }],
    });
  }

  it("pins the tag draw outcome on feud heat", () => {
    const campaign = tagPairCampaign(1);
    const feud = campaign.booking!.feuds[0];
    const scheduled = scheduleCampaignMatch(campaign, { date: campaign.currentDate, entrantIds: ["t1", "t2"], timeLimitMinutes: 6 });
    const resolved = resolveScheduledMatchHeadless(scheduled, scheduled.schedule[0].id);
    const result = resolved.schedule[0].result!;
    expect(result.method).toBe("time-limit-draw");
    expect(result.winnerEntrantId).toBeNull();
    // A draw moves the feud +4 with a draw reason, exactly like a singles feud.
    expect(resolved.booking!.feuds[0].heat).toBe(54);
    expect(resolved.booking!.feudHistory[0]).toMatchObject({ delta: 4, from: 50, to: 54, reason: "draw", feudId: feud.id });
    expect(resolved.events.find((row) => row.type === "commit-match-result")?.detail.some((line) => line.includes("Feud tag grudge (t1 vs t2): heat 50 → 54 (+4); 1 feud match(es)."))).toBe(true);
  });

  it("pins the graded feud term on a tag title-shot offer", () => {
    const campaign = tagChampionCampaign(1991, 60);
    const rolled = rollTitleShot(campaign, "world-tag");
    const offer = rolled.titleShotOffers.at(-1)!;
    expect(offer.candidateId).toBe("t2");
    const feudTerm = offer.modifiers.find((row) => row.label.includes("feud heat 60 vs champion"));
    expect(feudTerm).toMatchObject({ amount: 3 });
    // The roll detail names the tag feud term deterministically.
    expect(offer.detail.some((line) => line.includes("+3 feud heat 60 vs champion"))).toBe(true);
  });

  it("gives no feud term to a cooling tag feud", () => {
    const campaign = tagChampionCampaign(1991, 10);
    campaign.booking!.feuds[0].status = "cooling";
    const rolled = rollTitleShot(campaign, "world-tag");
    expect(rolled.titleShotOffers.at(-1)!.modifiers.some((row) => row.label.includes("feud heat"))).toBe(false);
  });

  it("records the consolidated roll breakdown on the grant event before any decision", () => {
    const rolled = rollTitleShot(tagChampionCampaign(1991, 60), "world-tag");
    const offer = rolled.titleShotOffers.at(-1)!;
    expect(offer.candidateId).toBe("t2");
    // The roll-title-shot grant event itself records the same consolidated line
    // the decisions panel renders, before any accept/decline happens.
    const grantEvent = rolled.events.find((row) => row.type === "roll-title-shot")!;
    expect(grantEvent.detail.some((line) => line === "t2 granted World Tag offer title-shot-4c1632ac; roll 6 -3 same side (tag) +3 feud heat 60 vs champion = 6.")).toBe(true);
  });

  it("derives the grant-event line from the same titleShotGrantLine helper the panel surfaces", () => {
    const rolled = rollTitleShot(tagChampionCampaign(1991, 60), "world-tag");
    const offer = rolled.titleShotOffers.at(-1)!;
    expect(offer.candidateId).toBe("t2");
    // The log line (raw entrant id) and the panel line (human label) are the
    // same helper, so they provably cannot drift apart.
    expect(titleShotGrantLine(offer, offer.candidateId, "World Tag")).toBe("t2 granted World Tag offer title-shot-4c1632ac; roll 6 -3 same side (tag) +3 feud heat 60 vs champion = 6.");
    expect(titleShotGrantLine(offer, "Team 2", "World Tag")).toBe("Team 2 granted World Tag offer title-shot-4c1632ac; roll 6 -3 same side (tag) +3 feud heat 60 vs champion = 6.");
    // The grant event's detail line is exactly the helper's raw-id output.
    const grantEvent = rolled.events.find((row) => row.type === "roll-title-shot")!;
    expect(grantEvent.detail.includes(titleShotGrantLine(offer, offer.candidateId, "World Tag"))).toBe(true);
  });

  it("records the title-shot roll breakdown in the respond event detail", () => {
    const rolled = rollTitleShot(tagChampionCampaign(1991, 60), "world-tag");
    const offer = rolled.titleShotOffers.at(-1)!;
    expect(offer.candidateId).toBe("t2");
    // The breakdown recorded on resolution is the same line the decisions
    // panel renders, feud terms included.
    expect(titleShotRollLine(offer)).toBe("6 -3 same side (tag) +3 feud heat 60 vs champion = 6");
    const declined = respondToTitleShot(rolled, offer.id, false);
    const declineEvent = declined.events.find((row) => row.type === "respond-title-shot")!;
    expect(declineEvent.detail).toEqual([
      "t2 declined World Tag offer title-shot-4c1632ac; roll 6 -3 same side (tag) +3 feud heat 60 vs champion = 6 — candidate traversal may continue.",
    ]);
    // Accepting the same offer records the breakdown too (the follow-on
    // schedule-match event is the newest event in that case).
    const accepted = respondToTitleShot(rolled, offer.id, true);
    const acceptEvent = accepted.events.find((row) => row.type === "respond-title-shot")!;
    expect(acceptEvent.detail).toEqual([
      "t2 accepted World Tag offer title-shot-4c1632ac; roll 6 -3 same side (tag) +3 feud heat 60 vs champion = 6.",
    ]);
    expect(accepted.schedule.at(-1)).toMatchObject({ titleId: "world-tag", mandatoryDefense: true });
    // The detail change is data-hash-safe: events are excluded from the state
    // hash, so the respond event's pre-state hash is exactly the pre-transaction
    // campaign hash (only the offer status legitimately moves it post).
    expect(declineEvent.preStateHash).toBe(hashCampaignState(rolled));
    expect(declineEvent.postStateHash).toBe(hashCampaignState(declined));
  });

  it("records the consolidated extra-shot grant line on grantExtraTitleShot's schedule event, symmetric to the rolled path", () => {
    // The extra (champion-granted) shot records its consolidated grant line on
    // the schedule-match event — the manual path's twin of the rolled path's
    // roll-title-shot grant line, from a sibling helper.
    expect(titleShotExtraGrantLine("t4", "World Heavyweight", 2, 2)).toBe("t4 granted extra World Heavyweight shot (mandatory defenses complete 2/2).");
    expect(titleShotExtraGrantLine("t4", "World Heavyweight", 1, 2)).toBe("t4 granted extra World Heavyweight shot (mandatory defenses complete 1/2).");

    const source = tagChampionCampaign(1991, 60);
    const complete = structuredClone(source);
    complete.titles["world-tag"].completedDefenses = complete.titles["world-tag"].requiredDefenses;
    const challenger = source.rankings.tag.entries.find((row) => row.entrantId !== "t1")!.entrantId;
    const next = grantExtraTitleShot(complete, "world-tag", challenger, complete.currentDate);
    const scheduleEvent = next.events.at(-1)!;
    expect(scheduleEvent.type).toBe("schedule-match");
    const expected = titleShotExtraGrantLine(challenger, "World Tag", complete.titles["world-tag"].requiredDefenses, complete.titles["world-tag"].requiredDefenses);
    expect(scheduleEvent.detail.includes(expected)).toBe(true);
    // The schedule row is a non-mandatory extra defense, and the extra-shot
    // grant line is data-hash-safe (events excluded from the state hash).
    expect(next.schedule.at(-1)).toMatchObject({ titleId: "world-tag", mandatoryDefense: false });
    expect(scheduleEvent.preStateHash).toBe(hashCampaignState(complete));
  });
});
