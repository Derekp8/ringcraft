import { describe, expect, it } from "vitest";
import { advanceCampaignDays, createCampaign } from "../src/core";
import type { CampaignState } from "../src/core";
import { buildMonthEndSummary, titleShotRollLine } from "../src/ui/campaign-presentation";
import type { TitleShotOffer } from "../src/core";
import { makeUnderdogRecord } from "../scripts/m11-playtest-batch";

/** A minimal TitleShotOffer carrying only the fields titleShotRollLine reads. */
function makeOffer(rawRoll: number, modifiers: Array<{ label: string; amount: number }>, modifiedRoll: number): TitleShotOffer {
  return {
    id: "offer-1",
    titleId: "world-tag",
    month: "1991-02",
    candidateId: "career-team-3",
    candidateRank: 2,
    rawRoll,
    modifiers,
    modifiedRoll,
    status: "offered",
    detail: [],
  };
}

function roster(count = 4, seedBase = 300): ReturnType<typeof makeUnderdogRecord>[] {
  return Array.from({ length: count }, (_, index) => makeUnderdogRecord(seedBase + index, index));
}

/** A booking-enabled singles campaign; the player is records[0] and feuds with records[1] by default. */
function makeSinglesCampaign(seed = 2000, extra: Record<string, unknown> = {}): CampaignState {
  const records = roster();
  return createCampaign({
    name: "M13 Banner Singles",
    seed,
    startDate: "1991-01-01",
    roster: records,
    playerEntrantId: records[0].id,
    playerDivision: "singles",
    bookingPolicy: "feuds",
    feuds: [{ entrantIds: [records[0].id, records[1].id], label: "top grudge", initialHeat: 80 }],
    ...extra,
  });
}

/** A booking-enabled tag campaign; the player is t1 and feuds with t2 by default. */
function makeTagCampaign(seed = 2000, extra: Record<string, unknown> = {}): CampaignState {
  const records = roster(8);
  const teams = [0, 1, 2, 3].map((index) => ({
    id: `t${index + 1}`,
    name: `Team ${index + 1}`,
    memberIds: [records[index * 2].id, records[index * 2 + 1].id] as [string, string],
    side: records[index * 2].side,
  }));
  return createCampaign({
    name: "M13 Banner Tag",
    seed,
    startDate: "1991-01-01",
    roster: records,
    teams,
    playerEntrantId: "t1",
    playerDivision: "tag",
    bookingPolicy: "feuds",
    feuds: [{ entrantIds: ["t1", "t2"], label: "top tag grudge", initialHeat: 90 }],
    ...extra,
  });
}

describe("M13 month-end banner booking line", () => {
  it("surfaces the whole singles booking card from the banner", () => {
    const campaign = makeSinglesCampaign(2000);
    const advanced = advanceCampaignDays(campaign, 31);
    const summary = buildMonthEndSummary(advanced)!;
    // The banner reports the closing month (January); the booking card is
    // generated at this boundary for the new month (February).
    expect(summary.month).toBe("1991-01");
    // Heat 80 decays 5 at the January→February boundary (no feud match), so the
    // card names the active feud rival with its post-decay heat, followed by the
    // optional opponent — the whole card in priority order.
    expect(summary.bookingLine).toBe("Booking card for 1991-02: feud vs Ladder Wrestler 1 (heat 75); optional vs Ladder Wrestler 1.");
  });

  it("surfaces the tag booking card's feud and optional items with the team rivals", () => {
    const campaign = makeTagCampaign(2000);
    const advanced = advanceCampaignDays(campaign, 31);
    const summary = buildMonthEndSummary(advanced)!;
    expect(summary.month).toBe("1991-01");
    expect(summary.division).toBe("tag");
    // Heat 90 decays to 85; the feud item is the card's top priority for t1
    // (no title held), named as the team rival, with the optional opponent after.
    expect(summary.bookingLine).toBe("Booking card for 1991-02: feud vs Team 2 (heat 85); optional vs Team 2.");
  });

  it("surfaces the tag feud title-shot term and the optional item when the feud rival holds the division title", () => {
    // M13-ADJ-03 mirror of the decisions panel: when the feud rival is the
    // world-tag champion, the booking line carries the same graded feud term
    // rollTitleShot would apply (floor(heat / 20) * 1), so the banner and the
    // panel can't drift apart. The rival (t2) defends at the end of January so
    // the title survives the Feb 1 strip.
    const campaign = makeTagCampaign(2000, { champions: { "world-tag": "t2" } });
    const worldTag = campaign.titles["world-tag"];
    worldTag.lastDefenseDate = "1991-01-31";
    worldTag.completedDefenses = worldTag.requiredDefenses;
    const advanced = advanceCampaignDays(campaign, 31);
    const summary = buildMonthEndSummary(advanced)!;
    expect(advanced.titles["world-tag"].holderId).toBe("t2");
    // Heat 90 decays to 85; floor(85 / 20) * 1 = +4, mirroring the panel term,
    // and the optional opponent (Team 3) follows in priority order.
    expect(summary.bookingLine).toBe("Booking card for 1991-02: feud vs Team 2 (heat 85; title-shot +4 feud heat 85 vs champion); optional vs Team 3.");
  });

  it("surfaces the singles feud title-shot term and the optional item when the feud rival holds the division title", () => {
    const campaign = makeSinglesCampaign(2000, { champions: { "world-heavyweight": roster()[1].id } });
    const belt = campaign.titles["world-heavyweight"];
    belt.lastDefenseDate = "1991-01-31";
    belt.completedDefenses = belt.requiredDefenses;
    const advanced = advanceCampaignDays(campaign, 31);
    const summary = buildMonthEndSummary(advanced)!;
    expect(advanced.titles["world-heavyweight"].holderId).toBe(roster()[1].id);
    // Heat 80 decays to 75; floor(75 / 20) * 1 = +3.
    expect(summary.bookingLine).toBe("Booking card for 1991-02: feud vs Ladder Wrestler 1 (heat 75; title-shot +3 feud heat 75 vs champion); optional vs Ladder Wrestler 2.");
  });

  it("surfaces the required defense item first when the player champion survives to the boundary", () => {
    // The player holds the world-heavyweight and defended at the end of January,
    // so the title survives the Feb 1 strip and the February card leads with the
    // required defense (priority 1), then the feud draw, then the optional.
    const campaign = makeSinglesCampaign(2000, { champions: { "world-heavyweight": roster()[0].id } });
    const belt = campaign.titles["world-heavyweight"];
    belt.lastDefenseDate = "1991-01-31";
    belt.completedDefenses = belt.requiredDefenses;
    const advanced = advanceCampaignDays(campaign, 31);
    const summary = buildMonthEndSummary(advanced)!;
    expect(advanced.titles["world-heavyweight"].holderId).toBe(roster()[0].id);
    expect(summary.bookingLine).toBe("Booking card for 1991-02: World Heavyweight defense vs Ladder Wrestler 1; feud vs Ladder Wrestler 1 (heat 75); optional vs Ladder Wrestler 1.");
  });

  it("leaves the line null when the booking extension is off", () => {
    const records = roster();
    const plain = createCampaign({
      name: "M13 Banner Plain",
      seed: 2000,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: records[0].id,
      playerDivision: "singles",
    });
    const advanced = advanceCampaignDays(plain, 31);
    expect(buildMonthEndSummary(advanced)!.bookingLine).toBeNull();
  });

  it("surfaces the optional item when the card has no feud item", () => {
    // Booking on but no feud involving the player: the card has no feud item,
    // yet the whole card is still readable — the optional opponent surfaces.
    const records = roster();
    const campaign = createCampaign({
      name: "M13 Banner No Feud",
      seed: 2000,
      startDate: "1991-01-01",
      roster: records,
      playerEntrantId: records[0].id,
      playerDivision: "singles",
      bookingPolicy: "feuds",
    });
    const advanced = advanceCampaignDays(campaign, 31);
    const summary = buildMonthEndSummary(advanced)!;
    expect(advanced.booking!.monthSuggestions).toHaveLength(1);
    expect(summary.bookingLine).toBe("Booking card for 1991-02: optional vs Ladder Wrestler 1.");
  });
});

describe("titleShotRollLine", () => {
  it("surfaces the +3 feud title-shot term with its heat label (M13-ADJ-03)", () => {
    const offer = makeOffer(4, [{ label: "feud heat 60 vs champion", amount: 3 }], 7);
    expect(titleShotRollLine(offer)).toBe("4 +3 feud heat 60 vs champion = 7");
  });

  it("lists every graded term with signed amounts, negative and positive", () => {
    const offer = makeOffer(6, [
      { label: "same side (tag)", amount: -3 },
      { label: "feud heat 50 vs champion", amount: 2 },
    ], 5);
    expect(titleShotRollLine(offer)).toBe("6 -3 same side (tag) +2 feud heat 50 vs champion = 5");
  });

  it("surfaces the M12 popularity heat term", () => {
    const offer = makeOffer(3, [{ label: "popularity heat 80", amount: 4 }], 7);
    expect(titleShotRollLine(offer)).toBe("3 +4 popularity heat 80 = 7");
  });

  it("renders a bare roll when the offer carries no terms", () => {
    const offer = makeOffer(9, [], 9);
    expect(titleShotRollLine(offer)).toBe("9 = 9");
  });
});
