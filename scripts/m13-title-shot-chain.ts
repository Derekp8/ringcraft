import {
  advanceCampaignDays,
  canonicalHash64,
  createCampaign,
  grantExtraTitleShot,
  hashCampaignState,
  respondToTitleShot,
  resolveScheduledMatchHeadless,
  rollTitleShot,
  titleShotExtraGrantLine,
  titleShotGrantLine,
  titleShotRollLine,
} from "../src/core";
import type { CampaignState, CampaignTitleId } from "../src/core";
import { makeUnderdogRecord } from "./m11-playtest-batch";

export const M13_TITLE_SHOT_CHAIN_SCHEMA = "m13-title-shot-chain-v1" as const;
export const M13_CAPTURED_POLICY = "asw91-campaign-policy-v1" as const;

/** The canonical seeded scenario: a tag campaign where t1 holds the world-tag and feuds with top-ranked t2. */
export interface TitleShotChainDerivation {
  name: string;
  seed: number;
  startDate: string;
  rosterSeedBase: number;
  rosterSize: number;
  playerEntrantId: string;
  playerDivision: "tag";
  champions: Record<string, string>;
  bookingPolicy: "feuds";
  feud: { entrantIds: [string, string]; label: string; initialHeat: number };
}

export interface TitleShotChainEvidence {
  initialCampaignHash: string;
  rolledCampaignHash: string;
  declinedCampaignHash: string;
  acceptedCampaignHash: string;
  offer: {
    id: string;
    titleId: CampaignTitleId;
    candidateId: string;
    rawRoll: number;
    modifiedRoll: number;
    modifiers: Array<{ label: string; amount: number }>;
  };
  rollLine: string;
  /** The grant-event line the log records and the decisions panel surfaces — the shared `titleShotGrantLine` helper's output, pinned as first-class deterministic evidence. */
  grantLine: string;
  grantDetail: string[];
  declineDetail: string[];
  acceptDetail: string[];
  declineEvent: { preStateHash: string; postStateHash: string };
  acceptEvent: { preStateHash: string; postStateHash: string };
  scheduledDefense: { date: string; entrantIds: string[]; titleId: CampaignTitleId; mandatoryDefense: boolean };
  /**
   * M13 manual-booking leg, symmetric to the rolled chain: the champion plays
   * the accepted offer's mandatory defense (retains, obligation 1/1 complete),
   * then grants a challenger an extra title shot via `grantExtraTitleShot`.
   * The schedule event's consolidated extra-shot grant line, the committed
   * defense outcome, and the pre/post hashes are pinned like the rolled path.
   */
  defendedCampaignHash: string;
  extraGrantCampaignHash: string;
  defense: { matchId: string; date: string; method: string; winnerEntrantId: string | null; finalMatchHash: string; completedDefenses: number; requiredDefenses: number };
  extraShot: { matchId: string; date: string; titleId: CampaignTitleId; candidateId: string; mandatoryDefense: boolean };
  extraGrantLine: string;
  extraGrantDetail: string[];
  extraGrantEvent: { preStateHash: string; postStateHash: string };
}

export interface TitleShotChainFixture {
  schema: typeof M13_TITLE_SHOT_CHAIN_SCHEMA;
  capturedPolicy: typeof M13_CAPTURED_POLICY;
  derivation: TitleShotChainDerivation;
  evidence: TitleShotChainEvidence;
  fixtureHash: string;
}

/**
 * The canonical derivation spec. Mirrors the M13 tag-champion scenario pinned in
 * tests/m13-feud-booking.test.ts (`tagChampionCampaign(1991, 60)`): t1 holds the
 * world-tag title, t2 is the top-ranked feud rival at heat 60, and the player
 * runs the tag division. Every pinned value below is re-derived from this spec,
 * so a change to the title-shot grading, the feud term, the offer id derivation,
 * or the scheduling rule fails the verifier.
 */
export const TITLE_SHOT_CHAIN_DERIVATION: TitleShotChainDerivation = Object.freeze({
  name: "M13 Tag Term",
  seed: 1991,
  startDate: "1991-01-01",
  rosterSeedBase: 300,
  rosterSize: 8,
  playerEntrantId: "t1",
  playerDivision: "tag",
  champions: { "world-tag": "t1", "american-tag": "t3" },
  bookingPolicy: "feuds",
  feud: { entrantIds: ["t1", "t2"] as [string, string], label: "championship tag grudge", initialHeat: 60 },
});

/** Rebuilds the campaign exactly as the M13 test helper does (single source of truth). */
export function buildChainCampaign(derivation: TitleShotChainDerivation): CampaignState {
  const records = Array.from({ length: derivation.rosterSize }, (_, index) => makeUnderdogRecord(derivation.rosterSeedBase + index, index));
  const teams = [0, 1, 2, 3].map((index) => ({
    id: `t${index + 1}`,
    name: `Team ${index + 1}`,
    memberIds: [records[index * 2].id, records[index * 2 + 1].id] as [string, string],
    side: records[index * 2].side,
  }));
  return createCampaign({
    name: derivation.name,
    seed: derivation.seed,
    startDate: derivation.startDate,
    roster: records,
    teams,
    playerEntrantId: derivation.playerEntrantId,
    playerDivision: derivation.playerDivision,
    champions: { ...derivation.champions },
    bookingPolicy: derivation.bookingPolicy,
    feuds: [{ entrantIds: [...derivation.feud.entrantIds] as [string, string], label: derivation.feud.label, initialHeat: derivation.feud.initialHeat }],
  });
}

/**
 * Derives the respond-title-shot event chain deterministically: grant the offer
 * (roll-title-shot), then resolve it twice from the same rolled state — a
 * decline (candidate traversal may continue) and an accept (schedules the
 * mandatory title defense). The manual-booking leg then plays the mandatory
 * defense from the accepted state (the champion retains and completes the
 * obligation), and grants an extra title shot via `grantExtraTitleShot` — the
 * champion-granted path's own transaction, symmetric to the rolled chain.
 * Mirrors the campaign-level replay contract: the campaign hashes form the
 * chain links, and the respond events' pre/post hashes are recorded so every
 * resolution is pinned as fixture evidence.
 */
export function deriveTitleShotChain(derivation: TitleShotChainDerivation): {
  initial: CampaignState;
  rolled: CampaignState;
  declined: CampaignState;
  accepted: CampaignState;
  defended: CampaignState;
  extra: CampaignState;
} {
  const initial = buildChainCampaign(derivation);
  const rolled = rollTitleShot(initial, "world-tag");
  const offer = rolled.titleShotOffers.at(-1);
  if (!offer) throw new Error("rollTitleShot granted no offer for the pinned scenario.");
  const declined = respondToTitleShot(rolled, offer.id, false);
  const accepted = respondToTitleShot(rolled, offer.id, true);
  // The mandatory defense is scheduled for the day after the roll; play it on
  // its date so the world-tag obligation (1/1 in this pinned January) completes.
  const day2 = advanceCampaignDays(accepted, 1);
  const defense = accepted.schedule.at(-1)!;
  const defended = resolveScheduledMatchHeadless(day2, defense.id);
  // The manual-booking leg: the champion grants the top-ranked non-champion an
  // extra shot (the same challenger rule the campaign tests use), scheduled one
  // day later by grantExtraTitleShot's default date.
  const champion = defended.titles["world-tag"].holderId!;
  const challenger = defended.rankings.tag.entries.find((row) => row.entrantId !== champion)!.entrantId;
  const extra = grantExtraTitleShot(defended, "world-tag", challenger);
  return { initial, rolled, declined, accepted, defended, extra };
}

/** Builds the fixture evidence record by re-deriving the chain from the spec. */
export function buildTitleShotChainEvidence(derivation: TitleShotChainDerivation): TitleShotChainEvidence {
  const { initial, rolled, declined, accepted, defended, extra } = deriveTitleShotChain(derivation);
  const offer = rolled.titleShotOffers.at(-1)!;
  const titleId = offer.titleId;
  const grantEvent = rolled.events.find((row) => row.type === "roll-title-shot")!;
  const declineEvent = declined.events.find((row) => row.type === "respond-title-shot")!;
  const acceptEvent = accepted.events.find((row) => row.type === "respond-title-shot")!;
  const scheduledDefense = accepted.schedule.at(-1)!;
  const committedDefense = defended.schedule.find((row) => row.id === scheduledDefense.id)!;
  // The extra-shot grant is the newest transaction, so its schedule-match event
  // is the last one in the accumulated event log (the accept path's mandatory
  // defense scheduling precedes it).
  const extraGrantEvent = extra.events.filter((row) => row.type === "schedule-match").at(-1)!;
  const extraShot = extra.schedule.at(-1)!;
  const champion = defended.titles["world-tag"].holderId!;
  const challenger = defended.rankings.tag.entries.find((row) => row.entrantId !== champion)!.entrantId;
  return {
    initialCampaignHash: hashCampaignState(initial),
    rolledCampaignHash: hashCampaignState(rolled),
    declinedCampaignHash: hashCampaignState(declined),
    acceptedCampaignHash: hashCampaignState(accepted),
    offer: {
      id: offer.id,
      titleId,
      candidateId: offer.candidateId,
      rawRoll: offer.rawRoll,
      modifiedRoll: offer.modifiedRoll,
      modifiers: offer.modifiers.map((row) => ({ label: row.label, amount: row.amount })),
    },
    rollLine: titleShotRollLine(offer),
    grantLine: titleShotGrantLine(offer, offer.candidateId, rolled.titles[offer.titleId].name),
    grantDetail: grantEvent.detail,
    declineDetail: declineEvent.detail,
    acceptDetail: acceptEvent.detail,
    declineEvent: { preStateHash: declineEvent.preStateHash, postStateHash: declineEvent.postStateHash },
    acceptEvent: { preStateHash: acceptEvent.preStateHash, postStateHash: acceptEvent.postStateHash },
    scheduledDefense: {
      date: scheduledDefense.date,
      entrantIds: [...scheduledDefense.entrantIds],
      titleId: scheduledDefense.titleId ?? titleId,
      mandatoryDefense: scheduledDefense.mandatoryDefense ?? false,
    },
    defendedCampaignHash: hashCampaignState(defended),
    extraGrantCampaignHash: hashCampaignState(extra),
    defense: {
      matchId: committedDefense.id,
      date: committedDefense.date,
      method: committedDefense.result!.method,
      winnerEntrantId: committedDefense.result!.winnerEntrantId,
      finalMatchHash: committedDefense.result!.finalMatchHash,
      completedDefenses: defended.titles["world-tag"].completedDefenses,
      requiredDefenses: defended.titles["world-tag"].requiredDefenses,
    },
    extraShot: {
      matchId: extraShot.id,
      date: extraShot.date,
      titleId: extraShot.titleId ?? "world-tag",
      candidateId: challenger,
      mandatoryDefense: extraShot.mandatoryDefense ?? false,
    },
    extraGrantLine: titleShotExtraGrantLine(challenger, defended.titles["world-tag"].name, defended.titles["world-tag"].completedDefenses, defended.titles["world-tag"].requiredDefenses),
    extraGrantDetail: extraGrantEvent.detail,
    extraGrantEvent: { preStateHash: extraGrantEvent.preStateHash, postStateHash: extraGrantEvent.postStateHash },
  };
}

/** Canonical hash over every pinned field of the fixture (excludes only `fixtureHash`). */
export function fixtureContentHash(fixture: TitleShotChainFixture): string {
  const { fixtureHash: _fixtureHash, ...content } = fixture;
  return canonicalHash64(content);
}

/** Builds the full fixture fresh from the canonical derivation spec. */
export function buildTitleShotChainFixture(): TitleShotChainFixture {
  const fixture: TitleShotChainFixture = {
    schema: M13_TITLE_SHOT_CHAIN_SCHEMA,
    capturedPolicy: M13_CAPTURED_POLICY,
    derivation: { ...TITLE_SHOT_CHAIN_DERIVATION, feud: { ...TITLE_SHOT_CHAIN_DERIVATION.feud, entrantIds: [...TITLE_SHOT_CHAIN_DERIVATION.feud.entrantIds] as [string, string] } },
    evidence: buildTitleShotChainEvidence(TITLE_SHOT_CHAIN_DERIVATION),
    fixtureHash: "",
  };
  fixture.fixtureHash = fixtureContentHash(fixture);
  return fixture;
}
