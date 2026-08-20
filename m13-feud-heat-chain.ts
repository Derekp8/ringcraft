import {
  advanceCampaignDays,
  canonicalHash64,
  createCampaign,
  hashCampaignState,
  resolveScheduledMatchHeadless,
  scheduleCampaignMatch,
  startFeud,
} from "../src/core";
import type { CampaignState } from "../src/core";
import { makeUnderdogRecord } from "./m11-playtest-batch";

export const M13_FEUD_HEAT_CHAIN_SCHEMA = "m13-feud-heat-chain-v1" as const;
export const M13_CAPTURED_POLICY = "asw91-campaign-policy-v1" as const;

/**
 * The canonical seeded scenario for the feud-heat event chain: a tag campaign
 * where t1 starts a rivalry with t2 at heat 60, the two teams face each other
 * in a headless feud match (a deterministic time-limit draw moves heat +4 to
 * 64), and then a cold February follows — no feud match in the closing month —
 * so month-end finalization applies the -5 monthly decay to 59. All five
 * titles are deliberately left vacant so the chain exercises the feud heat
 * movement, the monthly decay, and the campaign-hash chain links in isolation:
 * no title-strip, defense, or obligation noise can shift the pinned hashes.
 */
export interface FeudHeatChainDerivation {
  name: string;
  seed: number;
  startDate: string;
  rosterSeedBase: number;
  rosterSize: number;
  playerEntrantId: string;
  playerDivision: "tag";
  champions: Record<string, null>;
  bookingPolicy: "feuds";
  feud: { entrantIds: [string, string]; label: string; initialHeat: number };
  feudMatch: { timeLimitMinutes: number };
}

export interface FeudHeatChainEvidence {
  initialCampaignHash: string;
  feudedCampaignHash: string;
  scheduledCampaignHash: string;
  committedCampaignHash: string;
  feb1CampaignHash: string;
  mar1CampaignHash: string;
  feud: { id: string; entrantIds: [string, string]; label: string; initialHeat: number };
  startFeudEvent: { preStateHash: string; postStateHash: string };
  startFeudDetail: string[];
  feudMatch: {
    matchId: string;
    date: string;
    timeLimitMinutes: number;
    method: string;
    winnerEntrantId: string | null;
    finalMatchHash: string;
  };
  heatMovement: { feudId: string; matchId: string; delta: number; from: number; to: number; reason: string };
  /** The commit-match-result detail line naming the feud heat movement — the log/panel sync invariant, like the title-shot grant line. */
  heatLine: string;
  febAdvanceEvent: { preStateHash: string; postStateHash: string };
  /** The matched month never cools: after advancing into February (no match in January is false — the feud DID match), heat is unchanged. */
  matchedMonthNoDecay: { heat: number; movementCount: number };
  decayMovement: { feudId: string; delta: number; from: number; to: number; reason: "monthly-decay" };
  decayLine: string;
  marAdvanceEvent: { preStateHash: string; postStateHash: string };
  finalFeud: { heat: number; status: string; matchCount: number; lastMatchDate: string | null };
}

export interface FeudHeatChainFixture {
  schema: typeof M13_FEUD_HEAT_CHAIN_SCHEMA;
  capturedPolicy: typeof M13_CAPTURED_POLICY;
  derivation: FeudHeatChainDerivation;
  evidence: FeudHeatChainEvidence;
  fixtureHash: string;
}

/**
 * The canonical derivation spec. Mirrors the M13 tag scenario's roster/team
 * construction (seed 1991, roster base 300, teams t1-t4) but leaves every
 * title vacant and starts the feud through the `startFeud` transaction, so the
 * chain pins the feud ledger itself: start-feud, a committed feud match, and
 * the monthly decay of a cold month. Every pinned value below is re-derived
 * from this spec, so a change to the heat tables, the decay rule, the match
 * engine outcome, or the campaign hashing fails the verifier.
 */
export const FEUD_HEAT_CHAIN_DERIVATION: FeudHeatChainDerivation = Object.freeze({
  name: "M13 Feud Heat Chain",
  seed: 1991,
  startDate: "1991-01-01",
  rosterSeedBase: 300,
  rosterSize: 8,
  playerEntrantId: "t1",
  playerDivision: "tag",
  champions: Object.freeze({
    "world-heavyweight": null,
    international: null,
    television: null,
    "world-tag": null,
    "american-tag": null,
  }),
  bookingPolicy: "feuds",
  feud: Object.freeze({ entrantIds: ["t1", "t2"] as [string, string], label: "championship tag grudge", initialHeat: 60 }),
  feudMatch: Object.freeze({ timeLimitMinutes: 6 }),
});

/** Rebuilds the campaign exactly as the M13 tag helpers do (single source of truth). */
export function buildFeudChainCampaign(derivation: FeudHeatChainDerivation): CampaignState {
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
    feuds: [],
  });
}

/**
 * Derives the feud-heat event chain deterministically: `startFeud` opens the
 * rivalry (the start-feud transaction is its own chain link), a feud match is
 * scheduled on day 1 and resolved headless (the committed result moves heat
 * and records the movement row), then the calendar advances into February —
 * the feud DID match in January, so the matched month provably never cools —
 * and then into March, where the cold February (no feud match) applies the
 * monthly decay. Mirrors the campaign-level replay contract: the campaign
 * hashes form the chain links, and each transaction's pre/post hashes are
 * recorded so every movement is pinned as fixture evidence.
 */
export function deriveFeudHeatChain(derivation: FeudHeatChainDerivation): {
  initial: CampaignState;
  feuded: CampaignState;
  scheduled: CampaignState;
  committed: CampaignState;
  feb1: CampaignState;
  mar1: CampaignState;
} {
  const initial = buildFeudChainCampaign(derivation);
  const feuded = startFeud(initial, [...derivation.feud.entrantIds] as [string, string], { label: derivation.feud.label, initialHeat: derivation.feud.initialHeat });
  const scheduled = scheduleCampaignMatch(feuded, { date: feuded.currentDate, entrantIds: [...derivation.feud.entrantIds] as [string, string], timeLimitMinutes: derivation.feudMatch.timeLimitMinutes });
  const committed = resolveScheduledMatchHeadless(scheduled, scheduled.schedule[0].id);
  const feb1 = advanceCampaignDays(committed, 31);
  const mar1 = advanceCampaignDays(feb1, 28);
  return { initial, feuded, scheduled, committed, feb1, mar1 };
}

/** Builds the fixture evidence record by re-deriving the chain from the spec. */
export function buildFeudHeatChainEvidence(derivation: FeudHeatChainDerivation): FeudHeatChainEvidence {
  const { initial, feuded, scheduled, committed, feb1, mar1 } = deriveFeudHeatChain(derivation);
  const feud = feuded.booking!.feuds[0];
  const startFeudEvent = feuded.events.find((row) => row.type === "start-feud")!;
  const scheduledRow = committed.schedule[0]!;
  const heatMovement = committed.booking!.feudHistory[0]!;
  const heatLine = committed.events
    .find((row) => row.type === "commit-match-result")!
    .detail.find((line) => line.includes(`Feud ${feud.label}`))!;
  const decayMovement = mar1.booking!.feudHistory[1]!;
  const decayLine = mar1.events
    .filter((row) => row.type === "advance-calendar")
    .flatMap((row) => row.detail)
    .find((line) => line.includes(`Feud ${feud.label} cooled`))!;
  const febAdvanceEvent = feb1.events.filter((row) => row.type === "advance-calendar").at(-1)!;
  const marAdvanceEvent = mar1.events.filter((row) => row.type === "advance-calendar").at(-1)!;
  return {
    initialCampaignHash: hashCampaignState(initial),
    feudedCampaignHash: hashCampaignState(feuded),
    scheduledCampaignHash: hashCampaignState(scheduled),
    committedCampaignHash: hashCampaignState(committed),
    feb1CampaignHash: hashCampaignState(feb1),
    mar1CampaignHash: hashCampaignState(mar1),
    feud: {
      id: feud.id,
      entrantIds: [...feud.entrantIds] as [string, string],
      label: feud.label,
      initialHeat: derivation.feud.initialHeat,
    },
    startFeudEvent: { preStateHash: startFeudEvent.preStateHash, postStateHash: startFeudEvent.postStateHash },
    startFeudDetail: startFeudEvent.detail,
    feudMatch: {
      matchId: scheduledRow.id,
      date: scheduledRow.date,
      timeLimitMinutes: scheduledRow.timeLimitMinutes,
      method: scheduledRow.result!.method,
      winnerEntrantId: scheduledRow.result!.winnerEntrantId,
      finalMatchHash: scheduledRow.result!.finalMatchHash,
    },
    heatMovement: {
      feudId: heatMovement.feudId,
      matchId: heatMovement.matchId!,
      delta: heatMovement.delta,
      from: heatMovement.from,
      to: heatMovement.to,
      reason: heatMovement.reason,
    },
    heatLine,
    febAdvanceEvent: { preStateHash: febAdvanceEvent.preStateHash, postStateHash: febAdvanceEvent.postStateHash },
    matchedMonthNoDecay: { heat: feb1.booking!.feuds[0].heat, movementCount: feb1.booking!.feudHistory.length },
    decayMovement: {
      feudId: decayMovement.feudId,
      delta: decayMovement.delta,
      from: decayMovement.from,
      to: decayMovement.to,
      reason: decayMovement.reason as "monthly-decay",
    },
    decayLine,
    marAdvanceEvent: { preStateHash: marAdvanceEvent.preStateHash, postStateHash: marAdvanceEvent.postStateHash },
    finalFeud: {
      heat: mar1.booking!.feuds[0].heat,
      status: mar1.booking!.feuds[0].status,
      matchCount: mar1.booking!.feuds[0].matchCount,
      lastMatchDate: mar1.booking!.feuds[0].lastMatchDate,
    },
  };
}

/** Canonical hash over every pinned field of the fixture (excludes only `fixtureHash`). */
export function fixtureContentHash(fixture: FeudHeatChainFixture): string {
  const { fixtureHash: _fixtureHash, ...content } = fixture;
  return canonicalHash64(content);
}

/** Builds the full fixture fresh from the canonical derivation spec. */
export function buildFeudHeatChainFixture(): FeudHeatChainFixture {
  const fixture: FeudHeatChainFixture = {
    schema: M13_FEUD_HEAT_CHAIN_SCHEMA,
    capturedPolicy: M13_CAPTURED_POLICY,
    derivation: {
      ...FEUD_HEAT_CHAIN_DERIVATION,
      champions: { ...FEUD_HEAT_CHAIN_DERIVATION.champions },
      feud: { ...FEUD_HEAT_CHAIN_DERIVATION.feud, entrantIds: [...FEUD_HEAT_CHAIN_DERIVATION.feud.entrantIds] as [string, string] },
      feudMatch: { ...FEUD_HEAT_CHAIN_DERIVATION.feudMatch },
    },
    evidence: buildFeudHeatChainEvidence(FEUD_HEAT_CHAIN_DERIVATION),
    fixtureHash: "",
  };
  fixture.fixtureHash = fixtureContentHash(fixture);
  return fixture;
}
