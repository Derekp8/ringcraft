import {
  BOOKING_POLICY_VERSION,
  CAMPAIGN_RULESET_VERSION,
  CAMPAIGN_SCHEMA_VERSION,
  CAMPAIGN_TITLES,
  FEUD_DECAY_TABLE,
  FEUD_HEAT_TABLE,
  FEUD_TITLE_SHOT_TERM,
  FINANCE_POLICY_VERSION,
  NEGOTIATION_POLICY_VERSION,
  NEGOTIATION_RULES,
  M5_DATA_HASH,
  M5_DATA_PACK_VERSION,
  PAYOUT_SCHEDULE,
  POPULARITY_MOVEMENT_TABLE,
  POST_MATCH_INJURY_POLICY_VERSION,
  RATING_LIMITS,
  TITLE_SHOT_POPULARITY_RULES,
  UNRANKED_PRIOR_RANK,
  acceptanceThreshold,
  chemistryTagRatingBonus,
  contractActiveOn,
  expectedWeeklySalary,
  feudHeatDelta,
  feudTitleShotTerm,
  offerVerdict,
  postMatchInjuryEligible,
  popularityDelta,
  previousRankBonus,
  ratingPoints,
  ratingResultKind,
  requiredDefensesForRoll,
  resolvePostMatchInjury,
  titleCanChangeOnMethod,
  titleShotModifier,
  titleShotPopularityHeat,
  titleShotStartingRank,
} from "./campaign-rules";
import { careerRecordToDefinition } from "./creation";
import { startingDamage } from "./derived";
import { AI_DIFFICULTIES, chooseDeterministicPolicyAction } from "./ai";
import { MATCH_VARIETIES } from "./types";
import { advanceUntilPlayerDecision, createMatch, replayFromInputLog, submitPlayerIntent } from "./engine";
import { canonicalHash64, fnv1a32, hashMatchState } from "./hash";
import { createProgressionState, applyProgression } from "./progression";
import { createRng, generateRandomSeed, rollRngDie } from "./prng";
import type { RandomUint32Source } from "./prng";
import { RULESET_VERSION } from "./rules";
import { validateWrestlerRecord } from "./serialization";
import type {
  AiDifficulty,
  BookingState,
  CampaignAiDecision,
  CampaignConfig,
  CampaignDivision,
  CampaignEntrantId,
  CampaignEvent,
  CampaignInjury,
  CampaignState,
  CampaignTitleId,
  ChemistryPair,
  ContractOffer,
  DieRoll,
  Feud,
  FeudHeatMovement,
  FinanceState,
  NegotiationState,
  MatchResult,
  MatchState,
  MatchVariety,
  MonthBookingSuggestion,
  PayoutRecord,
  PersistentTeam,
  PopularityMovement,
  RankingEntry,
  RankingTable,
  ScheduledMatch,
  Side,
  TitleShotOffer,
  TitleState,
  VacancyCompetition,
  WrestlerCareerRecord,
  WrestlerContract,
} from "./types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid calendar date ${value}; expected YYYY-MM-DD.`);
  return date;
}

export function addCalendarDays(value: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error("Calendar advance must use a whole number of days.");
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function campaignMonth(value: string): string {
  parseDate(value);
  return value.slice(0, 7);
}

function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).valueOf() - parseDate(from).valueOf()) / 86_400_000);
}

function lastDayOfMonth(value: string): string {
  const date = parseDate(value);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}-${fnv1a32(value)}`;
}

function normalizedSchedule(state: CampaignState): unknown[] {
  return state.schedule.map((row) => ({ ...row, finalMatchState: row.finalMatchState ? hashMatchState(row.finalMatchState) : null }));
}

export function hashCampaignState(state: CampaignState): string {
  const { events: _events, activeMatch, schedule: _schedule, ...rest } = state;
  const semanticSaveValue = { ...rest, schedule: normalizedSchedule(state), activeMatch: activeMatch ? hashMatchState(activeMatch) : null };
  // JSON omits object properties whose value is undefined. Normalize to that
  // durable representation so an atomic save/reload cannot create hash drift.
  return canonicalHash64(JSON.parse(JSON.stringify(semanticSaveValue)) as unknown);
}

type CampaignMutator = (draft: CampaignState, dice: DieRoll[], detail: string[]) => string;

function transact(source: CampaignState, type: string, input: Record<string, unknown>, mutate: CampaignMutator): CampaignState {
  const draft = clone(source);
  const preStateHash = hashCampaignState(draft);
  const dice: DieRoll[] = [];
  const detail: string[] = [];
  const summary = mutate(draft, dice, detail);
  draft.updatedAt = draft.currentDate;
  const errors = validateCampaignState(draft);
  if (errors.length) throw new Error(`Campaign transaction rejected:\n${errors.join("\n")}`);
  const postStateHash = hashCampaignState(draft);
  const event: CampaignEvent = {
    sequence: draft.events.length + 1,
    id: stableId("career-event", { campaignId: draft.campaignId, sequence: draft.events.length + 1, type, input, preStateHash, postStateHash }),
    date: draft.currentDate,
    type,
    input: clone(input),
    summary,
    detail,
    dice,
    preStateHash,
    postStateHash,
  };
  draft.events.push(event);
  return draft;
}

function teamWp(state: CampaignState, team: PersistentTeam): number {
  return Math.floor(team.memberIds.reduce((sum, id) => sum + state.roster[id].careerWp, 0) / 2);
}

export function campaignEntrantWp(state: CampaignState, division: CampaignDivision, entrantId: CampaignEntrantId): number {
  if (division === "singles") {
    const record = state.roster[entrantId];
    if (!record) throw new Error(`Unknown singles entrant ${entrantId}.`);
    return record.careerWp;
  }
  const team = state.teams[entrantId];
  if (!team) throw new Error(`Unknown tag entrant ${entrantId}.`);
  return teamWp(state, team);
}

export function campaignEntrantSide(state: CampaignState, division: CampaignDivision, entrantId: CampaignEntrantId): Side {
  if (division === "singles") {
    const record = state.roster[entrantId];
    if (!record) throw new Error(`Unknown singles entrant ${entrantId}.`);
    return record.side;
  }
  const team = state.teams[entrantId];
  if (!team) throw new Error(`Unknown tag entrant ${entrantId}.`);
  return team.side;
}

function entrantIds(state: CampaignState, division: CampaignDivision): CampaignEntrantId[] {
  return division === "singles" ? Object.keys(state.roster) : Object.values(state.teams).filter((row) => row.active).map((row) => row.id);
}

/**
 * The entrant kind of a feud participant: a roster wrestler is a singles
 * entrant, a persistent team is a tag entrant. M13-ADJ-04: a feud must pair
 * two entrants of the same kind — a mixed wrestler-vs-team feud has no
 * division-consistent rival to resolve at month-end booking, so it is rejected
 * at every creation path (config and startFeud) and by validation.
 */
function entrantKind(roster: Record<string, unknown>, teams: Record<string, unknown>, entrantId: CampaignEntrantId): "singles" | "tag" {
  if (roster[entrantId]) return "singles";
  if (teams[entrantId]) return "tag";
  throw new Error(`Unknown feud entrant ${entrantId}.`);
}

function wrestlerIdsForEntrant(state: CampaignState, division: CampaignDivision, entrantId: CampaignEntrantId): string[] {
  if (division === "singles") {
    if (!state.roster[entrantId]) throw new Error(`Unknown wrestler entrant ${entrantId}.`);
    return [entrantId];
  }
  const team = state.teams[entrantId];
  if (!team?.active) throw new Error(`Unknown or inactive team entrant ${entrantId}.`);
  return [...team.memberIds];
}

/**
 * M12-ADJ-04: tracked popularity for an entrant — singles use the wrestler's
 * stat; tag teams use the rounded mean of their members. Falls back to the flat
 * baseline 50 when the finance extension is off or a member is untracked.
 */
function entrantPopularity(state: CampaignState, division: CampaignDivision, entrantId: CampaignEntrantId): number {
  const finance = state.finance;
  if (!finance) return 50;
  const ids = wrestlerIdsForEntrant(state, division, entrantId);
  const pops = ids.map((id) => finance.popularity[id] ?? 50);
  return Math.round(pops.reduce((sum, pop) => sum + pop, 0) / pops.length);
}

function worldTitleId(division: CampaignDivision): CampaignTitleId {
  return division === "singles" ? "world-heavyweight" : "world-tag";
}

function secondaryTitleId(division: CampaignDivision): CampaignTitleId {
  return division === "singles" ? "international" : "american-tag";
}

function currentRank(state: CampaignState, division: CampaignDivision, entrantId: CampaignEntrantId): number {
  if (state.titles[worldTitleId(division)].holderId === entrantId) return 0;
  return state.rankings[division].entries.find((row) => row.entrantId === entrantId)?.rank ?? UNRANKED_PRIOR_RANK[division];
}

function heldTitles(state: CampaignState, entrantId: CampaignEntrantId): CampaignTitleId[] {
  return (Object.values(state.titles) as TitleState[]).filter((title) => title.holderId === entrantId).map((title) => title.id);
}

function reorderGuaranteed(state: CampaignState, division: CampaignDivision, ordered: CampaignEntrantId[]): CampaignEntrantId[] {
  const worldHolder = state.titles[worldTitleId(division)].holderId;
  let rows = ordered.filter((id) => id !== worldHolder);
  const secondaryHolder = state.titles[secondaryTitleId(division)].holderId;
  if (secondaryHolder) rows = [secondaryHolder, ...rows.filter((id) => id !== secondaryHolder)];
  if (division === "singles") {
    const television = state.titles.television.holderId;
    if (television && !rows.slice(0, RATING_LIMITS.singles).includes(television)) {
      rows = [...rows.filter((id) => id !== television).slice(0, RATING_LIMITS.singles - 1), television, ...rows.filter((id) => id !== television).slice(RATING_LIMITS.singles - 1)];
    }
  }
  return rows;
}

function initialRanking(state: CampaignState, division: CampaignDivision): RankingTable {
  const ordered = reorderGuaranteed(state, division, entrantIds(state, division).sort((left, right) => campaignEntrantWp(state, division, right) - campaignEntrantWp(state, division, left) || left.localeCompare(right)));
  const limit = RATING_LIMITS[division];
  const entries = ordered.slice(0, limit).map<RankingEntry>((entrantId, index) => ({
    entrantId,
    rank: index + 1,
    priorRank: index + 1,
    matchPoints: 0,
    priorRankBonus: previousRankBonus(division, index + 1),
    totalPoints: previousRankBonus(division, index + 1),
    totalWp: campaignEntrantWp(state, division, entrantId),
    tiebreakRolls: [],
  }));
  return {
    id: stableId("ranking", { campaignId: state.campaignId, month: campaignMonth(state.currentDate), division, entries }),
    month: campaignMonth(state.currentDate),
    division,
    championId: state.titles[worldTitleId(division)].holderId,
    entries,
    finalizedAt: state.currentDate,
    formula: "Initial table: total WP, stable ID; championship guaranteed placements applied.",
  };
}

function makeTeam(state: Pick<CampaignState, "roster">, source: Pick<PersistentTeam, "id" | "name" | "memberIds" | "side">): PersistentTeam {
  if (!source.id.trim() || !source.name.trim()) throw new Error("Persistent team ID and name are required.");
  if (source.memberIds[0] === source.memberIds[1]) throw new Error(`Team ${source.id} contains the same wrestler twice.`);
  for (const id of source.memberIds) if (!state.roster[id]) throw new Error(`Team ${source.id} references missing wrestler ${id}.`);
  return { ...clone(source), active: true, careerWp: 0, currentRank: null, titleIds: [], titleShotHistory: [], matchHistory: [] };
}

function defaultChampion(champions: CampaignConfig["champions"], id: CampaignTitleId, candidates: CampaignEntrantId[], index: number): CampaignEntrantId | null {
  if (champions && Object.prototype.hasOwnProperty.call(champions, id)) return champions[id] ?? null;
  return candidates[index] ?? null;
}

function createTitle(id: CampaignTitleId, holderId: CampaignEntrantId | null, date: string): TitleState {
  const definition = CAMPAIGN_TITLES[id];
  return {
    id,
    name: definition.name,
    division: definition.division,
    hierarchy: definition.hierarchy,
    holderId,
    status: holderId ? "active" : "vacant",
    wonDate: holderId ? date : null,
    lastDefenseDate: holderId ? date : null,
    obligationMonth: campaignMonth(date),
    requiredDefenses: 0,
    completedDefenses: 0,
    shotsReceived: {},
    history: [{ date, type: "created", entrantId: holderId, detail: holderId ? `Initial holder ${holderId}.` : "Created vacant." }],
  };
}

function validateTitleHolder(state: CampaignState, title: TitleState): void {
  if (!title.holderId) return;
  const valid = title.division === "singles" ? Boolean(state.roster[title.holderId]) : Boolean(state.teams[title.holderId]?.active);
  if (!valid) throw new Error(`${title.name} holder ${title.holderId} is not a valid ${title.division} entrant.`);
}

function buildFinanceState(config: CampaignConfig, roster: Record<string, WrestlerCareerRecord>, startDate: string): FinanceState {
  const contracts: Record<string, WrestlerContract> = {};
  for (const source of config.contracts ?? []) {
    if (!roster[source.wrestlerId]) throw new Error(`Contract references missing wrestler ${source.wrestlerId}.`);
    if (!Number.isInteger(source.weeklySalary) || source.weeklySalary <= 0) throw new Error(`Contract ${source.wrestlerId} requires a positive whole weekly salary.`);
    if (!Number.isInteger(source.termWeeks) || source.termWeeks < 1) throw new Error(`Contract ${source.wrestlerId} requires a positive whole term in weeks.`);
    const bonus = source.signingBonus ?? 0;
    if (!Number.isInteger(bonus) || bonus < 0) throw new Error(`Contract ${source.wrestlerId} signing bonus must be a non-negative whole number.`);
    if (contracts[source.wrestlerId]) throw new Error(`Duplicate contract for ${source.wrestlerId}.`);
    contracts[source.wrestlerId] = { wrestlerId: source.wrestlerId, weeklySalary: source.weeklySalary, termWeeks: source.termWeeks, startDate, signingBonus: bonus };
  }
  const chemistry: ChemistryPair[] = [];
  for (const pair of config.chemistry ?? []) {
    const [a, b] = pair.memberIds;
    if (!roster[a] || !roster[b]) throw new Error(`Chemistry pair ${a}/${b} references a missing wrestler.`);
    if (a === b) throw new Error(`Chemistry pair ${a}/${b} must use two different wrestlers.`);
    if (!pair.label.trim()) throw new Error(`Chemistry pair ${a}/${b} requires a label.`);
    chemistry.push({ memberIds: [a, b], label: pair.label });
  }
  const ledgers: Record<string, number> = {};
  const payouts: PayoutRecord[] = [];
  for (const contract of Object.values(contracts)) {
    if (contract.signingBonus <= 0) continue;
    ledgers[contract.wrestlerId] = (ledgers[contract.wrestlerId] ?? 0) + contract.signingBonus;
    payouts.push({ date: startDate, weekIndex: 0, entries: [{ wrestlerId: contract.wrestlerId, amount: contract.signingBonus }], total: contract.signingBonus });
  }
  const popularity: Record<string, number> = {};
  for (const id of Object.keys(roster)) popularity[id] = 50;
  return {
    policyVersion: FINANCE_POLICY_VERSION,
    nextPayoutDate: addCalendarDays(startDate, PAYOUT_SCHEDULE.cadenceDays),
    contracts,
    chemistry,
    ledgers,
    payouts,
    popularity,
    popularityHistory: [],
  };
}

/** Build the M12 negotiation ledger when the negotiation extension is enabled. */
function buildNegotiationState(): NegotiationState {
  return { policyVersion: NEGOTIATION_POLICY_VERSION, offers: [], history: [] };
}

interface ResolveOfferInput {
  wrestlerId: string;
  weeklySalary: number;
  termWeeks: number;
  signingBonus: number;
  reason: ContractOffer["reason"];
}

/**
 * M12-ADJ-06/08: resolve one contract offer deterministically against the
 * wrestler's salary-curve expectation and record the response. A fair offer
 * (>= 100% of expectation) auto-accepts; a low offer (< 60%) auto-rejects; a
 * short offer resolves on a recorded D20 whose accept threshold scales linearly
 * between the two bands. Accepted offers sign the contract immediately (a
 * signing bonus is credited to the ledger and payouts). Pure state mutation
 * shared by the offerContract transaction and expiry re-signing, so both paths
 * produce identical acceptance semantics.
 */
function resolveContractOfferCore(draft: CampaignState, input: ResolveOfferInput, dice: DieRoll[], detail: string[]): ContractOffer {
  const negotiation = draft.negotiation!;
  const finance = draft.finance!;
  const record = draft.roster[input.wrestlerId];
  const popularity = finance.popularity[input.wrestlerId] ?? 50;
  const expected = expectedWeeklySalary(popularity);
  const verdict = offerVerdict(input.weeklySalary, expected);
  const threshold = verdict === "short" ? acceptanceThreshold(input.weeklySalary, expected) : 0;
  let status: ContractOffer["status"];
  let accepted: boolean;
  let basis: string;
  if (verdict === "fair") {
    status = "accepted";
    accepted = true;
    basis = `Fair offer: $${input.weeklySalary}/week meets the $${expected} expectation for popularity ${popularity}.`;
  } else if (verdict === "low") {
    status = "rejected";
    accepted = false;
    basis = `Low offer: $${input.weeklySalary}/week is under the $${expected} expectation for popularity ${popularity}; the wrestler rejects.`;
  } else {
    const roll = rollRngDie(draft.rng, NEGOTIATION_RULES.acceptanceDie, `contract negotiation ${input.wrestlerId}`, dice);
    accepted = roll <= threshold;
    status = accepted ? "accepted" : "rejected";
    basis = `Short offer: $${input.weeklySalary}/week vs the $${expected} expectation for popularity ${popularity} (D20 ${roll} ${accepted ? "≤" : ">"} ${threshold} ${accepted ? "accepted" : "rejected"}).`;
  }
  const offer: ContractOffer = {
    id: stableId("contract-offer", { campaignId: draft.campaignId, wrestlerId: input.wrestlerId, weeklySalary: input.weeklySalary, termWeeks: input.termWeeks, signingBonus: input.signingBonus, expected, reason: input.reason, sequence: negotiation.offers.length }),
    wrestlerId: input.wrestlerId,
    weeklySalary: input.weeklySalary,
    termWeeks: input.termWeeks,
    signingBonus: input.signingBonus,
    offeredAt: draft.currentDate,
    expectedSalary: expected,
    status,
    reason: input.reason,
    basis,
    resolvedAt: draft.currentDate,
  };
  negotiation.offers.push(offer);
  negotiation.history.push({ date: draft.currentDate, wrestlerId: input.wrestlerId, type: accepted ? "accepted" : "rejected", offerId: offer.id, weeklySalary: input.weeklySalary, expectedSalary: expected, basis });
  if (accepted) {
    finance.contracts[input.wrestlerId] = { wrestlerId: input.wrestlerId, weeklySalary: input.weeklySalary, termWeeks: input.termWeeks, startDate: draft.currentDate, signingBonus: input.signingBonus };
    if (input.signingBonus > 0) {
      finance.ledgers[input.wrestlerId] = (finance.ledgers[input.wrestlerId] ?? 0) + input.signingBonus;
      finance.payouts.push({ date: draft.currentDate, weekIndex: 0, entries: [{ wrestlerId: input.wrestlerId, amount: input.signingBonus }], total: input.signingBonus });
    }
    detail.push(`${record.name}: ${basis}`, `${record.name}: signed a ${input.termWeeks}-week contract at $${input.weeklySalary}/week${input.signingBonus > 0 ? ` with a $${input.signingBonus} signing bonus` : ""}.`);
  } else {
    detail.push(`${record.name}: ${basis}`);
  }
  return offer;
}

/**
 * M12-ADJ-08: offer the expiring wrestler a renewal at the expiring salary on
 * the first day their contract is inactive and resolve it with the same
 * acceptance rule, so a wrestler who outgrew their deal (popularity up, salary
 * flat) may walk. Deterministic — consumes only the recorded negotiation die.
 *
 * M12-ADJ-09: with renewalStrategy "curve-fair", the campaign AI preemptively
 * matches the salary-curve expectation whenever the expiring rate graded below
 * fair (popularity outgrew the salary), so the wrestler re-signs at the curve
 * instead of walking. The bump lands exactly on the fair threshold, so it
 * auto-accepts and consumes zero dice; already-fair expiring salaries are
 * offered unchanged, keeping those renewals byte-identical to the default.
 */
function evaluateContractRenewal(draft: CampaignState, contract: WrestlerContract, dice: DieRoll[], detail: string[]): void {
  const popularity = draft.finance!.popularity[contract.wrestlerId] ?? 50;
  const expected = expectedWeeklySalary(popularity);
  const outgrown = offerVerdict(contract.weeklySalary, expected) !== "fair";
  const weeklySalary = draft.renewalStrategy === "curve-fair" && outgrown ? expected : contract.weeklySalary;
  resolveContractOfferCore(draft, { wrestlerId: contract.wrestlerId, weeklySalary, termWeeks: contract.termWeeks, signingBonus: 0, reason: "renewal" }, dice, detail);
  if (draft.renewalStrategy === "curve-fair" && outgrown) {
    detail.push(`${draft.roster[contract.wrestlerId].name}: campaign AI matched the $${expected} salary-curve expectation to re-sign the outgrown contract (M12-ADJ-09).`);
  }
}

function applyWeeklyPayout(draft: CampaignState, detail: string[]): void {
  const finance = draft.finance!;
  const entries: Array<{ wrestlerId: string; amount: number }> = [];
  let total = 0;
  for (const contract of Object.values(finance.contracts)) {
    if (!contractActiveOn(contract, draft.currentDate)) continue;
    entries.push({ wrestlerId: contract.wrestlerId, amount: contract.weeklySalary });
    total += contract.weeklySalary;
    finance.ledgers[contract.wrestlerId] = (finance.ledgers[contract.wrestlerId] ?? 0) + contract.weeklySalary;
  }
  const weekIndex = Math.round(daysBetween(draft.startDate, draft.currentDate) / PAYOUT_SCHEDULE.cadenceDays);
  if (!entries.length) {
    detail.push(`Weekly payout on ${draft.currentDate}: no active contracts; next payout ${finance.nextPayoutDate}.`);
  } else {
    finance.payouts.push({ date: draft.currentDate, weekIndex, entries, total });
    detail.push(`Weekly payout on ${draft.currentDate} (week ${weekIndex}): ${entries.map((row) => `${draft.roster[row.wrestlerId].name} $${row.amount}`).join(", ")}.`);
  }
  finance.nextPayoutDate = addCalendarDays(finance.nextPayoutDate, PAYOUT_SCHEDULE.cadenceDays);
}

/** True when the exact two-member set forms a configured chemistry pair (M12-ADJ-03/05). */
function isChemistryPair(finance: { chemistry: Array<{ memberIds: string[] }> }, memberIds: string[]): boolean {
  return finance.chemistry.some((pair) => pair.memberIds.slice().sort().join("|") === memberIds.slice().sort().join("|"));
}

function applyPopularityMovement(draft: CampaignState, scheduled: ScheduledMatch, result: MatchResult, detail: string[]): void {
  const finance = draft.finance!;
  const scale = POPULARITY_MOVEMENT_TABLE.scale;
  const titleMatch = Boolean(scheduled.titleId || scheduled.vacancyTitleId);
  for (const sideIndex of [0, 1] as const) {
    const won = entrantWon(result, sideIndex);
    const ids = scheduled.wrestlerIds[sideIndex];
    const chemistryTagWin =
      won === true && scheduled.mode === "tag" && ids.length === 2 && isChemistryPair(finance, ids);
    for (const wrestlerId of ids) {
      const delta = popularityDelta(won, result.method, titleMatch, chemistryTagWin);
      if (delta === 0) continue;
      const from = finance.popularity[wrestlerId] ?? 50;
      const to = Math.max(scale.floor, Math.min(scale.ceiling, from + delta));
      finance.popularity[wrestlerId] = to;
      const movement: PopularityMovement = {
        date: draft.currentDate,
        wrestlerId,
        delta,
        from,
        to,
        reason: chemistryTagWin ? "chemistry-tag-win" : titleMatch && won ? "title-match" : won === true ? "win" : won === false ? "loss" : "draw",
      };
      finance.popularityHistory.push(movement);
      detail.push(`${draft.roster[wrestlerId].name}: popularity ${from} → ${to} (${delta >= 0 ? "+" : ""}${delta}${chemistryTagWin ? ", chemistry tag win" : ""}).`);
    }
  }
}

/** The feud between two entrants (exact unordered pair), if any. */
function feudBetween(state: CampaignState, a: CampaignEntrantId, b: CampaignEntrantId): Feud | undefined {
  return state.booking?.feuds.find((feud) => feud.entrantIds.includes(a) && feud.entrantIds.includes(b));
}

/** Build the M13 booking ledger from the campaign config (feuds only). */
function buildBookingState(config: CampaignConfig, roster: Record<string, WrestlerCareerRecord>): BookingState {
  const scale = FEUD_HEAT_TABLE.scale;
  const feuds: Feud[] = [];
  for (const source of config.feuds ?? []) {
    const teamById: Record<string, unknown> = Object.fromEntries((config.teams ?? []).map((team) => [team.id, team]));
    const [a, b] = source.entrantIds;
    if (a === b) throw new Error(`Feud ${source.entrantIds.join(" vs ")} uses the same entrant twice.`);
    for (const id of source.entrantIds) if (!roster[id] && !teamById[id]) throw new Error(`Feud ${source.entrantIds.join(" vs ")} references unknown entrant ${id}.`);
    const kinds = [a, b].map((id) => entrantKind(roster, teamById, id));
    if (kinds[0] !== kinds[1]) throw new Error(`Feud ${a} vs ${b} mixes a ${kinds[0]} entrant with a ${kinds[1]} entrant; feuds must pair two entrants of the same kind (M13-ADJ-04).`);
    if (feuds.some((feud) => feud.entrantIds.includes(a) && feud.entrantIds.includes(b))) throw new Error(`Duplicate feud between ${a} and ${b}.`);
    feuds.push({
      id: stableId("feud", { entrantIds: [...source.entrantIds].sort() }),
      entrantIds: [a, b],
      label: source.label ?? `${a} vs ${b}`,
      heat: Math.max(scale.floor, Math.min(scale.ceiling, source.initialHeat ?? 50)),
      status: "active",
      startedAt: config.startDate,
      lastMatchDate: null,
      matchCount: 0,
    });
  }
  return { policyVersion: BOOKING_POLICY_VERSION, feuds, feudHistory: [], monthSuggestions: [] };
}

/**
 * M13-ADJ-01: deterministic feud heat movement from a committed match. Applied
 * when the two entrants of a feud faced each other; the winner of the feud
 * match is whichever feud entrant won the match (null for draws). Consumes no
 * dice and never touches the match engine.
 */
function applyFeudHeat(draft: CampaignState, scheduled: ScheduledMatch, result: MatchResult, detail: string[]): void {
  const booking = draft.booking!;
  const scale = FEUD_HEAT_TABLE.scale;
  const titleMatch = Boolean(scheduled.titleId || scheduled.vacancyTitleId);
  const [a, b] = scheduled.entrantIds;
  const feud = feudBetween(draft, a, b);
  if (!feud) return;
  const wonA = entrantWon(result, 0);
  const delta = feudHeatDelta(wonA, result.method, titleMatch);
  const from = feud.heat;
  const to = Math.max(scale.floor, Math.min(scale.ceiling, from + delta));
  feud.heat = to;
  feud.status = "active";
  feud.lastMatchDate = draft.currentDate;
  feud.matchCount += 1;
  const movement: FeudHeatMovement = {
    date: draft.currentDate,
    feudId: feud.id,
    delta,
    from,
    to,
    reason: result.method === "time-limit-draw" || wonA === null ? "draw" : result.method === "pin" || result.method === "submission" || result.method === "escape" || result.method === "retrieval" ? wonA ? "win" : "loss" : wonA ? "dq" : "loss",
    matchId: scheduled.id,
  };
  booking.feudHistory.push(movement);
  detail.push(`Feud ${feud.label} (${a} vs ${b}): heat ${from} → ${to} (${delta >= 0 ? "+" : ""}${delta}${titleMatch ? ", title match" : ""}); ${feud.matchCount} feud match(es).`);
}

/**
 * M13-ADJ-01: at month-end finalization, a feud with no match in the month
 * being closed decays by FEUD_DECAY_TABLE.monthlyDecay and flips to "cooling"
 * at or below the cooling threshold. A later feud match always revives it (see
 * applyFeudHeat). The closing month is passed explicitly: the decay runs after
 * the calendar has moved into the new month, but the match check must use the
 * month being finalized, so a feud that competed that month never cools.
 */
function applyFeudMonthlyDecay(draft: CampaignState, detail: string[], closingMonth: string): void {
  const booking = draft.booking!;
  for (const feud of booking.feuds) {
    const matchedThisMonth = feud.lastMatchDate !== null && campaignMonth(feud.lastMatchDate) === closingMonth;
    if (matchedThisMonth) continue;
    const from = feud.heat;
    const to = Math.max(FEUD_HEAT_TABLE.scale.floor, from - FEUD_DECAY_TABLE.monthlyDecay);
    if (to === from && feud.status === "cooling") continue;
    feud.heat = to;
    if (to <= FEUD_DECAY_TABLE.coolingThreshold) feud.status = "cooling";
    booking.feudHistory.push({ date: draft.currentDate, feudId: feud.id, delta: to - from, from, to, reason: "monthly-decay" });
    detail.push(`Feud ${feud.label} cooled ${from} → ${to} (no match in ${closingMonth})${feud.status === "cooling" ? "; now cooling" : ""}.`);
  }
}

/**
 * M13-ADJ-02: deterministic month-end booking card for the player entrant.
 * Required title defenses first, then the player's hottest active feud rival,
 * then the most-popular (finance) or highest-ranked (no finance) available
 * ranked opponent. Advisory state only — schedules nothing.
 */
function generateMonthBookingSuggestions(draft: CampaignState, detail: string[]): void {
  const booking = draft.booking!;
  const month = campaignMonth(draft.currentDate);
  const player = draft.playerEntrantId;
  const division = draft.playerDivision;
  const items: MonthBookingSuggestion["items"] = [];
  const playerWrestlers = wrestlerIdsForEntrant(draft, division, player);
  const available = (entrantId: CampaignEntrantId) =>
    entrantId !== player &&
    wrestlerIdsForEntrant(draft, division, entrantId).every((wrestlerId) => !injuryActiveOn(draft, wrestlerId, draft.currentDate)) &&
    !draft.schedule.some((row) => row.status === "scheduled" && playerWrestlers.some((id) => row.wrestlerIds.flat().includes(id)));
  // 1. Required defense (the player's own titles first, highest hierarchy).
  const requiredTitle = titleForEntrant(draft, player, division)
    .sort((left, right) => right.hierarchy - left.hierarchy)
    .find((title) => title.completedDefenses + scheduledDefenseCount(draft, title.id, month) < title.requiredDefenses);
  if (requiredTitle) {
    const contenders = candidateOrder(draft, requiredTitle.id).filter((row) => available(row.id));
    if (contenders.length) {
      items.push({ priority: 1, kind: "required-defense", opponentId: contenders[0].id, titleId: requiredTitle.id, basis: `${requiredTitle.name} defense: ${requiredTitle.requiredDefenses - requiredTitle.completedDefenses} mandatory defense(s) due in ${month}.` });
    } else {
      items.push({ priority: 1, kind: "required-defense", opponentId: player, titleId: requiredTitle.id, basis: `${requiredTitle.name} defense due in ${month}; no eligible ranked contender is currently available.` });
    }
  }
  // 2. Hottest active feud rival (ties: higher heat, then rank, then ID).
  // M13-ADJ-04 belt-and-braces: a mixed-entrant feud has no division-consistent
  // rival (wrestlerIdsForEntrant throws for the other kind), so skip any feud
  // whose rival cannot resolve in the player's division rather than crashing
  // month-end finalization. Validation rejects such feuds, so this is a no-op
  // for every valid state and cannot shift a pinned hash.
  const rivalResolves = (rival: CampaignEntrantId): boolean => {
    try { wrestlerIdsForEntrant(draft, division, rival); return true; } catch { return false; }
  };
  const feudCandidates = booking.feuds
    .filter((feud) => feud.status === "active" && feud.entrantIds.includes(player))
    .map((feud) => ({ feud, rival: feud.entrantIds.find((id) => id !== player)! }))
    .filter(({ rival }) => rivalResolves(rival) && available(rival))
    .sort((left, right) => right.feud.heat - left.feud.heat || currentRank(draft, division, right.rival) - currentRank(draft, division, left.rival) || left.rival.localeCompare(right.rival));
  if (feudCandidates.length) {
    const top = feudCandidates[0];
    items.push({ priority: 2, kind: "feud", opponentId: top.rival, feudId: top.feud.id, basis: `Feud ${top.feud.label}: heat ${top.feud.heat}.` });
  }
  // 3. Optional: hottest draw (finance) or highest-ranked available opponent.
  const ranked = stateRankedCandidates(draft, division).filter(available);
  if (ranked.length) {
    let opponent = ranked[0];
    if (draft.finance) {
      for (const id of ranked.slice(1)) {
        if (entrantPopularity(draft, division, id) > entrantPopularity(draft, division, opponent)) opponent = id;
      }
    }
    items.push({ priority: 3, kind: "optional", opponentId: opponent, basis: draft.finance ? `Most popular available ranked opponent (draw-building).` : `Highest-ranked available opponent.` });
  }
  booking.monthSuggestions.push({ month, playerEntrantId: player, items });
  detail.push(`Booking card for ${month}: ${items.length ? items.map((row) => `${row.priority}. ${row.kind} vs ${row.opponentId}`).join(", ") : "no suggestions"}.`);
}

/** Ranked candidates for the player's division in rank order (tag: unranked teams last). */
function stateRankedCandidates(state: CampaignState, division: CampaignDivision): CampaignEntrantId[] {
  return state.rankings[division].entries.map((row) => row.entrantId);
}

function rollMonthlyObligations(draft: CampaignState, dice: DieRoll[], detail: string[]): void {
  const month = campaignMonth(draft.currentDate);
  for (const title of Object.values(draft.titles) as TitleState[]) {
    title.obligationMonth = month;
    title.completedDefenses = 0;
    if (!title.holderId) {
      title.requiredDefenses = 0;
      detail.push(`${title.name}: vacant, no defense roll.`);
      continue;
    }
    const roll = rollRngDie(draft.rng, 6, `${title.name} monthly defense requirement`, dice);
    title.requiredDefenses = requiredDefensesForRoll(roll);
    detail.push(`${title.name}: ceil(D6 ${roll} / 2) = ${title.requiredDefenses} required defenses for ${month}.`);
  }
}

/** Creates a new normal-play career from fresh entropy; loaded careers keep their stored RNG state. */
export function createRandomCampaign(config: Omit<CampaignConfig, "seed">, source?: RandomUint32Source): CampaignState {
  return createCampaign({ ...config, seed: generateRandomSeed(source) });
}

export function createCampaign(config: CampaignConfig): CampaignState {
  parseDate(config.startDate);
  if (!config.name.trim()) throw new Error("Campaign name is required.");
  if (config.roster.length < 4) throw new Error("A career requires at least four validated wrestler records.");
  const roster: Record<string, WrestlerCareerRecord> = {};
  for (const record of config.roster) {
    const errors = validateWrestlerRecord(record);
    if (errors.length) throw new Error(`Roster record ${record.id} is invalid:\n${errors.join("\n")}`);
    if (roster[record.id]) throw new Error(`Duplicate wrestler ID ${record.id}.`);
    roster[record.id] = clone(record);
  }
  const seed = config.seed >>> 0 || 1991;
  const campaignId = stableId("campaign", { name: config.name.trim(), seed, startDate: config.startDate, roster: Object.keys(roster).sort() });
  const teams: Record<string, PersistentTeam> = {};
  const teamShell = { roster } as CampaignState;
  for (const source of config.teams ?? []) {
    if (teams[source.id]) throw new Error(`Duplicate team ID ${source.id}.`);
    teams[source.id] = makeTeam(teamShell, source);
  }
  if (config.negotiationPolicy === "offers" && config.financePolicy !== "contracts") throw new Error("Contract negotiation requires the M12 contracts-and-finance extension (financePolicy \"contracts\").");
  if (config.renewalStrategy !== undefined && config.renewalStrategy !== "expiring-salary" && config.renewalStrategy !== "curve-fair") throw new Error(`Unknown renewal strategy ${String(config.renewalStrategy)}; expected \"expiring-salary\" or \"curve-fair\".`);
  if (config.renewalStrategy === "curve-fair" && config.negotiationPolicy !== "offers") throw new Error("Curve-fair renewals require the contract-negotiation extension (negotiationPolicy \"offers\").");
  if (config.playerDivision === "singles" && !roster[config.playerEntrantId]) throw new Error(`Player wrestler ${config.playerEntrantId} is not in the roster.`);
  if (config.playerDivision === "tag" && !teams[config.playerEntrantId]) throw new Error(`Player team ${config.playerEntrantId} is not configured.`);
  if (config.playerDivision === "tag" && Object.keys(teams).length < 2) throw new Error("A tag career requires at least two persistent teams.");
  const singlesCandidates = Object.values(roster).sort((left, right) => right.careerWp - left.careerWp || left.id.localeCompare(right.id)).map((row) => row.id);
  const tagCandidates = Object.values(teams).sort((left, right) => right.careerWp - left.careerWp || left.id.localeCompare(right.id)).map((row) => row.id);
  const titles = {
    "world-heavyweight": createTitle("world-heavyweight", defaultChampion(config.champions, "world-heavyweight", singlesCandidates, 0), config.startDate),
    international: createTitle("international", defaultChampion(config.champions, "international", singlesCandidates, 1), config.startDate),
    television: createTitle("television", defaultChampion(config.champions, "television", singlesCandidates, 2), config.startDate),
    "world-tag": createTitle("world-tag", defaultChampion(config.champions, "world-tag", tagCandidates, 0), config.startDate),
    "american-tag": createTitle("american-tag", defaultChampion(config.champions, "american-tag", tagCandidates, 1), config.startDate),
  } satisfies Record<CampaignTitleId, TitleState>;
  const base = {
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
    rulesetVersion: RULESET_VERSION,
    campaignRulesetVersion: CAMPAIGN_RULESET_VERSION,
    dataPackVersion: M5_DATA_PACK_VERSION,
    dataHash: M5_DATA_HASH,
    campaignId,
    name: config.name.trim(),
    seed,
    rng: createRng(seed),
    createdAt: config.startDate,
    updatedAt: config.startDate,
    startDate: config.startDate,
    currentDate: config.startDate,
    playerEntrantId: config.playerEntrantId,
    playerDivision: config.playerDivision,
    vacancyMethod: config.vacancyMethod ?? "ranked-contenders",
    ...(config.postMatchInjuryPolicy === "d20-check" ? { postMatchInjuryPolicy: "d20-check" as const, postMatchInjuryVersion: POST_MATCH_INJURY_POLICY_VERSION } : {}),
    ...(config.aiDifficulty && config.aiDifficulty !== "standard" ? { aiDifficulty: config.aiDifficulty } : {}),
    ...(config.variety && config.variety !== "standard" ? { variety: config.variety } : {}),
    ...(config.financePolicy === "contracts" ? { financePolicy: "contracts" as const, financeVersion: FINANCE_POLICY_VERSION, finance: buildFinanceState(config, roster, config.startDate) } : {}),
    ...(config.bookingPolicy === "feuds" ? { bookingPolicy: "feuds" as const, bookingVersion: BOOKING_POLICY_VERSION, booking: buildBookingState(config, roster) } : {}),
    ...(config.negotiationPolicy === "offers" ? { negotiationPolicy: "offers" as const, negotiationVersion: NEGOTIATION_POLICY_VERSION, negotiation: buildNegotiationState() } : {}),
    ...(config.renewalStrategy === "curve-fair" ? { renewalStrategy: "curve-fair" as const } : {}),
    roster,
    teams,
    rankings: {} as Record<CampaignDivision, RankingTable>,
    rankingHistory: [],
    monthlyRatingPoints: { singles: {}, tag: {} },
    titles,
    schedule: [],
    titleShotOffers: [],
    vacancies: [],
    injuries: [],
    matchHistory: [],
    appliedMatchIds: [],
    activeMatchId: null,
    activeMatch: null,
    events: [],
  } satisfies CampaignState;
  for (const title of Object.values(base.titles)) validateTitleHolder(base, title);
  base.rankings.singles = initialRanking(base, "singles");
  base.rankings.tag = initialRanking(base, "tag");
  for (const team of Object.values(base.teams)) team.currentRank = base.rankings.tag.entries.find((row) => row.entrantId === team.id)?.rank ?? null;
  return transact(base, "campaign-start", { config: { ...config, roster: config.roster.map((row) => row.id) } }, (draft, dice, detail) => {
    rollMonthlyObligations(draft, dice, detail);
    detail.unshift(`Campaign ${draft.campaignId} began on ${draft.startDate}; rules ${CAMPAIGN_RULESET_VERSION}; data ${M5_DATA_HASH}.`);
    return `Started ${draft.name}.`;
  });
}

function injuryActiveOn(state: CampaignState, wrestlerId: string, date: string): CampaignInjury | undefined {
  return state.injuries.find((row) => row.wrestlerId === wrestlerId && row.active && date < row.returnDate);
}

function titleForEntrant(state: CampaignState, entrantId: CampaignEntrantId, division?: CampaignDivision): TitleState[] {
  return (Object.values(state.titles) as TitleState[]).filter((row) => row.holderId === entrantId && (!division || row.division === division));
}

function scheduledDefenseCount(state: CampaignState, titleId: CampaignTitleId, month: string): number {
  return state.schedule.filter((row) => row.titleId === titleId && row.status === "scheduled" && campaignMonth(row.date) === month).length;
}

function ensureOptionalDateDoesNotConsumeDefense(state: CampaignState, entrantId: string, date: string): void {
  const month = campaignMonth(date);
  for (const title of titleForEntrant(state, entrantId)) {
    if (title.obligationMonth !== month) continue;
    const remaining = Math.max(0, title.requiredDefenses - title.completedDefenses - scheduledDefenseCount(state, title.id, month));
    if (remaining === 0) continue;
    let freeDates = 0;
    for (let cursor = date; cursor <= lastDayOfMonth(date); cursor = addCalendarDays(cursor, 1)) {
      const holderWrestlers = wrestlerIdsForEntrant(state, title.division, entrantId);
      const booked = state.schedule.some((row) => row.status === "scheduled" && row.date === cursor && holderWrestlers.some((id) => row.wrestlerIds.flat().includes(id)));
      if (!booked) freeDates += 1;
    }
    if (freeDates <= remaining) throw new Error(`${title.name} requires ${remaining} reserved defense date(s) before month end; optional booking on ${date} would consume a required date.`);
  }
}

export interface ScheduleMatchRequest {
  date: string;
  entrantIds: [CampaignEntrantId, CampaignEntrantId];
  timeLimitMinutes?: number;
  titleId?: CampaignTitleId | null;
  vacancyTitleId?: CampaignTitleId | null;
  vacancyCompetitionId?: string | null;
  vacancyRound?: "semifinal" | "final" | null;
  mandatoryDefense?: boolean;
  playerControlled?: boolean;
  /** Per-match AI difficulty override; defaults to the campaign's pinned difficulty. */
  aiDifficulty?: AiDifficulty;
  /** Per-match variety override (M11); cage/ladder are singles-only and default to the campaign default. */
  variety?: MatchVariety;
}

export function scheduleCampaignMatch(source: CampaignState, request: ScheduleMatchRequest): CampaignState {
  return transact(source, "schedule-match", { request }, (draft, dice, detail) => {
    if (draft.activeMatch) throw new Error(`Cannot mutate the schedule while match ${draft.activeMatchId} is in progress.`);
    parseDate(request.date);
    if (request.date < draft.currentDate) throw new Error(`Cannot schedule a match in the past (${request.date}).`);
    if (request.entrantIds[0] === request.entrantIds[1]) throw new Error("A match requires two different entrants.");
    const title = request.titleId ? draft.titles[request.titleId] : null;
    const vacancyTitle = request.vacancyTitleId ? draft.titles[request.vacancyTitleId] : null;
    const division = title?.division ?? vacancyTitle?.division ?? (draft.teams[request.entrantIds[0]] && draft.teams[request.entrantIds[1]] ? "tag" : "singles");
    // Per-match variety (M11): absent inherits the campaign default; an explicit
    // "standard" forces the default and stores nothing (hash-safe, exactly like
    // the engine's variety normalization); cage/ladder force the variant.
    const variety = request.variety === "standard" ? undefined : request.variety ?? draft.variety;
    if (variety && division === "tag") throw new Error(`${variety} matches are singles-only in v1 (M11).`);
    if (variety && (request.vacancyTitleId || request.vacancyRound === "final")) throw new Error(`${variety} matches cannot decide a vacant title; vacancies are decided only by pin or submission.`);
    const wrestlerIds = request.entrantIds.map((id) => wrestlerIdsForEntrant(draft, division, id)) as [string[], string[]];
    for (const wrestlerId of wrestlerIds.flat()) {
      const injury = injuryActiveOn(draft, wrestlerId, request.date);
      if (injury) throw new Error(`${draft.roster[wrestlerId].name} is injured through ${addCalendarDays(injury.returnDate, -1)} and cannot compete on ${request.date}.`);
      const conflict = draft.schedule.find((row) => row.status !== "cancelled" && row.date === request.date && row.wrestlerIds.flat().includes(wrestlerId));
      if (conflict) throw new Error(`${draft.roster[wrestlerId].name} is already booked in ${conflict.id} on ${request.date}.`);
    }
    if (title) {
      if (!title.holderId) throw new Error(`${title.name} is vacant and cannot be defended.`);
      if (!request.entrantIds.includes(title.holderId)) throw new Error(`${title.name} holder ${title.holderId} must participate in its title match.`);
    } else if (vacancyTitle) {
      if (vacancyTitle.holderId) throw new Error(`${vacancyTitle.name} is not vacant.`);
    } else if (!request.vacancyCompetitionId) {
      for (const entrant of request.entrantIds) ensureOptionalDateDoesNotConsumeDefense(draft, entrant, request.date);
    }
    const seedDigits = Array.from({ length: 5 }, (_, index) => rollRngDie(draft.rng, 10, `scheduled match seed digit ${index + 1}`, dice) - 1);
    const matchSeed = Number(seedDigits.join("")) + 1;
    const id = stableId("match", { campaignId: draft.campaignId, date: request.date, entrants: request.entrantIds, title: request.titleId ?? null, sequence: draft.schedule.length, matchSeed });
    const timeLimitMinutes = request.timeLimitMinutes ?? 15;
    if (!Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 1 || timeLimitMinutes > 60) throw new Error("Scheduled match time limit must be a whole number from 1 to 60 minutes.");
    const match: ScheduledMatch = {
      id,
      date: request.date,
      mode: division === "tag" ? "tag" : "singles",
      entrantIds: clone(request.entrantIds),
      wrestlerIds,
      playerControlled: request.playerControlled ?? request.entrantIds.includes(draft.playerEntrantId),
      titleId: request.titleId ?? null,
      vacancyTitleId: request.vacancyTitleId ?? null,
      vacancyCompetitionId: request.vacancyCompetitionId ?? null,
      vacancyRound: request.vacancyRound ?? null,
      mandatoryDefense: Boolean(request.mandatoryDefense),
      status: "scheduled",
      matchSeed,
      timeLimitMinutes,
      aiDifficulty: request.aiDifficulty ?? draft.aiDifficulty,
      variety,
      result: null,
      replayConfig: null,
      replayInputs: [],
      finalMatchState: null,
    };
    draft.schedule.push(match);
    if (match.vacancyCompetitionId) {
      const competition = draft.vacancies.find((row) => row.id === match.vacancyCompetitionId);
      if (!competition || competition.status !== "active") throw new Error(`Vacancy competition ${match.vacancyCompetitionId} is unavailable.`);
      competition.matchIds.push(match.id);
    }
    detail.push(`${match.mode} match ${id} scheduled for ${request.date}.`, `Entrants: ${request.entrantIds.join(" vs ")}; seed ${matchSeed}.`, title ? `${title.name} title match${match.mandatoryDefense ? "; mandatory defense" : ""}.` : vacancyTitle ? `${vacancyTitle.name} vacancy ${match.vacancyRound ?? "final"}.` : match.vacancyCompetitionId ? `Vacancy tournament ${match.vacancyRound}.` : "Non-title match.");
    return `Scheduled ${id}.`;
  });
}

function matchRoster(state: CampaignState, scheduled: ScheduledMatch): MatchState["roster"] {
  const roster: MatchState["roster"] = {};
  for (const [sideIndex, teamId] of (["player", "ai"] as const).entries()) {
    for (const wrestlerId of scheduled.wrestlerIds[sideIndex]) {
      roster[wrestlerId] = careerRecordToDefinition(state.roster[wrestlerId], wrestlerId, teamId);
    }
  }
  return roster;
}

export function beginScheduledMatch(source: CampaignState, matchId: string): CampaignState {
  return transact(source, "begin-scheduled-match", { matchId }, (draft, _dice, detail) => {
    if (draft.activeMatch) throw new Error(`Match ${draft.activeMatchId} is already active.`);
    const scheduled = draft.schedule.find((row) => row.id === matchId);
    if (!scheduled) throw new Error(`Unknown scheduled match ${matchId}.`);
    if (scheduled.status !== "scheduled") throw new Error(`Match ${matchId} is ${scheduled.status}, not scheduled.`);
    if (scheduled.date > draft.currentDate) throw new Error(`Match ${matchId} is scheduled for ${scheduled.date}; current date is ${draft.currentDate}.`);
    for (const wrestlerId of scheduled.wrestlerIds.flat()) {
      const injury = injuryActiveOn(draft, wrestlerId, draft.currentDate);
      if (injury) throw new Error(`${draft.roster[wrestlerId].name} remains injured until ${injury.returnDate}.`);
    }
    const title = scheduled.titleId ? draft.titles[scheduled.titleId] : scheduled.vacancyTitleId ? draft.titles[scheduled.vacancyTitleId] : null;
    const match = createMatch({
      seed: scheduled.matchSeed,
      mode: scheduled.mode,
      timeLimitMinutes: scheduled.timeLimitMinutes,
      titleModifier: title ? CAMPAIGN_TITLES[title.id].matchTitleModifier : 0,
      aiDifficulty: scheduled.aiDifficulty,
      variety: scheduled.variety,
      roster: matchRoster(draft, scheduled),
      teamMembers: { player: scheduled.wrestlerIds[0], ai: scheduled.wrestlerIds[1] },
    });
    scheduled.status = "in-progress";
    draft.activeMatchId = scheduled.id;
    draft.activeMatch = match;
    detail.push(`Full ${scheduled.mode} engine created at ${hashMatchState(match)}.`, `No shortcut result table was used; match seed ${scheduled.matchSeed}.`);
    return `Began ${scheduled.id}.`;
  });
}

export function checkpointScheduledMatch(source: CampaignState, match: MatchState): CampaignState {
  return transact(source, "match-checkpoint", { matchId: source.activeMatchId, inputCount: match.inputLog.length, matchHash: hashMatchState(match) }, (draft, _dice, detail) => {
    if (!draft.activeMatchId || !draft.activeMatch) throw new Error("No campaign match is active.");
    const scheduled = draft.schedule.find((row) => row.id === draft.activeMatchId)!;
    if (match.config.seed !== scheduled.matchSeed) throw new Error("Checkpoint seed does not match the scheduled match.");
    const replay = replayFromInputLog(match);
    if (hashMatchState(replay) !== hashMatchState(match)) throw new Error("Checkpoint replay diverges from the submitted match state.");
    draft.activeMatch = clone(match);
    scheduled.replayInputs = clone(match.inputLog);
    detail.push(`Committed match phase/input checkpoint ${hashMatchState(match)}.`, `Replay reproduced ${hashMatchState(replay)} from ${match.inputLog.length} player inputs.`);
    return `Checkpointed ${scheduled.id}.`;
  });
}

function entrantWon(result: MatchResult, sideIndex: 0 | 1): boolean | null {
  if (result.winnerTeamId === null) return null;
  return (result.winnerTeamId === "player") === (sideIndex === 0);
}

function matchWpValues(state: CampaignState, match: ScheduledMatch, sideIndex: 0 | 1): number | number[] {
  const ids = match.wrestlerIds[sideIndex];
  return ids.length === 1 ? state.roster[ids[0]].careerWp : ids.map((id) => state.roster[id].careerWp);
}

function applyAwards(draft: CampaignState, scheduled: ScheduledMatch, match: MatchState, detail: string[]): void {
  const title = scheduled.titleId ? draft.titles[scheduled.titleId] : scheduled.vacancyTitleId ? draft.titles[scheduled.vacancyTitleId] : null;
  for (const sideIndex of [0, 1] as const) {
    const didWin = entrantWon(match.result!, sideIndex);
    const method = match.result!.method;
    const titleWonOrRetained = Boolean(title && didWin && (method === "pin" || method === "submission"));
    const award = {
      result: didWin === null ? "draw" as const : didWin ? "win" as const : "loss" as const,
      method,
      ownWp: matchWpValues(draft, scheduled, sideIndex),
      opponentWp: matchWpValues(draft, scheduled, sideIndex === 0 ? 1 : 0),
      titleCategory: title ? CAMPAIGN_TITLES[title.id].wpCategory : undefined,
      titleWonOrRetained,
    };
    for (const wrestlerId of scheduled.wrestlerIds[sideIndex]) {
      const progression = applyProgression(createProgressionState(draft.roster[wrestlerId]), { type: "award-match-wp", award });
      draft.roster[wrestlerId] = progression.record;
      detail.push(`${draft.roster[wrestlerId].name}: ${progression.events[0].detail.join(" ")}`);
    }
    if (scheduled.mode === "tag") {
      const team = draft.teams[scheduled.entrantIds[sideIndex]];
      team.careerWp = teamWp(draft, team);
      team.matchHistory.push(scheduled.id);
    }
  }
}

function recordRatings(draft: CampaignState, scheduled: ScheduledMatch, result: MatchResult, detail: string[]): void {
  const division: CampaignDivision = scheduled.mode === "tag" ? "tag" : "singles";
  for (const sideIndex of [0, 1] as const) {
    const own = scheduled.entrantIds[sideIndex];
    const opponent = scheduled.entrantIds[sideIndex === 0 ? 1 : 0];
    const ownRank = currentRank(draft, division, own);
    const opponentRank = currentRank(draft, division, opponent);
    const higher = opponentRank < ownRank;
    const kind = ratingResultKind(result, entrantWon(result, sideIndex));
    const points = ratingPoints(kind, higher);
    draft.monthlyRatingPoints[division][own] = (draft.monthlyRatingPoints[division][own] ?? 0) + points;
    detail.push(`${own}: ${kind} versus ${higher ? "higher" : "lower/unranked"} rank ${opponentRank}; ${points >= 0 ? "+" : ""}${points} RP, monthly ${draft.monthlyRatingPoints[division][own]}.`);
  }
}

function vacateTitle(draft: CampaignState, title: TitleState, type: "vacated" | "stripped", detailText: string, detail: string[]): void {
  const former = title.holderId;
  title.holderId = null;
  title.status = "vacant";
  title.wonDate = null;
  title.lastDefenseDate = null;
  title.requiredDefenses = 0;
  title.completedDefenses = 0;
  title.history.push({ date: draft.currentDate, type, entrantId: former, detail: detailText });
  detail.push(`${title.name}: ${detailText}`);
}

function applyTitleResult(draft: CampaignState, scheduled: ScheduledMatch, result: MatchResult, detail: string[]): void {
  if (!scheduled.titleId && !scheduled.vacancyTitleId) return;
  const title = draft.titles[(scheduled.titleId ?? scheduled.vacancyTitleId)!];
  const winner = result.winnerTeamId === "player" ? scheduled.entrantIds[0] : result.winnerTeamId === "ai" ? scheduled.entrantIds[1] : null;
  const titleCanChange = titleCanChangeOnMethod(result.method);
  if (scheduled.vacancyTitleId) {
    if (winner && titleCanChange) {
      title.holderId = winner;
      title.status = "active";
      title.wonDate = draft.currentDate;
      title.lastDefenseDate = draft.currentDate;
      title.completedDefenses = 0;
      title.history.push({ date: draft.currentDate, type: "won", entrantId: winner, matchId: scheduled.id, detail: `${winner} filled the vacancy by ${result.method}.` });
      detail.push(`${winner} filled the vacant ${title.name} by ${result.method}.`);
    } else detail.push(`${title.name} remains vacant because the deciding match did not end by pin or submission.`);
    return;
  }
  if (winner && winner !== title.holderId && titleCanChange) {
    const former = title.holderId;
    title.holderId = winner;
    title.status = "active";
    title.wonDate = draft.currentDate;
    title.lastDefenseDate = draft.currentDate;
    title.completedDefenses = 0;
    title.history.push({ date: draft.currentDate, type: "won", entrantId: winner, matchId: scheduled.id, detail: `${winner} defeated ${former} by ${result.method}.` });
    detail.push(`${winner} won the ${title.name} by ${result.method}.`);
    if (title.division === "singles") {
      for (const lower of Object.values(draft.titles) as TitleState[]) if (lower.division === "singles" && lower.holderId === winner && lower.hierarchy < title.hierarchy) vacateTitle(draft, lower, "vacated", `${winner} won the higher ${title.name}.`, detail);
    }
  } else {
    title.completedDefenses += 1;
    title.lastDefenseDate = draft.currentDate;
    title.history.push({ date: draft.currentDate, type: "retained", entrantId: title.holderId, matchId: scheduled.id, detail: titleCanChange ? `${title.holderId} retained by ${result.method}.` : `${title.holderId} retained because titles do not change on ${result.method}.` });
    detail.push(`${title.holderId} retained the ${title.name}; defenses ${title.completedDefenses}/${title.requiredDefenses}.`);
  }
}

function updateVacancyCompetition(draft: CampaignState, scheduled: ScheduledMatch, detail: string[]): void {
  if (!scheduled.vacancyCompetitionId || !scheduled.result) return;
  const competition = draft.vacancies.find((row) => row.id === scheduled.vacancyCompetitionId);
  if (!competition) throw new Error(`Missing vacancy competition ${scheduled.vacancyCompetitionId}.`);
  if (scheduled.result.winnerEntrantId && scheduled.vacancyRound === "semifinal" && !competition.advancingEntrantIds.includes(scheduled.result.winnerEntrantId)) {
    competition.advancingEntrantIds.push(scheduled.result.winnerEntrantId);
    detail.push(`${scheduled.result.winnerEntrantId} advanced in ${competition.id}.`);
  }
  if (scheduled.vacancyRound === "final" && draft.titles[competition.titleId].holderId) {
    competition.status = "completed";
    detail.push(`${competition.id} completed with ${draft.titles[competition.titleId].holderId} as champion.`);
  }
}

function applyInjuries(draft: CampaignState, scheduled: ScheduledMatch, match: MatchState, detail: string[]): void {
  for (const wrestlerId of scheduled.wrestlerIds.flat()) {
    const weeks = match.wrestlers[wrestlerId].injuryWeeks;
    if (weeks <= 0 || draft.injuries.some((row) => row.sourceMatchId === scheduled.id && row.wrestlerId === wrestlerId)) continue;
    const returnDate = addCalendarDays(draft.currentDate, weeks * 7);
    const injury: CampaignInjury = {
      id: stableId("injury", { matchId: scheduled.id, wrestlerId, weeks }),
      wrestlerId,
      sourceMatchId: scheduled.id,
      occurredDate: draft.currentDate,
      weeks,
      returnDate,
      active: true,
      detail: `Critical Hold broken-extremity layoff: ${weeks} week(s), eligible again ${returnDate}.`,
    };
    draft.injuries.push(injury);
    detail.push(`${draft.roster[wrestlerId].name}: ${injury.detail}`);
  }
}

function applyPostMatchInjuryChecks(draft: CampaignState, scheduled: ScheduledMatch, match: MatchState, dice: DieRoll[], detail: string[]): void {
  if (draft.postMatchInjuryPolicy !== "d20-check") return;
  for (const wrestlerId of scheduled.wrestlerIds.flat()) {
    if (draft.injuries.some((row) => row.sourceMatchId === scheduled.id && row.wrestlerId === wrestlerId)) continue;
    const runtime = match.wrestlers[wrestlerId];
    const maxDamage = startingDamage(match.roster[wrestlerId]);
    const damageTaken = Math.max(0, maxDamage - runtime.currentDamage);
    const knockedOut = runtime.knockedOutForMatch || (runtime.knockedOutUntilTick !== null && match.tick < runtime.knockedOutUntilTick);
    if (!postMatchInjuryEligible(damageTaken, maxDamage, knockedOut)) {
      detail.push(`${draft.roster[wrestlerId].name}: post-match injury check skipped (${damageTaken}/${maxDamage} damage taken${knockedOut ? "; knocked out" : ""}).`);
      continue;
    }
    const roll = rollRngDie(draft.rng, 20, `post-match injury check ${wrestlerId}`, dice);
    const result = roll <= 3 ? resolvePostMatchInjury(roll, rollRngDie(draft.rng, 6, `post-match injury duration ${wrestlerId}`, dice)) : null;
    if (!result) {
      detail.push(`${draft.roster[wrestlerId].name}: post-match injury check ${roll} cleared.`);
      continue;
    }
    const returnDate = addCalendarDays(draft.currentDate, result.weeks * 7);
    const injury: CampaignInjury = {
      id: stableId("injury", { matchId: scheduled.id, wrestlerId, source: "post-match-check", roll, weeks: result.weeks }),
      wrestlerId,
      sourceMatchId: scheduled.id,
      occurredDate: draft.currentDate,
      weeks: result.weeks,
      returnDate,
      active: true,
      detail: `Post-match ${result.severity === "broken-extremity" ? "broken-extremity" : "sprain"} (check ${roll}): ${result.weeks} week(s) out, eligible again ${returnDate}.`,
    };
    draft.injuries.push(injury);
    detail.push(`${draft.roster[wrestlerId].name}: ${injury.detail}`);
  }
}

export function commitScheduledMatchResult(source: CampaignState): CampaignState {
  return transact(source, "commit-match-result", { matchId: source.activeMatchId, matchHash: source.activeMatch ? hashMatchState(source.activeMatch) : null }, (draft, dice, detail) => {
    if (!draft.activeMatchId || !draft.activeMatch) throw new Error("No active match is available to commit.");
    if (!draft.activeMatch.result) throw new Error("The active match has no official result.");
    const scheduled = draft.schedule.find((row) => row.id === draft.activeMatchId)!;
    if (draft.appliedMatchIds.includes(scheduled.id) || scheduled.result) throw new Error(`Match ${scheduled.id} has already been applied.`);
    const replay = replayFromInputLog(draft.activeMatch);
    const finalHash = hashMatchState(draft.activeMatch);
    if (hashMatchState(replay) !== finalHash) throw new Error(`Match ${scheduled.id} cannot commit because replay diverged.`);
    applyAwards(draft, scheduled, draft.activeMatch, detail);
    recordRatings(draft, scheduled, draft.activeMatch.result, detail);
    applyTitleResult(draft, scheduled, draft.activeMatch.result, detail);
    applyInjuries(draft, scheduled, draft.activeMatch, detail);
    applyPostMatchInjuryChecks(draft, scheduled, draft.activeMatch, dice, detail);
    if (draft.finance) applyPopularityMovement(draft, scheduled, draft.activeMatch.result, detail);
    if (draft.booking) applyFeudHeat(draft, scheduled, draft.activeMatch.result, detail);
    const winner = draft.activeMatch.result.winnerTeamId === "player" ? scheduled.entrantIds[0] : draft.activeMatch.result.winnerTeamId === "ai" ? scheduled.entrantIds[1] : null;
    const loser = winner === scheduled.entrantIds[0] ? scheduled.entrantIds[1] : winner === scheduled.entrantIds[1] ? scheduled.entrantIds[0] : null;
    const applicationId = stableId("result-application", { campaignId: draft.campaignId, matchId: scheduled.id, finalHash });
    scheduled.status = "completed";
    scheduled.result = { winnerEntrantId: winner, loserEntrantId: loser, method: draft.activeMatch.result.method, summary: draft.activeMatch.result.summary, appliedEventId: applicationId, finalMatchHash: finalHash };
    scheduled.replayConfig = clone(draft.activeMatch.config);
    scheduled.replayInputs = clone(draft.activeMatch.inputLog);
    // Completed campaign saves keep the deterministic replay contract rather
    // than a second full copy of every immutable match event.
    scheduled.finalMatchState = null;
    draft.appliedMatchIds.push(scheduled.id);
    draft.matchHistory.push(scheduled.id);
    draft.activeMatchId = null;
    draft.activeMatch = null;
    updateVacancyCompetition(draft, scheduled, detail);
    detail.unshift(`Applied ${scheduled.id} exactly once as ${applicationId}; replay ${finalHash}.`);
    return `Committed ${scheduled.id}: ${scheduled.result.summary}`;
  });
}

export function resolveScheduledMatchHeadless(source: CampaignState, matchId: string, maxPlayerInputs = 20_000): CampaignState {
  let state = beginScheduledMatch(source, matchId);
  let match = state.activeMatch!;
  let guard = 0;
  while (!match.result) {
    match = advanceUntilPlayerDecision(match);
    if (match.result) break;
    if (!match.decision) throw new Error(`Headless match ${matchId} stalled without a decision.`);
    const decision = chooseDeterministicPolicyAction(match, match.decision);
    match = submitPlayerIntent(match, decision.intent);
    guard += 1;
    if (guard > maxPlayerInputs) throw new Error(`Headless match ${matchId} exceeded ${maxPlayerInputs} player-side inputs.`);
  }
  state = checkpointScheduledMatch(state, match);
  return commitScheduledMatchResult(state);
}

export function replayScheduledCampaignMatch(state: CampaignState, matchId: string): MatchState {
  const scheduled = state.schedule.find((row) => row.id === matchId);
  if (!scheduled?.result || !scheduled.replayConfig) throw new Error(`Completed replay data is unavailable for ${matchId}.`);
  let match = createMatch(scheduled.replayConfig);
  for (const intent of scheduled.replayInputs) {
    if (match.result) break;
    match = submitPlayerIntent(match, intent);
  }
  if (hashMatchState(match) !== scheduled.result.finalMatchHash) throw new Error(`Stored campaign replay ${matchId} diverged from ${scheduled.result.finalMatchHash}.`);
  return match;
}

function finalizeDivision(draft: CampaignState, division: CampaignDivision, dice: DieRoll[], detail: string[]): void {
  const previous = draft.rankings[division];
  const candidates = entrantIds(draft, division).map((entrantId) => {
    const priorRank = draft.titles[worldTitleId(division)].holderId === entrantId ? 0 : previous.entries.find((row) => row.entrantId === entrantId)?.rank ?? UNRANKED_PRIOR_RANK[division];
    const matchPoints = draft.monthlyRatingPoints[division][entrantId] ?? 0;
    const bonus = previousRankBonus(division, priorRank);
    // M12-ADJ-05: a chemistry-pair tag team gains a flat monthly rating bonus
    // (roster quality fact, not match activity) — finance-only, zero dice.
    const chemistryBonus = division === "tag" && draft.finance ? chemistryTagRatingBonus(true, isChemistryPair(draft.finance, draft.teams[entrantId].memberIds)) : 0;
    if (chemistryBonus > 0) detail.push(`${entrantId}: chemistry pair tag rating bonus +${chemistryBonus} RP for the month (M12-ADJ-05).`);
    return { entrantId, priorRank, matchPoints, priorRankBonus: bonus, totalPoints: matchPoints + bonus + chemistryBonus, totalWp: campaignEntrantWp(draft, division, entrantId), tiebreakRolls: [] as number[] };
  });
  const grouped = new Map<string, typeof candidates>();
  for (const row of candidates) {
    const key = `${row.totalPoints}|${row.priorRank}|${row.totalWp}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  for (const rows of grouped.values()) if (rows.length > 1) {
    let unresolved = [...rows];
    let guard = 0;
    while (unresolved.length > 1) {
      const round = unresolved.map((row) => ({ row, roll: rollRngDie(draft.rng, 6, `${division} rating tiebreak ${row.entrantId}`, dice) }));
      const counts = new Map<number, number>();
      for (const item of round) { item.row.tiebreakRolls.push(item.roll); counts.set(item.roll, (counts.get(item.roll) ?? 0) + 1); }
      unresolved = round.filter((item) => counts.get(item.roll)! > 1).map((item) => item.row);
      guard += 1;
      if (guard > 100) throw new Error(`${division} rating tiebreak did not converge.`);
    }
  }
  const ordered = candidates.sort((left, right) => right.totalPoints - left.totalPoints || left.priorRank - right.priorRank || right.totalWp - left.totalWp || (right.tiebreakRolls.at(-1) ?? 0) - (left.tiebreakRolls.at(-1) ?? 0) || left.entrantId.localeCompare(right.entrantId));
  const guaranteed = reorderGuaranteed(draft, division, ordered.map((row) => row.entrantId));
  const byId = new Map(ordered.map((row) => [row.entrantId, row]));
  const entries = guaranteed.slice(0, RATING_LIMITS[division]).map<RankingEntry>((id, index) => ({ ...byId.get(id)!, rank: index + 1 }));
  const month = campaignMonth(draft.currentDate);
  const table: RankingTable = {
    id: stableId("ranking", { campaignId: draft.campaignId, month, division, entries, champion: draft.titles[worldTitleId(division)].holderId }),
    month,
    division,
    championId: draft.titles[worldTitleId(division)].holderId,
    entries,
    finalizedAt: draft.currentDate,
    formula: "monthly match RP + previous-rank bonus; total RP, prior rank, total WP, recorded D6; guaranteed champion placements",
  };
  draft.rankings[division] = table;
  draft.rankingHistory.push(clone(table));
  draft.monthlyRatingPoints[division] = {};
  if (division === "tag") for (const team of Object.values(draft.teams)) team.currentRank = entries.find((row) => row.entrantId === team.id)?.rank ?? null;
  detail.push(`${division}: finalized ${table.id}; ${entries.map((row) => `#${row.rank} ${row.entrantId} (${row.totalPoints} RP)`).join(", ")}.`, `${division}: monthly RP reset only after the ranking table committed.`);
}

function stripOverdueTitles(draft: CampaignState, detail: string[], monthClosing = false): void {
  for (const title of Object.values(draft.titles) as TitleState[]) {
    if (!title.holderId) continue;
    const anchor = title.lastDefenseDate ?? title.wonDate;
    const rollingOverdue = Boolean(anchor && daysBetween(anchor!, draft.currentDate) > 30);
    const monthlyMiss = monthClosing && title.completedDefenses < title.requiredDefenses;
    if (rollingOverdue || monthlyMiss) {
      const reason = rollingOverdue ? `stripped after more than 30 days without a defense (last ${anchor})` : `stripped after completing ${title.completedDefenses}/${title.requiredDefenses} required defenses for ${title.obligationMonth}`;
      vacateTitle(draft, title, "stripped", reason, detail);
    }
  }
}

export function advanceCampaignDays(source: CampaignState, days: number): CampaignState {
  return transact(source, "advance-calendar", { days }, (draft, dice, detail) => {
    if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error("Calendar advance must be 1-366 whole days.");
    for (let index = 0; index < days; index += 1) {
      const due = draft.schedule.find((row) => row.status === "scheduled" && row.date <= draft.currentDate);
      if (due) throw new Error(`Cannot advance past unresolved scheduled match ${due.id} on ${due.date}.`);
      const oldMonth = campaignMonth(draft.currentDate);
      draft.currentDate = addCalendarDays(draft.currentDate, 1);
      for (const injury of draft.injuries) if (injury.active && draft.currentDate >= injury.returnDate) {
        injury.active = false;
        detail.push(`${draft.roster[injury.wrestlerId].name} returned from injury on ${draft.currentDate}.`);
      }
      stripOverdueTitles(draft, detail, false);
      if (draft.finance && draft.currentDate >= draft.finance.nextPayoutDate) applyWeeklyPayout(draft, detail);
      if (draft.negotiation) {
        const yesterday = addCalendarDays(draft.currentDate, -1);
        for (const contract of Object.values(draft.finance!.contracts)) {
          const expiry = addCalendarDays(contract.startDate, contract.termWeeks * 7);
          if (expiry === yesterday) evaluateContractRenewal(draft, contract, dice, detail);
        }
      }
      if (campaignMonth(draft.currentDate) !== oldMonth) {
        draft.currentDate = addCalendarDays(draft.currentDate, -1);
        finalizeDivision(draft, "singles", dice, detail);
        finalizeDivision(draft, "tag", dice, detail);
        stripOverdueTitles(draft, detail, true);
        draft.currentDate = addCalendarDays(draft.currentDate, 1);
        rollMonthlyObligations(draft, dice, detail);
        if (draft.booking) {
          applyFeudMonthlyDecay(draft, detail, oldMonth);
          generateMonthBookingSuggestions(draft, detail);
        }
      }
    }
    return `Advanced to ${draft.currentDate}.`;
  });
}

function candidateOrder(state: CampaignState, titleId: CampaignTitleId): Array<{ id: CampaignEntrantId; rank: number }> {
  const title = state.titles[titleId];
  const rows = state.rankings[title.division].entries;
  const championRank = titleId === "television" && title.holderId ? currentRank(state, "singles", title.holderId) : null;
  const start = titleShotStartingRank(titleId, championRank);
  // M12-ADJ-04: with the finance extension on, a candidate below the popularity
  // floor is not eligible for a title shot (cold wrestlers are not put over).
  const floor = state.finance ? TITLE_SHOT_POPULARITY_RULES.eligibilityFloor : null;
  const eligible = (entrantId: CampaignEntrantId) => floor === null || entrantPopularity(state, title.division, entrantId) >= floor;
  const selected = rows.filter((row) => row.rank >= start && row.entrantId !== title.holderId && eligible(row.entrantId)).map((row) => ({ id: row.entrantId, rank: row.rank }));
  if (title.division === "tag") for (const id of entrantIds(state, "tag").filter((id) => !rows.some((row) => row.entrantId === id) && id !== title.holderId && eligible(id))) selected.push({ id, rank: 5 });
  return selected;
}

export function rollTitleShot(source: CampaignState, titleId: CampaignTitleId): CampaignState {
  return transact(source, "roll-title-shot", { titleId }, (draft, dice, detail) => {
    const title = draft.titles[titleId];
    if (!title.holderId) throw new Error(`${title.name} is vacant.`);
    const month = campaignMonth(draft.currentDate);
    const championSide = campaignEntrantSide(draft, title.division, title.holderId);
    const candidates = candidateOrder(draft, titleId);
    if (!candidates.length) throw new Error(draft.finance
      ? `No eligible ${title.name} candidates are available (none meet the ${TITLE_SHOT_POPULARITY_RULES.eligibilityFloor} popularity floor with the M12 extension on).`
      : `No eligible ${title.name} candidates are available.`);
    for (const candidate of candidates) {
      const rawRoll = rollRngDie(draft.rng, CAMPAIGN_TITLES[titleId].shotDieSides, `${title.name} shot for rank ${candidate.rank}`, dice);
      const modifier = titleShotModifier(titleId, title.division, campaignEntrantSide(draft, title.division, candidate.id), championSide, (title.shotsReceived[month] ?? []).includes(candidate.id), heldTitles(draft, candidate.id));
      // M12-ADJ-04: graded "crowd heat" term, present only while the extension is on.
      const heat = draft.finance ? titleShotPopularityHeat(entrantPopularity(draft, title.division, candidate.id)) : 0;
      const heatTerms = draft.finance ? [{ label: `popularity heat ${entrantPopularity(draft, title.division, candidate.id)}`, amount: heat }] : [];
      // M13-ADJ-03: a candidate in an active feud with the title holder is the
      // hotter draw and gains a graded feud term; present only while the booking
      // extension is on. It never bypasses the ranking start or popularity floor.
      const feud = draft.booking ? feudBetween(draft, title.holderId!, candidate.id) : undefined;
      const feudHeat = feud && feud.status === "active" ? feud.heat : 0;
      const feudTerm = feudHeat > 0 ? feudTitleShotTerm(feudHeat) : 0;
      const feudTerms = feudTerm !== 0 ? [{ label: `feud heat ${feudHeat} vs champion`, amount: feudTerm }] : [];
      const allTerms = [...modifier.terms, ...heatTerms, ...feudTerms];
      const modifiedRoll = rawRoll + modifier.total + heat + feudTerm;
      detail.push(`${candidate.id}: ${rawRoll} ${allTerms.map((row) => `${row.amount >= 0 ? "+" : ""}${row.amount} ${row.label}`).join(" ")} = ${modifiedRoll}; needs rank ${candidate.rank}.`);
      if (modifiedRoll < candidate.rank) continue;
      const id = stableId("title-shot", { campaignId: draft.campaignId, titleId, month, candidate: candidate.id, sequence: draft.titleShotOffers.length });
      const offer: TitleShotOffer = { id, titleId, month, candidateId: candidate.id, candidateRank: candidate.rank, rawRoll, modifiers: allTerms, modifiedRoll, status: "offered", detail: clone(detail) };
      draft.titleShotOffers.push(offer);
      // M13: record the consolidated roll breakdown on the grant event itself,
      // before any accept/decline decision — the same line the decisions panel
      // renders and the respond event later records, so the log shows the terms
      // from the moment the offer exists.
      detail.push(titleShotGrantLine(offer, candidate.id, title.name));
      detail.push(`Offer ${id} granted because ${modifiedRoll} >= ${candidate.rank}.`);
      return `Offered ${candidate.id} a ${title.name} shot.`;
    }
    return `No ${title.name} shot was granted in this traversal.`;
  });
}

/**
 * The extra (champion-granted) title-shot grant line, symmetric to
 * `titleShotGrantLine`: "{candidate} granted extra {title} shot" — e.g.
 * "t4 granted extra World Heavyweight shot (mandatory defenses complete
 * 2/2)". Recorded on the `schedule-match` event when `grantExtraTitleShot`
 * books the challenger, so the manual path carries the same consolidated
 * grant line the rolled path records on `roll-title-shot`.
 */
export function titleShotExtraGrantLine(candidateLabel: string, titleName: string, completedDefenses: number, requiredDefenses: number): string {
  return `${candidateLabel} granted extra ${titleName} shot (mandatory defenses complete ${completedDefenses}/${requiredDefenses}).`;
}

/**
 * The title-shot roll line shared by the decisions panel and the event log:
 * the raw roll, every graded term with its signed amount (M13-ADJ-03 feud
 * terms included), and the modified roll — e.g. "6 -3 same side (tag) +2 feud
 * heat 50 vs champion = 5". Kept in the core so respond-to-title-shot events
 * record exactly what the panel shows.
 */
export function titleShotRollLine(offer: { rawRoll: number; modifiers: Array<{ label: string; amount: number }>; modifiedRoll: number }): string {
  const terms = offer.modifiers.map((row) => `${row.amount >= 0 ? "+" : ""}${row.amount} ${row.label}`).join(" ");
  return `${offer.rawRoll}${terms ? ` ${terms}` : ""} = ${offer.modifiedRoll}`;
}

/**
 * The grant-event roll line the log records and the decisions panel surfaces:
 * "{candidate} granted {title} offer {id}; roll {titleShotRollLine}" — e.g.
 * "t2 granted World Tag offer title-shot-4c1632ac; roll 6 -3 same side (tag)
 * +3 feud heat 60 vs champion = 6.". One helper feeds both surfaces, so the
 * panel and the event log provably cannot drift apart. The event log passes
 * the raw entrant id; the panel passes the human label.
 */
export function titleShotGrantLine(offer: { id: string; rawRoll: number; modifiers: Array<{ label: string; amount: number }>; modifiedRoll: number }, candidateLabel: string, titleName: string): string {
  return `${candidateLabel} granted ${titleName} offer ${offer.id}; roll ${titleShotRollLine(offer)}.`;
}

export function respondToTitleShot(source: CampaignState, offerId: string, accept: boolean, date?: string): CampaignState {
  const response = transact(source, "respond-title-shot", { offerId, accept, date: date ?? null }, (draft, _dice, detail) => {
    const offer = draft.titleShotOffers.find((row) => row.id === offerId);
    if (!offer) throw new Error(`Unknown title-shot offer ${offerId}.`);
    if (offer.status !== "offered") throw new Error(`Title-shot offer ${offerId} is already ${offer.status}.`);
    offer.status = accept ? "accepted" : "declined";
    const title = draft.titles[offer.titleId];
    if (accept) {
      title.shotsReceived[offer.month] = [...(title.shotsReceived[offer.month] ?? []), offer.candidateId];
      if (draft.teams[offer.candidateId]) draft.teams[offer.candidateId].titleShotHistory.push({ titleId: offer.titleId, month: offer.month, accepted: true });
      detail.push(`${offer.candidateId} accepted ${title.name} offer ${offerId}; roll ${titleShotRollLine(offer)}.`);
    } else {
      if (draft.teams[offer.candidateId]) draft.teams[offer.candidateId].titleShotHistory.push({ titleId: offer.titleId, month: offer.month, accepted: false });
      detail.push(`${offer.candidateId} declined ${title.name} offer ${offerId}; roll ${titleShotRollLine(offer)} — candidate traversal may continue.`);
    }
    return `${accept ? "Accepted" : "Declined"} ${offerId}.`;
  });
  if (!accept) return response;
  const offer = response.titleShotOffers.find((row) => row.id === offerId)!;
  const title = response.titles[offer.titleId];
  const matchDate = date ?? addCalendarDays(response.currentDate, 1);
  const next = scheduleCampaignMatch(response, { date: matchDate, entrantIds: [offer.candidateId, title.holderId!], titleId: offer.titleId, mandatoryDefense: true, playerControlled: [offer.candidateId, title.holderId].includes(response.playerEntrantId) });
  return next;
}

export function grantExtraTitleShot(source: CampaignState, titleId: CampaignTitleId, candidateId: CampaignEntrantId, date?: string): CampaignState {
  const title = source.titles[titleId];
  if (!title.holderId) throw new Error(`${title.name} is vacant.`);
  if (title.completedDefenses < title.requiredDefenses) throw new Error(`${title.name} champion must complete ${title.requiredDefenses - title.completedDefenses} remaining mandatory defense(s) before granting an extra shot.`);
  if (candidateId === title.holderId || !entrantIds(source, title.division).includes(candidateId)) throw new Error(`${candidateId} is not a legal ${title.name} challenger.`);
  // M13: record the consolidated extra-shot grant line on the schedule event
  // itself, symmetric to rollTitleShot's consolidated grant line on the
  // roll-title-shot event — the manual path is auditable from the log too.
  const next = scheduleCampaignMatch(source, {
    date: date ?? addCalendarDays(source.currentDate, 1),
    entrantIds: [candidateId, title.holderId],
    titleId,
    mandatoryDefense: false,
    playerControlled: [candidateId, title.holderId].includes(source.playerEntrantId),
  });
  const event = next.events.at(-1)!;
  event.detail.push(titleShotExtraGrantLine(candidateId, next.titles[titleId].name, next.titles[titleId].completedDefenses, next.titles[titleId].requiredDefenses));
  return next;
}

/**
 * M13: start a new rivalry between two entrants (booking extension required).
 * No dice are consumed; the feud starts at the requested heat (default 50,
 * clamped to the 0-100 scale).
 */
export function startFeud(source: CampaignState, entrantIds: [CampaignEntrantId, CampaignEntrantId], options: { label?: string; initialHeat?: number } = {}): CampaignState {
  return transact(source, "start-feud", { entrantIds, options }, (draft, _dice, detail) => {
    if (!draft.booking) throw new Error("The M13 feud extension is not enabled on this campaign.");
    const [a, b] = entrantIds;
    if (a === b) throw new Error("A feud requires two different entrants.");
    for (const id of entrantIds) {
      if (!draft.roster[id] && !draft.teams[id]) throw new Error(`Unknown entrant ${id}.`);
    }
    const kinds = entrantIds.map((id) => entrantKind(draft.roster, draft.teams, id));
    if (kinds[0] !== kinds[1]) throw new Error(`A feud must pair two entrants of the same kind (both wrestlers or both tag teams); ${a} is a ${kinds[0]} entrant and ${b} is a ${kinds[1]} entrant (M13-ADJ-04).`);
    if (feudBetween(draft, a, b)) throw new Error(`A feud between ${a} and ${b} already exists.`);
    const scale = FEUD_HEAT_TABLE.scale;
    const feud: Feud = {
      id: stableId("feud", { entrantIds: [...entrantIds].sort() }),
      entrantIds,
      label: options.label ?? `${a} vs ${b}`,
      heat: Math.max(scale.floor, Math.min(scale.ceiling, options.initialHeat ?? 50)),
      status: "active",
      startedAt: draft.currentDate,
      lastMatchDate: null,
      matchCount: 0,
    };
    draft.booking.feuds.push(feud);
    detail.push(`Feud ${feud.label} started between ${a} and ${b} at heat ${feud.heat}.`);
    return `Started feud ${feud.id}.`;
  });
}

export function chooseCampaignAiDecision(state: CampaignState, type: CampaignAiDecision["type"], actorId: CampaignEntrantId, alternatives: Array<{ id: string; label: string; score: number; basis: string }>): CampaignAiDecision {
  if (!alternatives.length) throw new Error("Campaign AI requires at least one legal alternative.");
  const sorted = [...alternatives].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  return { type, actorId, legalAlternatives: clone(alternatives), selectedId: sorted[0].id, tiebreakRolls: [], explanation: `${sorted[0].label} selected at score ${sorted[0].score}: ${sorted[0].basis}. No hidden state or modifier used.` };
}

export function resolveVacantTitle(source: CampaignState, titleId: CampaignTitleId, date?: string): CampaignState {
  const title = source.titles[titleId];
  if (title.holderId) throw new Error(`${title.name} is not vacant.`);
  const candidates = source.rankings[title.division].entries.slice(0, source.vacancyMethod === "tournament" ? 4 : 2).map((row) => row.entrantId);
  if (candidates.length < 2) throw new Error(`${title.name} vacancy requires at least two ranked contenders.`);
  const startDate = date ?? addCalendarDays(source.currentDate, 1);
  const created = transact(source, "create-vacancy-competition", { titleId, method: source.vacancyMethod, candidates, startDate }, (draft, _dice, detail) => {
    const competition: VacancyCompetition = {
      id: stableId("vacancy", { campaignId: draft.campaignId, titleId, method: draft.vacancyMethod, candidates, sequence: draft.vacancies.length }),
      titleId,
      method: draft.vacancyMethod,
      entrantIds: clone(candidates),
      matchIds: [],
      advancingEntrantIds: [],
      status: "active",
      createdDate: draft.currentDate,
      detail: [`${draft.vacancyMethod} entrants: ${candidates.join(", ")}.`],
    };
    draft.vacancies.push(competition);
    detail.push(...competition.detail);
    return `Created ${competition.id}.`;
  });
  const competition = created.vacancies.at(-1)!;
  if (competition.method === "ranked-contenders") {
    return scheduleCampaignMatch(created, { date: startDate, entrantIds: [candidates[0], candidates[1]], vacancyTitleId: titleId, vacancyCompetitionId: competition.id, vacancyRound: "final", playerControlled: candidates.slice(0, 2).includes(created.playerEntrantId) });
  }
  if (candidates.length < 4) throw new Error(`${title.name} tournament requires four ranked entrants.`);
  let scheduled = scheduleCampaignMatch(created, { date: startDate, entrantIds: [candidates[0], candidates[3]], vacancyCompetitionId: competition.id, vacancyRound: "semifinal", playerControlled: [candidates[0], candidates[3]].includes(created.playerEntrantId) });
  scheduled = scheduleCampaignMatch(scheduled, { date: addCalendarDays(startDate, 1), entrantIds: [candidates[1], candidates[2]], vacancyCompetitionId: competition.id, vacancyRound: "semifinal", playerControlled: [candidates[1], candidates[2]].includes(scheduled.playerEntrantId) });
  return scheduled;
}

export function advanceVacancyCompetition(source: CampaignState, competitionId: string, date?: string): CampaignState {
  const competition = source.vacancies.find((row) => row.id === competitionId);
  if (!competition) throw new Error(`Unknown vacancy competition ${competitionId}.`);
  if (competition.status === "completed") throw new Error(`${competitionId} is already complete.`);
  if (competition.method === "ranked-contenders") {
    const final = source.schedule.find((row) => row.vacancyCompetitionId === competitionId && row.vacancyRound === "final");
    if (!final || final.status !== "completed" || source.titles[competition.titleId].holderId) throw new Error(`${competitionId} does not require another final.`);
    return scheduleCampaignMatch(source, { date: date ?? addCalendarDays(source.currentDate, 1), entrantIds: clone(final.entrantIds), vacancyTitleId: competition.titleId, vacancyCompetitionId: competition.id, vacancyRound: "final", playerControlled: final.entrantIds.includes(source.playerEntrantId) });
  }
  const semifinals = source.schedule.filter((row) => row.vacancyCompetitionId === competitionId && row.vacancyRound === "semifinal");
  if (semifinals.length !== 2 || semifinals.some((row) => row.status !== "completed")) throw new Error(`${competitionId} semifinals are not complete.`);
  if (competition.advancingEntrantIds.length !== 2) throw new Error(`${competitionId} requires two semifinal winners.`);
  const existingFinal = source.schedule.find((row) => row.vacancyCompetitionId === competitionId && row.vacancyRound === "final");
  if (existingFinal && existingFinal.status !== "completed") throw new Error(`${competitionId} final ${existingFinal.id} is already scheduled.`);
  return scheduleCampaignMatch(source, { date: date ?? addCalendarDays(source.currentDate, 1), entrantIds: [competition.advancingEntrantIds[0], competition.advancingEntrantIds[1]], vacancyTitleId: competition.titleId, vacancyCompetitionId: competition.id, vacancyRound: "final", playerControlled: competition.advancingEntrantIds.includes(source.playerEntrantId) });
}

export interface OfferContractRequest {
  weeklySalary: number;
  termWeeks: number;
  signingBonus?: number;
}

/**
 * M12-ADJ-06: offer a wrestler a contract and resolve their deterministic
 * response in one transaction. The wrestler auto-accepts a fair offer, rejects
 * a low one, and rolls a recorded D20 for a short one; an accepted offer signs
 * the contract immediately (bonus credited to the ledger and payouts). The
 * rejected path is recorded in the negotiation ledger, so the offer/reject flow
 * is fully inspectable and replayable.
 */
export function offerContract(source: CampaignState, wrestlerId: string, request: OfferContractRequest): CampaignState {
  return transact(source, "offer-contract", { wrestlerId, request }, (draft, dice, detail) => {
    if (!draft.roster[wrestlerId]) throw new Error(`Unknown campaign wrestler ${wrestlerId}.`);
    if (!draft.negotiation) throw new Error("Contract negotiation requires the M12 negotiation extension; enable negotiationPolicy at campaign creation.");
    if (draft.finance?.contracts[wrestlerId]) throw new Error(`${wrestlerId} already has a contract; wait for its expiry before negotiating.`);
    if (draft.negotiation.offers.some((offer) => offer.wrestlerId === wrestlerId && offer.status === "offered")) throw new Error(`${wrestlerId} already has an outstanding offer.`);
    const weeklySalary = request.weeklySalary;
    const termWeeks = request.termWeeks;
    const signingBonus = request.signingBonus ?? 0;
    if (!Number.isInteger(weeklySalary) || weeklySalary <= 0) throw new Error("Offer weekly salary must be a positive whole number.");
    if (!Number.isInteger(termWeeks) || termWeeks < 1) throw new Error("Offer term must be a positive whole number of weeks.");
    if (!Number.isInteger(signingBonus) || signingBonus < 0) throw new Error("Offer signing bonus must be a non-negative whole number.");
    const offer = resolveContractOfferCore(draft, { wrestlerId, weeklySalary, termWeeks, signingBonus, reason: "player" }, dice, detail);
    return `Offered ${wrestlerId} $${weeklySalary}/week; ${offer.status === "accepted" ? "signed" : "rejected"}.`;
  });
}

export interface SignContractRequest {
  weeklySalary: number;
  termWeeks: number;
  signingBonus?: number;
}

export function signContract(source: CampaignState, wrestlerId: string, request: SignContractRequest): CampaignState {
  return transact(source, "sign-contract", { wrestlerId, request }, (draft, _dice, detail) => {
    const record = draft.roster[wrestlerId];
    if (!record) throw new Error(`Unknown campaign wrestler ${wrestlerId}.`);
    if (!draft.finance) throw new Error("Contracts require the M12 contracts-and-finance extension; enable financePolicy at campaign creation.");
    if (draft.finance.contracts[wrestlerId]) throw new Error(`${wrestlerId} already has a contract.`);
    if (!Number.isInteger(request.weeklySalary) || request.weeklySalary <= 0) throw new Error("Weekly salary must be a positive whole number.");
    if (!Number.isInteger(request.termWeeks) || request.termWeeks < 1) throw new Error("Contract term must be a positive whole number of weeks.");
    const bonus = request.signingBonus ?? 0;
    if (!Number.isInteger(bonus) || bonus < 0) throw new Error("Signing bonus must be a non-negative whole number.");
    const contract: WrestlerContract = { wrestlerId, weeklySalary: request.weeklySalary, termWeeks: request.termWeeks, startDate: draft.currentDate, signingBonus: bonus };
    draft.finance.contracts[wrestlerId] = contract;
    if (bonus > 0) {
      draft.finance.ledgers[wrestlerId] = (draft.finance.ledgers[wrestlerId] ?? 0) + bonus;
      draft.finance.payouts.push({ date: draft.currentDate, weekIndex: 0, entries: [{ wrestlerId, amount: bonus }], total: bonus });
      detail.push(`${record.name}: signed a ${request.termWeeks}-week contract at $${request.weeklySalary}/week with a $${bonus} signing bonus.`);
    } else {
      detail.push(`${record.name}: signed a ${request.termWeeks}-week contract at $${request.weeklySalary}/week.`);
    }
    return `Signed ${wrestlerId}.`;
  });
}

export function applyCampaignProgression(source: CampaignState, wrestlerId: string, intent: Parameters<typeof applyProgression>[1]): CampaignState {
  return transact(source, "campaign-progression", { wrestlerId, intent }, (draft, _dice, detail) => {
    const record = draft.roster[wrestlerId];
    if (!record) throw new Error(`Unknown campaign wrestler ${wrestlerId}.`);
    if (intent.type === "award-match-wp") throw new Error("Campaign match awards are applied automatically and cannot be submitted manually.");
    const progressed = applyProgression(createProgressionState(record), intent);
    draft.roster[wrestlerId] = progressed.record;
    for (const team of Object.values(draft.teams)) if (team.memberIds.includes(wrestlerId)) team.careerWp = teamWp(draft, team);
    detail.push(...progressed.events[0].detail);
    return progressed.events[0].summary;
  });
}

export function validateCampaignState(value: CampaignState): string[] {
  const errors: string[] = [];
  if (value.schemaVersion !== CAMPAIGN_SCHEMA_VERSION) errors.push(`schemaVersion: expected ${CAMPAIGN_SCHEMA_VERSION}.`);
  if (value.rulesetVersion !== RULESET_VERSION) errors.push(`rulesetVersion: expected ${RULESET_VERSION}.`);
  if (value.campaignRulesetVersion !== CAMPAIGN_RULESET_VERSION) errors.push(`campaignRulesetVersion: expected ${CAMPAIGN_RULESET_VERSION}.`);
  if (value.dataPackVersion !== M5_DATA_PACK_VERSION) errors.push(`dataPackVersion: expected ${M5_DATA_PACK_VERSION}.`);
  if (value.dataHash !== M5_DATA_HASH) errors.push(`dataHash: expected ${M5_DATA_HASH}.`);
  if (value.postMatchInjuryPolicy === "d20-check" && value.postMatchInjuryVersion !== POST_MATCH_INJURY_POLICY_VERSION) errors.push(`postMatchInjuryVersion: d20-check policy requires ${POST_MATCH_INJURY_POLICY_VERSION}.`);
  if (value.postMatchInjuryPolicy !== "d20-check" && value.postMatchInjuryVersion !== undefined) errors.push("postMatchInjuryVersion: present without the d20-check policy.");
  if (value.aiDifficulty !== undefined && !(AI_DIFFICULTIES as readonly string[]).includes(value.aiDifficulty)) errors.push(`aiDifficulty: unsupported ${String(value.aiDifficulty)}.`);
  if (value.variety !== undefined && !(MATCH_VARIETIES as readonly string[]).includes(value.variety)) errors.push(`variety: unsupported ${String(value.variety)}.`);
  if (value.financePolicy === "contracts" && value.financeVersion !== FINANCE_POLICY_VERSION) errors.push(`financeVersion: contracts policy requires ${FINANCE_POLICY_VERSION}.`);
  if (value.financePolicy !== "contracts" && value.financeVersion !== undefined) errors.push("financeVersion: present without the contracts policy.");
  if (value.financePolicy === "contracts" && !value.finance) errors.push("finance: contracts policy requires the finance ledger.");
  if (value.financePolicy !== "contracts" && value.finance !== undefined) errors.push("finance: ledger present without the contracts policy.");
  if (value.bookingPolicy === "feuds" && value.bookingVersion !== BOOKING_POLICY_VERSION) errors.push(`bookingVersion: feuds policy requires ${BOOKING_POLICY_VERSION}.`);
  if (value.bookingPolicy !== "feuds" && value.bookingVersion !== undefined) errors.push("bookingVersion: present without the feuds policy.");
  if (value.bookingPolicy === "feuds" && !value.booking) errors.push("booking: feuds policy requires the booking ledger.");
  if (value.bookingPolicy !== "feuds" && value.booking !== undefined) errors.push("booking: ledger present without the feuds policy.");
  if (value.negotiationPolicy === "offers" && value.negotiationVersion !== NEGOTIATION_POLICY_VERSION) errors.push(`negotiationVersion: offers policy requires ${NEGOTIATION_POLICY_VERSION}.`);
  if (value.negotiationPolicy !== "offers" && value.negotiationVersion !== undefined) errors.push("negotiationVersion: present without the offers policy.");
  if (value.negotiationPolicy === "offers" && !value.negotiation) errors.push("negotiation: offers policy requires the negotiation ledger.");
  if (value.negotiationPolicy !== "offers" && value.negotiation !== undefined) errors.push("negotiation: ledger present without the offers policy.");
  if (value.negotiationPolicy === "offers" && value.financePolicy !== "contracts") errors.push("negotiation: the offers policy requires the M12 contracts-and-finance extension.");
  if (value.renewalStrategy !== undefined && value.negotiationPolicy !== "offers") errors.push("renewalStrategy: present without the offers negotiation policy.");
  if (value.renewalStrategy !== undefined && value.renewalStrategy !== "expiring-salary" && value.renewalStrategy !== "curve-fair") errors.push(`renewalStrategy: invalid value ${String(value.renewalStrategy)}.`);
  if (value.booking) {
    const booking = value.booking;
    if (booking.policyVersion !== BOOKING_POLICY_VERSION) errors.push(`booking.policyVersion: incompatible ${booking.policyVersion}.`);
    const feudIds = new Set<string>();
    for (const feud of booking.feuds) {
      if (feudIds.has(feud.id)) errors.push(`booking.feuds.${feud.id}: duplicate feud ID.`);
      feudIds.add(feud.id);
      if (feud.entrantIds[0] === feud.entrantIds[1]) errors.push(`booking.feuds.${feud.id}: duplicate entrant.`);
      for (const id of feud.entrantIds) if (!value.roster[id] && !value.teams[id]) errors.push(`booking.feuds.${feud.id}: unknown entrant ${id}.`);
      const feudKinds = feud.entrantIds.map((id) => (value.roster[id] ? "singles" : value.teams[id] ? "tag" : null));
      if (feudKinds[0] !== null && feudKinds[1] !== null && feudKinds[0] !== feudKinds[1]) errors.push(`booking.feuds.${feud.id}: mixed-entrant feud (${feud.entrantIds[0]} is a ${feudKinds[0]} entrant, ${feud.entrantIds[1]} is a ${feudKinds[1]} entrant); feuds must pair two entrants of the same kind (M13-ADJ-04).`);
      if (!Number.isInteger(feud.heat) || feud.heat < FEUD_HEAT_TABLE.scale.floor || feud.heat > FEUD_HEAT_TABLE.scale.ceiling) errors.push(`booking.feuds.${feud.id}: heat outside the ${FEUD_HEAT_TABLE.scale.floor}-${FEUD_HEAT_TABLE.scale.ceiling} scale.`);
      if (feud.status !== "active" && feud.status !== "cooling") errors.push(`booking.feuds.${feud.id}: invalid status ${String(feud.status)}.`);
      if (!Number.isInteger(feud.matchCount) || feud.matchCount < 0) errors.push(`booking.feuds.${feud.id}: invalid match count.`);
      if (feud.lastMatchDate !== null) { try { parseDate(feud.lastMatchDate); } catch (error) { errors.push(`booking.feuds.${feud.id}: ${String(error)}`); } }
    }
    for (const suggestion of booking.monthSuggestions) {
      if (suggestion.playerEntrantId !== value.playerEntrantId) errors.push(`booking.monthSuggestions: player mismatch (${suggestion.playerEntrantId}).`);
      if (!/^\d{4}-\d{2}$/.test(suggestion.month)) errors.push(`booking.monthSuggestions: invalid month ${suggestion.month}.`);
      const priorities = new Set(suggestion.items.map((item) => item.priority));
      if (priorities.size !== suggestion.items.length) errors.push(`booking.monthSuggestions: duplicate priority in ${suggestion.month}.`);
      for (const item of suggestion.items) {
        if (item.opponentId !== value.playerEntrantId && !value.roster[item.opponentId] && !value.teams[item.opponentId]) errors.push(`booking.monthSuggestions: unknown opponent ${item.opponentId}.`);
        if (item.titleId && !value.titles[item.titleId]) errors.push(`booking.monthSuggestions: unknown title ${item.titleId}.`);
      }
    }
  }
  if (value.negotiation) {
    const negotiation = value.negotiation;
    if (negotiation.policyVersion !== NEGOTIATION_POLICY_VERSION) errors.push(`negotiation.policyVersion: incompatible ${negotiation.policyVersion}.`);
    const offerIds = new Set<string>();
    for (const offer of negotiation.offers) {
      if (offerIds.has(offer.id)) errors.push(`negotiation.offers.${offer.id}: duplicate offer ID.`);
      offerIds.add(offer.id);
      if (!value.roster[offer.wrestlerId]) errors.push(`negotiation.offers.${offer.id}: unknown wrestler ${offer.wrestlerId}.`);
      if (!Number.isInteger(offer.weeklySalary) || offer.weeklySalary <= 0) errors.push(`negotiation.offers.${offer.id}: invalid weekly salary.`);
      if (!Number.isInteger(offer.termWeeks) || offer.termWeeks < 1) errors.push(`negotiation.offers.${offer.id}: invalid term.`);
      if (!Number.isInteger(offer.signingBonus) || offer.signingBonus < 0) errors.push(`negotiation.offers.${offer.id}: invalid signing bonus.`);
      if (offer.status !== "offered" && offer.status !== "accepted" && offer.status !== "rejected") errors.push(`negotiation.offers.${offer.id}: invalid status ${String(offer.status)}.`);
      if (offer.reason !== "player" && offer.reason !== "renewal") errors.push(`negotiation.offers.${offer.id}: invalid reason ${String(offer.reason)}.`);
      if (!Number.isInteger(offer.expectedSalary) || offer.expectedSalary < 0) errors.push(`negotiation.offers.${offer.id}: invalid expected salary.`);
      try {
        parseDate(offer.offeredAt);
        if (offer.resolvedAt) parseDate(offer.resolvedAt);
      } catch (error) { errors.push(`negotiation.offers.${offer.id}: ${String(error)}`); }
    }
  }
  if (value.finance) {
    const finance = value.finance;
    if (finance.policyVersion !== FINANCE_POLICY_VERSION) errors.push(`finance.policyVersion: incompatible ${finance.policyVersion}.`);
    try { parseDate(finance.nextPayoutDate); } catch (error) { errors.push(String(error)); }
    for (const [id, contract] of Object.entries(finance.contracts)) {
      if (contract.wrestlerId !== id) errors.push(`finance.contracts.${id}: record ID mismatch.`);
      if (!value.roster[id]) errors.push(`finance.contracts.${id}: unknown wrestler.`);
      if (!Number.isInteger(contract.weeklySalary) || contract.weeklySalary <= 0) errors.push(`finance.contracts.${id}: invalid weekly salary.`);
      if (!Number.isInteger(contract.termWeeks) || contract.termWeeks < 1) errors.push(`finance.contracts.${id}: invalid term.`);
      try { parseDate(contract.startDate); } catch (error) { errors.push(String(error)); }
      if (!Number.isInteger(contract.signingBonus) || contract.signingBonus < 0) errors.push(`finance.contracts.${id}: invalid signing bonus.`);
    }
    for (const pair of finance.chemistry) {
      if (pair.memberIds[0] === pair.memberIds[1]) errors.push("finance.chemistry: pair uses the same wrestler twice.");
      for (const id of pair.memberIds) if (!value.roster[id]) errors.push(`finance.chemistry: unknown wrestler ${id}.`);
    }
    for (const [id, ledger] of Object.entries(finance.ledgers)) {
      if (!value.roster[id]) errors.push(`finance.ledgers.${id}: unknown wrestler.`);
      if (!Number.isInteger(ledger) || ledger < 0) errors.push(`finance.ledgers.${id}: invalid amount.`);
    }
    for (const [id, pop] of Object.entries(finance.popularity)) {
      if (!value.roster[id]) errors.push(`finance.popularity.${id}: unknown wrestler.`);
      if (!Number.isInteger(pop) || pop < POPULARITY_MOVEMENT_TABLE.scale.floor || pop > POPULARITY_MOVEMENT_TABLE.scale.ceiling) errors.push(`finance.popularity.${id}: outside the ${POPULARITY_MOVEMENT_TABLE.scale.floor}-${POPULARITY_MOVEMENT_TABLE.scale.ceiling} scale.`);
    }
  }
  try { parseDate(value.startDate); parseDate(value.currentDate); } catch (error) { errors.push(String(error)); }
  if (value.currentDate < value.startDate) errors.push("currentDate: cannot precede startDate.");
  if (!value.roster[value.playerEntrantId] && !value.teams[value.playerEntrantId]) errors.push("playerEntrantId: missing from roster/teams.");
  for (const [id, record] of Object.entries(value.roster)) {
    if (record.id !== id) errors.push(`roster.${id}: record ID mismatch.`);
    errors.push(...validateWrestlerRecord(record).map((line) => `roster.${id}.${line}`));
  }
  for (const team of Object.values(value.teams)) {
    if (team.memberIds[0] === team.memberIds[1]) errors.push(`teams.${team.id}: duplicate member.`);
    for (const id of team.memberIds) if (!value.roster[id]) errors.push(`teams.${team.id}: missing member ${id}.`);
  }
  for (const title of Object.values(value.titles) as TitleState[]) {
    if (title.holderId && !(title.division === "singles" ? value.roster[title.holderId] : value.teams[title.holderId])) errors.push(`titles.${title.id}: invalid holder ${title.holderId}.`);
    if ((title.holderId === null) !== (title.status === "vacant")) errors.push(`titles.${title.id}: holder/status mismatch.`);
    if (title.requiredDefenses < 0 || title.completedDefenses < 0) errors.push(`titles.${title.id}: invalid defense count.`);
  }
  const scheduleIds = new Set<string>();
  for (const match of value.schedule) {
    if (scheduleIds.has(match.id)) errors.push(`schedule.${match.id}: duplicate ID.`);
    scheduleIds.add(match.id);
    if (match.entrantIds[0] === match.entrantIds[1]) errors.push(`schedule.${match.id}: duplicate entrant.`);
    if (match.result && match.status !== "completed") errors.push(`schedule.${match.id}: result exists outside completed status.`);
    if (match.aiDifficulty !== undefined && !(AI_DIFFICULTIES as readonly string[]).includes(match.aiDifficulty)) errors.push(`schedule.${match.id}: unsupported aiDifficulty ${String(match.aiDifficulty)}.`);
    if (match.variety !== undefined && !(MATCH_VARIETIES as readonly string[]).includes(match.variety)) errors.push(`schedule.${match.id}: unsupported variety ${String(match.variety)}.`);
    if (match.variety && match.variety !== "standard" && match.mode === "tag") errors.push(`schedule.${match.id}: ${match.variety} matches are singles-only.`);
  }
  if (new Set(value.appliedMatchIds).size !== value.appliedMatchIds.length) errors.push("appliedMatchIds: duplicate result-application key.");
  for (const id of value.appliedMatchIds) if (!value.schedule.find((row) => row.id === id && row.status === "completed" && row.result)) errors.push(`appliedMatchIds.${id}: no completed result.`);
  if (Boolean(value.activeMatchId) !== Boolean(value.activeMatch)) errors.push("activeMatch: ID/state presence mismatch.");
  if (value.activeMatchId && !value.schedule.find((row) => row.id === value.activeMatchId && row.status === "in-progress")) errors.push("activeMatchId: does not reference an in-progress schedule row.");
  return errors;
}

export function campaignSummary(state: CampaignState): Record<string, number | string> {
  return {
    date: state.currentDate,
    days: daysBetween(state.startDate, state.currentDate),
    events: state.events.length,
    scheduledMatches: state.schedule.length,
    completedMatches: state.schedule.filter((row) => row.status === "completed").length,
    titleChanges: (Object.values(state.titles) as TitleState[]).reduce((sum, title) => sum + title.history.filter((row) => row.type === "won").length, 0),
    activeInjuries: state.injuries.filter((row) => row.active).length,
    strippingEvents: (Object.values(state.titles) as TitleState[]).reduce((sum, title) => sum + title.history.filter((row) => row.type === "stripped").length, 0),
    ...(state.finance
      ? {
          financePayouts: state.finance.payouts.length,
          financeLedgerTotal: Object.values(state.finance.ledgers).reduce((sum, value) => sum + value, 0),
          financePopularity: state.finance.popularity[state.playerEntrantId] ?? null,
        }
      : {}),
    ...(state.booking
      ? {
          feudCount: state.booking.feuds.length,
          bookingSuggestions: state.booking.monthSuggestions.length,
          ...(state.booking.feuds.some((feud) => feud.entrantIds.includes(state.playerEntrantId))
            ? { feudHeat: state.booking.feuds.find((feud) => feud.entrantIds.includes(state.playerEntrantId))!.heat }
            : {}),
        }
      : {}),
    ...(state.negotiation
      ? {
          negotiationOffers: state.negotiation.offers.length,
          negotiationAccepted: state.negotiation.offers.filter((offer) => offer.status === "accepted").length,
        }
      : {}),
    canonicalHash: hashCampaignState(state),
  };
}

export function campaignEntrantLabel(state: CampaignState, division: CampaignDivision, entrantId: CampaignEntrantId): string {
  return division === "singles" ? state.roster[entrantId]?.name ?? entrantId : state.teams[entrantId]?.name ?? entrantId;
}

export function suggestPlayerMatch(state: CampaignState): ScheduleMatchRequest {
  if (state.activeMatch) throw new Error("Finish the active match before requesting another booking.");
  const existing = state.schedule.find((row) => row.status === "scheduled" && row.entrantIds.includes(state.playerEntrantId));
  if (existing) throw new Error(`Player entrant already has scheduled match ${existing.id} on ${existing.date}.`);
  const requiredTitle = titleForEntrant(state, state.playerEntrantId, state.playerDivision)
    .find((title) => title.completedDefenses + scheduledDefenseCount(state, title.id, campaignMonth(state.currentDate)) < title.requiredDefenses);
  const candidates = state.rankings[state.playerDivision].entries.map((row) => row.entrantId).filter((id) => id !== state.playerEntrantId);
  const available = candidates.filter((id) => wrestlerIdsForEntrant(state, state.playerDivision, id).every((wrestlerId) => !injuryActiveOn(state, wrestlerId, state.currentDate)));
  if (!available.length) throw new Error("No legal, available ranked opponent exists on the current date.");
  // M13-ADJ-02: with the booking extension on, the player's hottest active feud
  // rival is the preferred optional opponent (the feud is the draw).
  let opponent = available[0];
  let feudPick = false;
  if (state.booking) {
    const feudRival = state.booking.feuds
      .filter((feud) => feud.status === "active" && feud.entrantIds.includes(state.playerEntrantId))
      .map((feud) => ({ feud, rival: feud.entrantIds.find((id) => id !== state.playerEntrantId)! }))
      .filter(({ rival }) => available.includes(rival))
      .sort((left, right) => right.feud.heat - left.feud.heat || currentRank(state, state.playerDivision, right.rival) - currentRank(state, state.playerDivision, left.rival) || left.rival.localeCompare(right.rival));
    if (feudRival.length) {
      opponent = feudRival[0].rival;
      feudPick = true;
    }
  }
  // M12-ADJ-04: with the finance extension on and no feud pick above, bookings
  // prefer the most popular available ranked opponent (draw-building); ties
  // keep rank order. (The feud pick, when present, is the hotter draw and
  // already won the preference.)
  if (!feudPick && state.finance) {
    for (const id of available.slice(1)) {
      if (entrantPopularity(state, state.playerDivision, id) > entrantPopularity(state, state.playerDivision, opponent)) opponent = id;
    }
  }
  return {
    date: state.currentDate,
    entrantIds: [state.playerEntrantId, opponent],
    titleId: requiredTitle?.id ?? null,
    mandatoryDefense: Boolean(requiredTitle),
    playerControlled: true,
  };
}

export function declineSuggestedMatch(source: CampaignState): CampaignState {
  const suggestion = suggestPlayerMatch(source);
  return transact(source, "decline-match-offer", { suggestion }, (_draft, _dice, detail) => {
    detail.push(`Player declined the optional ${source.playerDivision} match against ${suggestion.entrantIds[1]} on ${suggestion.date}.`, "No booking was created and no die was consumed.");
    return "Declined optional match offer.";
  });
}
