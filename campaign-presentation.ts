import {
  ATTRIBUTE_ADVANCEMENT_COSTS,
  addCalendarDays,
  campaignEntrantLabel,
  contractActiveOn,
  expectedWeeklySalary,
  feudTitleShotTerm,
  suggestPlayerMatch,
  titleShotGrantLine,
  titleShotRollLine,
} from "../core";
import type {
  CampaignDivision,
  CampaignEntrantId,
  CampaignState,
  CampaignEvent,
  MatchResult,
  PayoutRecord,
  TitleState,
} from "../core";

export type CareerAction =
  | "accept-offer"
  | "advance-day"
  | "roll-title-shot"
  | "resolve-vacancy"
  | "play-due-match"
  | "spend-wp";

export type PlayerOutcome = "win" | "loss" | "draw" | null;

// Single source of truth lives in the core (campaign.ts) so respond-to-title-shot
// events record the same roll line the decisions panel shows, and the grant-event
// line is shared with the log verbatim. Re-exported here to keep the App and
// tests importing from the presenter.
export { titleShotGrantLine, titleShotRollLine };

export type OnboardingView = "exhibition" | "creator" | "progression" | "career";

export interface OnboardingStep {
  id: string;
  kicker: string;
  title: string;
  view: OnboardingView;
  points: string[];
}

export interface PostMatchReport {
  matchId: string;
  date: string;
  mode: "singles" | "tag";
  summary: string;
  method: MatchResult["method"];
  playerInvolved: boolean;
  playerOutcome: PlayerOutcome;
  opponentLabel: string | null;
  titleImpact: string | null;
  rankingNotes: string | null;
  injuries: string[];
  wpAwarded: number;
  matchHash: string;
}

export interface MonthEndSummary {
  month: string;
  division: CampaignDivision;
  playerRank: number | null;
  playerPriorRank: number | null;
  playerMovement: number | null;
  headline: string[];
  injuries: string[];
  /** Player-roster wrestlers laid off (active) at month end, e.g. "Career Wrestler 5 (3 weeks, out until 1991-01-22)". */
  rosterLayoffs: string[];
  /** Player-roster wrestlers whose match injury resolved during the month, e.g. "Career Wrestler 6 (returned 1991-01-28)". */
  rosterRecoveries: string[];
  /** M12 finance line for the month, e.g. "Finance: $350 paid (2 payouts); popularity Career Wrestler 5 50→53." */
  financeLine: string | null;
  /** Autosave ring line, e.g. "Autosaves: 4 snapshots retained; newest restore point 1991-01-22." */
  autosaveLine: string | null;
  /** M13 booking-card feud line for the closing month, e.g. "Booking card: feud vs Career Team 2 (heat 45)." (singles and tag careers alike). */
  bookingLine: string | null;
}

/** Storage-derived autosave ring facts surfaced in the month-end report (retention count and the newest restore point). */
export interface MonthEndAutosaveFacts {
  retained: number;
  newestRestorePoint: string | null;
}

export interface FinanceContractRow {
  wrestlerId: string;
  name: string;
  weeklySalary: number;
  termWeeks: number;
  startDate: string;
  signingBonus: number;
  active: boolean;
  ledger: number;
  popularity: number;
}

export interface FinancePayoutRow {
  date: string;
  weekIndex: number;
  entries: Array<{ wrestlerId: string; name: string; amount: number }>;
  total: number;
}

export interface FinanceSummary {
  enabled: boolean;
  nextPayoutDate: string | null;
  contracts: FinanceContractRow[];
  payouts: FinancePayoutRow[];
  ledgerTotal: number;
  popularityHistory: Array<{ date: string; wrestlerId: string; name: string; from: number; to: number; delta: number; reason: string }>;
}

export interface CareerDossierData {
  campaignId: string;
  name: string;
  date: string;
  division: CampaignDivision;
  entrant: string;
  record: { wins: number; draws: number; losses: number; matches: number };
  titles: { won: number; retained: number; lost: number; current: string[] };
  wp: { awarded: number; spent: number; balance: number };
  injuries: { count: number; weeks: number; active: number };
  titleShots: { accepted: number; declined: number };
  vacancyWins: number;
}

export interface CareerDossier extends CareerDossierData {
  toJson: () => string;
  toCsv: () => string;
}

export interface BlockedReason {
  action: CareerAction;
  label: string;
  blocked: boolean;
  reasons: string[];
  hint: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function monthStart(month: string): string {
  return `${month}-01`;
}

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function playerWrestlerIds(state: CampaignState): string[] {
  return state.playerDivision === "singles"
    ? [state.playerEntrantId]
    : [...state.teams[state.playerEntrantId].memberIds];
}

function playerMatches(state: CampaignState) {
  return state.schedule.filter(
    (row) => row.status === "completed" && row.result && row.entrantIds.includes(state.playerEntrantId),
  );
}

function extractWpAward(event: CampaignEvent, state: CampaignState, wrestlerIds: string[]): number {
  const names = wrestlerIds.map((id) => state.roster[id]?.name).filter(Boolean) as string[];
  if (!names.length) return 0;
  let total = 0;
  for (const line of event.detail) {
    for (const name of names) {
      const match = line.match(new RegExp(`^${escapeRegExp(name)}: .*?WP (\\d+) \\+ (\\d+) = \\d+\\.`, "i"));
      if (match) total += Number(match[2]);
    }
  }
  return total;
}

function wpAwardedForMatch(state: CampaignState, matchId: string): number {
  const event = state.events.find(
    (row) => row.type === "commit-match-result" && String((row.input as { matchId?: unknown }).matchId) === matchId,
  );
  if (!event) return 0;
  return extractWpAward(event, state, playerWrestlerIds(state));
}

function parseFirst(text: string, pattern: RegExp): number {
  const match = text.match(pattern);
  return match ? Number(match[1]) : 0;
}

function progressionCost(event: CampaignEvent): number {
  const text = event.detail.join(" ");
  const intent = (event.input as { intent?: { type?: string } }).intent;
  switch (intent?.type) {
    case "increase-attribute":
      return parseFirst(text, /cost (\d+) WP\./);
    case "increase-skill":
      return parseFirst(text, /\+1 for (\d+) WP/);
    case "increase-maneuver":
      return parseFirst(text, /; (\d+) WP; breadth/);
    case "reduce-drawback":
      return parseFirst(text, /cost (\d+) WP point-for-point/);
    default:
      return 0;
  }
}

function csvCell(value: string | number): string {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvFromDossier(data: CareerDossierData): string {
  const rows: Array<[string, string | number]> = [
    ["career_name", data.name],
    ["current_date", data.date],
    ["division", data.division],
    ["entrant", data.entrant],
    ["matches", data.record.matches],
    ["wins", data.record.wins],
    ["draws", data.record.draws],
    ["losses", data.record.losses],
    ["title_wins", data.titles.won],
    ["title_retains", data.titles.retained],
    ["title_losses", data.titles.lost],
    ["titles_held", data.titles.current.join(";")],
    ["wp_awarded", data.wp.awarded],
    ["wp_spent", data.wp.spent],
    ["wp_balance", data.wp.balance],
    ["injuries", data.injuries.count],
    ["injury_weeks", data.injuries.weeks],
    ["injuries_active", data.injuries.active],
    ["title_shots_accepted", data.titleShots.accepted],
    ["title_shots_declined", data.titleShots.declined],
    ["vacancy_wins", data.vacancyWins],
  ];
  return `${rows.map(([key, value]) => `${csvCell(key)},${csvCell(value)}`).join("\n")}\n`;
}

export function buildPostMatchReport(state: CampaignState): PostMatchReport | null {
  const lastMatchId = state.matchHistory.at(-1);
  if (!lastMatchId) return null;
  const match = state.schedule.find((row) => row.id === lastMatchId && row.result);
  if (!match?.result) return null;
  const playerInvolved = match.entrantIds.includes(state.playerEntrantId);
  let playerOutcome: PlayerOutcome = null;
  if (playerInvolved) {
    if (match.result.winnerEntrantId === state.playerEntrantId) playerOutcome = "win";
    else if (match.result.loserEntrantId === state.playerEntrantId) playerOutcome = "loss";
    else playerOutcome = "draw";
  }
  const opponentLabel = playerInvolved
    ? campaignEntrantLabel(
        state,
        match.mode === "tag" ? "tag" : "singles",
        match.entrantIds.find((id) => id !== state.playerEntrantId)!,
      )
    : null;
  const titleId = match.titleId ?? match.vacancyTitleId;
  const title = titleId ? state.titles[titleId] : null;
  const titleEvent = title ? [...title.history].reverse().find((row) => row.matchId === match.id) : null;
  const titleImpact = title
    ? titleEvent
      ? `${titleEvent.type === "won" ? (match.vacancyTitleId ? "Filled vacant" : "Won") : titleEvent.type === "retained" ? "Retained" : titleEvent.type} ${title.name} — ${titleEvent.detail}`
      : `Title match: ${title.name}`
    : null;
  const division = match.mode === "tag" ? "tag" : "singles";
  const table = state.rankings[division];
  const entry = table?.entries.find((row) => row.entrantId === state.playerEntrantId);
  const rankingNotes =
    entry && playerInvolved
      ? `Current #${entry.rank}${entry.priorRank !== entry.rank ? ` (was #${entry.priorRank})` : ""}`
      : playerInvolved
        ? "Unranked in the current table"
        : null;
  const injuries = state.injuries
    .filter((row) => row.sourceMatchId === match.id)
    .map((row) => `${state.roster[row.wrestlerId]?.name ?? row.wrestlerId}: ${row.weeks} week layoff, eligible ${row.returnDate}`);
  return {
    matchId: match.id,
    date: match.date,
    mode: match.mode,
    summary: match.result.summary,
    method: match.result.method,
    playerInvolved,
    playerOutcome,
    opponentLabel,
    titleImpact,
    rankingNotes,
    injuries,
    wpAwarded: wpAwardedForMatch(state, match.id),
    matchHash: match.result.finalMatchHash,
  };
}

export function buildMonthEndSummary(state: CampaignState, autosave?: MonthEndAutosaveFacts): MonthEndSummary | null {
  const division = state.playerDivision;
  const table = state.rankings[division];
  if (!table || !table.entries.length) return null;
  const month = table.month;
  const entry = table.entries.find((row) => row.entrantId === state.playerEntrantId);
  const start = monthStart(month);
  const end = monthEnd(month);
  const headline: string[] = [];
  for (const title of Object.values(state.titles) as TitleState[]) {
    for (const row of title.history) {
      if (row.date < start || row.date > end) continue;
      if (row.type === "created") continue;
      headline.push(`${title.name}: ${row.detail}`);
      if (headline.length >= 8) break;
    }
    if (headline.length >= 8) break;
  }
  const injuries = state.injuries
    .filter((row) => row.occurredDate >= start && row.occurredDate <= end)
    .map((row) => `${state.roster[row.wrestlerId]?.name ?? row.wrestlerId} (${row.weeks} weeks)`);
  const rosterIds = playerWrestlerIds(state);
  const rosterInjuries = state.injuries.filter((row) => rosterIds.includes(row.wrestlerId));
  const rosterLayoffs = rosterInjuries
    .filter((row) => row.active)
    .map((row) => `${state.roster[row.wrestlerId]?.name ?? row.wrestlerId} (${row.weeks} weeks, out until ${row.returnDate})`);
  const rosterRecoveries = rosterInjuries
    .filter((row) => !row.active && row.returnDate >= start && row.returnDate <= end)
    .map((row) => `${state.roster[row.wrestlerId]?.name ?? row.wrestlerId} (returned ${row.returnDate})`);
  const finance = state.finance;
  let financeLine: string | null = null;
  if (finance) {
    const rosterIds = playerWrestlerIds(state);
    const monthPayouts = finance.payouts.filter((row) => row.date >= start && row.date <= end);
    const monthTotal = monthPayouts.reduce((sum, row) => sum + row.total, 0);
    const parts: string[] = [];
    if (monthPayouts.length) parts.push(`$${monthTotal} paid (${monthPayouts.length} payout${monthPayouts.length === 1 ? "" : "s"})`);
    const movements = finance.popularityHistory.filter((row) => rosterIds.includes(row.wrestlerId) && row.date >= start && row.date <= end);
    if (movements.length) {
      parts.push(`popularity ${movements.map((row) => `${state.roster[row.wrestlerId]?.name ?? row.wrestlerId} ${row.from}→${row.to}`).join(", ")}`);
    }
    if (parts.length) financeLine = `Finance: ${parts.join("; ")}.`;
  }
  let autosaveLine: string | null = null;
  if (autosave && autosave.retained > 0 && autosave.newestRestorePoint) {
    autosaveLine = `Autosaves: ${autosave.retained} snapshot${autosave.retained === 1 ? "" : "s"} retained; newest restore point ${autosave.newestRestorePoint.slice(0, 10)}.`;
  }
  // M13: surface the freshly generated booking card from the banner — every
  // item in priority order (required defense, the feud draw, the optional
  // opponent), so the whole card is readable without opening the panel. The
  // same booking.monthSuggestions source feeds the singles and tag flows, so a
  // tag career player sees the same banner line a singles player does.
  let bookingLine: string | null = null;
  const card = state.booking?.monthSuggestions.at(-1);
  if (card && card.items.length) {
    const parts: string[] = [];
    for (const item of card.items) {
      const opponent = campaignEntrantLabel(state, division, item.opponentId);
      if (item.kind === "required-defense") {
        const titleName = item.titleId ? (state.titles[item.titleId]?.name ?? item.titleId) : "Title";
        // A defense due with no eligible ranked contender names the player and
        // the reason (the card's own basis), instead of a bare self-vs-self.
        parts.push(
          item.opponentId === state.playerEntrantId
            ? `${titleName} defense (no eligible ranked contender)`
            : `${titleName} defense vs ${opponent}`,
        );
      } else if (item.kind === "feud") {
        const feud = state.booking!.feuds.find((row) => row.id === item.feudId);
        const heatParts: string[] = [];
        if (feud) heatParts.push(`heat ${feud.heat}`);
        // M13-ADJ-03: when the feud rival holds a title in the player's
        // division, a title shot against that champion would carry the graded
        // feud term the decisions panel shows ("+2 feud heat 50 vs champion") —
        // mirror it in the banner so the booking line and the panel can't drift
        // apart. Amount and label come from the same core rule function used by
        // rollTitleShot.
        const rivalHoldsDivisionTitle = (Object.values(state.titles) as TitleState[]).some(
          (row) => row.division === division && row.holderId === item.opponentId,
        );
        if (feud && rivalHoldsDivisionTitle) {
          const term = feudTitleShotTerm(feud.heat);
          if (term !== 0) heatParts.push(`title-shot +${term} feud heat ${feud.heat} vs champion`);
        }
        parts.push(`feud vs ${opponent}${heatParts.length ? ` (${heatParts.join("; ")})` : ""}`);
      } else {
        parts.push(`optional vs ${opponent}`);
      }
    }
    bookingLine = `Booking card for ${card.month}: ${parts.join("; ")}.`;
  }
  return {
    month,
    division,
    playerRank: entry?.rank ?? null,
    playerPriorRank: entry?.priorRank ?? null,
    playerMovement: entry && entry.priorRank ? entry.rank - entry.priorRank : null,
    headline,
    injuries,
    rosterLayoffs,
    rosterRecoveries,
    financeLine,
    autosaveLine,
    bookingLine,
  };
}

/** Renders the M12 finance ledger into display rows (present iff financePolicy is enabled). */
export function buildFinanceSummary(state: CampaignState): FinanceSummary {
  const finance = state.finance;
  if (!finance) {
    return { enabled: false, nextPayoutDate: null, contracts: [], payouts: [], ledgerTotal: 0, popularityHistory: [] };
  }
  const contracts: FinanceContractRow[] = Object.values(finance.contracts)
    .map((contract) => ({
      wrestlerId: contract.wrestlerId,
      name: state.roster[contract.wrestlerId]?.name ?? contract.wrestlerId,
      weeklySalary: contract.weeklySalary,
      termWeeks: contract.termWeeks,
      startDate: contract.startDate,
      signingBonus: contract.signingBonus,
      active: contractActiveOn(contract, state.currentDate),
      ledger: finance.ledgers[contract.wrestlerId] ?? 0,
      popularity: finance.popularity[contract.wrestlerId] ?? 50,
    }))
    .sort((a, b) => b.weeklySalary - a.weeklySalary || a.name.localeCompare(b.name));
  const payouts: FinancePayoutRow[] = [...finance.payouts]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 8)
    .map((row: PayoutRecord) => ({
      date: row.date,
      weekIndex: row.weekIndex,
      entries: row.entries.map((entry) => ({ wrestlerId: entry.wrestlerId, name: state.roster[entry.wrestlerId]?.name ?? entry.wrestlerId, amount: entry.amount })),
      total: row.total,
    }));
  const popularityHistory = [...finance.popularityHistory]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 8)
    .map((row) => ({ date: row.date, wrestlerId: row.wrestlerId, name: state.roster[row.wrestlerId]?.name ?? row.wrestlerId, from: row.from, to: row.to, delta: row.delta, reason: row.reason }));
  return {
    enabled: true,
    nextPayoutDate: finance.nextPayoutDate,
    contracts,
    payouts,
    ledgerTotal: Object.values(finance.ledgers).reduce((sum, value) => sum + value, 0),
    popularityHistory,
  };
}

export interface NegotiationContractRow {
  wrestlerId: string;
  name: string;
  weeklySalary: number;
  termWeeks: number;
  startDate: string;
  expiryDate: string;
  active: boolean;
  /** Expires within the next 14 days or already expired with a renewal pending. */
  expiringSoon: boolean;
  popularity: number;
  expectedSalary: number;
}

export interface NegotiationOfferRow {
  offerId: string;
  wrestlerId: string;
  name: string;
  weeklySalary: number;
  termWeeks: number;
  signingBonus: number;
  offeredAt: string;
  expectedSalary: number;
  basis: string;
  reason: "player" | "renewal";
}

export interface NegotiationHistoryRow {
  date: string;
  wrestlerId: string;
  name: string;
  type: "accepted" | "rejected";
  weeklySalary: number;
  expectedSalary: number;
  basis: string;
}

export interface NegotiationSummary {
  enabled: boolean;
  /** M12-ADJ-09: the active expiry-renewal strategy, so the dashboard can show what the setup form chose. */
  renewalStrategy: "expiring-salary" | "curve-fair";
  contracts: NegotiationContractRow[];
  freeAgents: Array<{ wrestlerId: string; name: string; popularity: number; expectedSalary: number; outstandingOffer: boolean }>;
  outstandingOffers: NegotiationOfferRow[];
  history: NegotiationHistoryRow[];
}

/**
 * M12-ADJ-06/07/08: presenter for the negotiation dashboard panel. Lists every
 * contract with its expiry and the salary-curve expectation, flags expiring
 * deals, and surfaces the deterministic accept/reject basis from the offer
 * ledger. Free agents (uncontracted wrestlers) carry their popularity and
 * expected weekly salary so the player can aim an offer at the curve.
 */
export function buildNegotiationSummary(state: CampaignState): NegotiationSummary {
  if (!state.negotiation || !state.finance) {
    return { enabled: false, renewalStrategy: "expiring-salary", contracts: [], freeAgents: [], outstandingOffers: [], history: [] };
  }
  const negotiation = state.negotiation;
  const finance = state.finance;
  const contracted = new Set(Object.keys(finance.contracts));
  const contracts: NegotiationContractRow[] = Object.values(finance.contracts)
    .map((contract) => {
      const popularity = finance.popularity[contract.wrestlerId] ?? 50;
      const expiryDate = addCalendarDays(contract.startDate, contract.termWeeks * 7);
      const active = contractActiveOn(contract, state.currentDate);
      return {
        wrestlerId: contract.wrestlerId,
        name: state.roster[contract.wrestlerId]?.name ?? contract.wrestlerId,
        weeklySalary: contract.weeklySalary,
        termWeeks: contract.termWeeks,
        startDate: contract.startDate,
        expiryDate,
        active,
        expiringSoon: !active || expiryDate <= addCalendarDays(state.currentDate, 14),
        popularity,
        expectedSalary: expectedWeeklySalary(popularity),
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.expiryDate.localeCompare(b.expiryDate) || a.name.localeCompare(b.name));
  const freeAgents = Object.values(state.roster)
    .filter((record) => !contracted.has(record.id))
    .map((record) => {
      const popularity = finance.popularity[record.id] ?? 50;
      return {
        wrestlerId: record.id,
        name: record.name,
        popularity,
        expectedSalary: expectedWeeklySalary(popularity),
        outstandingOffer: negotiation.offers.some((offer) => offer.wrestlerId === record.id && offer.status === "offered"),
      };
    })
    .sort((a, b) => b.expectedSalary - a.expectedSalary || a.name.localeCompare(b.name));
  const outstandingOffers: NegotiationOfferRow[] = negotiation.offers
    .filter((offer) => offer.status === "offered")
    .map((offer) => ({
      offerId: offer.id,
      wrestlerId: offer.wrestlerId,
      name: state.roster[offer.wrestlerId]?.name ?? offer.wrestlerId,
      weeklySalary: offer.weeklySalary,
      termWeeks: offer.termWeeks,
      signingBonus: offer.signingBonus,
      offeredAt: offer.offeredAt,
      expectedSalary: offer.expectedSalary,
      basis: offer.basis,
      reason: offer.reason,
    }))
    .sort((a, b) => a.offeredAt.localeCompare(b.offeredAt));
  const history: NegotiationHistoryRow[] = [...negotiation.history]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 8)
    .map((row) => ({
      date: row.date,
      wrestlerId: row.wrestlerId,
      name: state.roster[row.wrestlerId]?.name ?? row.wrestlerId,
      type: row.type,
      weeklySalary: row.weeklySalary,
      expectedSalary: row.expectedSalary,
      basis: row.basis,
    }));
  return {
    enabled: true,
    renewalStrategy: state.renewalStrategy ?? "expiring-salary",
    contracts,
    freeAgents,
    outstandingOffers,
    history,
  };
}

export function buildCareerDossier(state: CampaignState): CareerDossier {
  const matches = playerMatches(state);
  const wins = matches.filter((row) => row.result!.winnerEntrantId === state.playerEntrantId).length;
  const losses = matches.filter((row) => row.result!.loserEntrantId === state.playerEntrantId).length;
  const titleStates = Object.values(state.titles) as TitleState[];
  const won = titleStates.reduce(
    (sum, title) => sum + title.history.filter((row) => row.entrantId === state.playerEntrantId && row.type === "won").length,
    0,
  );
  const retained = titleStates.reduce(
    (sum, title) => sum + title.history.filter((row) => row.entrantId === state.playerEntrantId && row.type === "retained").length,
    0,
  );
  const lost = titleStates.filter(
    (title) =>
      title.history.some((row) => row.entrantId === state.playerEntrantId && row.type === "won") &&
      title.holderId !== state.playerEntrantId,
  ).length;
  const current = titleStates.filter((title) => title.holderId === state.playerEntrantId).map((title) => title.name);
  const wrestlerIds = playerWrestlerIds(state);
  const awarded = state.events
    .filter((row) => row.type === "commit-match-result")
    .reduce((sum, row) => sum + extractWpAward(row, state, wrestlerIds), 0);
  const spentEvents = state.events.filter(
    (row) => row.type === "campaign-progression" && wrestlerIds.includes(String((row.input as { wrestlerId?: unknown }).wrestlerId)),
  );
  const spent = spentEvents.reduce((sum, row) => sum + progressionCost(row), 0);
  const balance =
    state.playerDivision === "tag"
      ? state.teams[state.playerEntrantId].careerWp
      : state.roster[state.playerEntrantId].careerWp;
  const injuries = state.injuries.filter((row) => wrestlerIds.includes(row.wrestlerId));
  const shots = state.titleShotOffers.filter((row) => row.candidateId === state.playerEntrantId);
  const vacancyWins = titleStates.reduce(
    (sum, title) =>
      sum +
      title.history.filter(
        (row) => row.entrantId === state.playerEntrantId && row.type === "won" && row.detail.includes("vacan"),
      ).length,
    0,
  );
  const data: CareerDossierData = {
    campaignId: state.campaignId,
    name: state.name,
    date: state.currentDate,
    division: state.playerDivision,
    entrant: campaignEntrantLabel(state, state.playerDivision, state.playerEntrantId),
    record: { wins, draws: matches.length - wins - losses, losses, matches: matches.length },
    titles: { won, retained, lost, current },
    wp: { awarded, spent, balance },
    injuries: {
      count: injuries.length,
      weeks: injuries.reduce((sum, row) => sum + row.weeks, 0),
      active: injuries.filter((row) => row.active).length,
    },
    titleShots: {
      accepted: shots.filter((row) => row.status === "accepted").length,
      declined: shots.filter((row) => row.status === "declined").length,
    },
    vacancyWins,
  };
  return {
    ...data,
    toJson: () => JSON.stringify(data, null, 2),
    toCsv: () => csvFromDossier(data),
  };
}

export interface CampaignSnapshotDiff {
  /** Human-readable change lines describing what differs between the two snapshots. */
  changes: string[];
  /** Number of campaign events added in `after` relative to `before` (negative means history was rolled back). */
  eventDelta: number;
}

/**
 * Pure diff between two campaign snapshots for an overwrite preview: lists the
 * player-relevant changes (date, record, WP, titles, injuries, schedule,
 * champions, active match, event count) without mutating either state. Empty
 * `changes` means no tracked difference.
 */
export function diffCampaignSnapshots(before: CampaignState, after: CampaignState): CampaignSnapshotDiff {
  const changes: string[] = [];
  if (before.currentDate !== after.currentDate) changes.push(`Date: ${before.currentDate} -> ${after.currentDate}`);
  const beforeDossier = buildCareerDossier(before);
  const afterDossier = buildCareerDossier(after);
  const br = beforeDossier.record;
  const ar = afterDossier.record;
  if (br.wins !== ar.wins || br.draws !== ar.draws || br.losses !== ar.losses || br.matches !== ar.matches) {
    changes.push(`Record: ${br.wins}W/${br.draws}D/${br.losses}L (${br.matches} matches) -> ${ar.wins}W/${ar.draws}D/${ar.losses}L (${ar.matches} matches)`);
  }
  if (beforeDossier.wp.balance !== afterDossier.wp.balance) {
    changes.push(`WP balance: ${beforeDossier.wp.balance} -> ${afterDossier.wp.balance}`);
  }
  const beforeTitles = [...beforeDossier.titles.current].sort();
  const afterTitles = [...afterDossier.titles.current].sort();
  if (beforeTitles.join("|") !== afterTitles.join("|")) {
    changes.push(`Titles held: ${beforeTitles.length ? beforeTitles.join(", ") : "none"} -> ${afterTitles.length ? afterTitles.join(", ") : "none"}`);
  }
  const beforeActive = new Map(before.injuries.filter((row) => row.active).map((row) => [row.wrestlerId, row]));
  const afterActive = new Map(after.injuries.filter((row) => row.active).map((row) => [row.wrestlerId, row]));
  for (const [id, row] of afterActive) {
    if (!beforeActive.has(id)) changes.push(`Injury added: ${before.roster[id]?.name ?? id} out until ${row.returnDate}`);
  }
  for (const [id, row] of beforeActive) {
    if (!afterActive.has(id)) changes.push(`Injury cleared: ${before.roster[id]?.name ?? id} (returned ${row.returnDate})`);
  }
  const beforeOpen = before.schedule.filter((row) => row.status !== "completed").length;
  const afterOpen = after.schedule.filter((row) => row.status !== "completed").length;
  if (beforeOpen !== afterOpen) changes.push(`Open bookings: ${beforeOpen} -> ${afterOpen}`);
  const beforeDone = before.schedule.filter((row) => row.status === "completed").length;
  const afterDone = after.schedule.filter((row) => row.status === "completed").length;
  if (beforeDone !== afterDone) changes.push(`Completed matches: ${beforeDone} -> ${afterDone}`);
  const beforeSingles = before.rankings.singles.championId;
  const afterSingles = after.rankings.singles.championId;
  if (beforeSingles !== afterSingles) {
    changes.push(`Singles champion: ${beforeSingles ? campaignEntrantLabel(before, "singles", beforeSingles) : "vacant"} -> ${afterSingles ? campaignEntrantLabel(after, "singles", afterSingles) : "vacant"}`);
  }
  const beforeTag = before.rankings.tag.championId;
  const afterTag = after.rankings.tag.championId;
  if (beforeTag !== afterTag) {
    changes.push(`Tag champions: ${beforeTag ? campaignEntrantLabel(before, "tag", beforeTag) : "vacant"} -> ${afterTag ? campaignEntrantLabel(after, "tag", afterTag) : "vacant"}`);
  }
  if (!before.activeMatch && after.activeMatch) changes.push("An in-progress match checkpoint was added");
  if (before.activeMatch && !after.activeMatch) changes.push("The in-progress match checkpoint was closed");
  const eventDelta = after.events.length - before.events.length;
  if (eventDelta !== 0) changes.push(`${Math.abs(eventDelta)} new campaign event${Math.abs(eventDelta) === 1 ? "" : "s"} since this snapshot`);
  return { changes, eventDelta };
}

export function explainBlockedActions(state: CampaignState): BlockedReason[] {
  const reasons: BlockedReason[] = [];

  const acceptOffer: BlockedReason = {
    action: "accept-offer",
    label: "Accept and schedule the offered match",
    blocked: false,
    reasons: [],
    hint: "Accept, play the match, and let the engine apply the result automatically.",
  };
  if (state.activeMatch) {
    acceptOffer.blocked = true;
    acceptOffer.reasons.push("Finish the in-progress match before requesting another booking.");
  } else if (state.schedule.some((row) => row.status === "scheduled" && row.entrantIds.includes(state.playerEntrantId))) {
    acceptOffer.blocked = true;
    acceptOffer.reasons.push("You already hold an open booking; play it first.");
  } else {
    try {
      suggestPlayerMatch(state);
    } catch (error) {
      acceptOffer.blocked = true;
      acceptOffer.reasons.push(String(error));
      acceptOffer.hint = "Resolve the reported blocker, then this offer becomes available.";
    }
  }
  reasons.push(acceptOffer);

  const due = state.schedule.find((row) => row.status === "scheduled" && row.date <= state.currentDate);
  reasons.push({
    action: "advance-day",
    label: "Advance the calendar one day",
    blocked: Boolean(due),
    reasons: due
      ? [`${due.mode} match ${due.id} is due on ${due.date}; the calendar refuses to skip past an unresolved booking.`]
      : [],
    hint: "Advance day by day; month ends finalize ratings and defense obligations.",
  });

  const rollTitleShot: BlockedReason = {
    action: "roll-title-shot",
    label: "Roll a champion's title-shot traversal",
    blocked: false,
    reasons: [],
    hint: "The traversal reserves a mandatory defense for the elected challenger.",
  };
  if (state.activeMatch) {
    rollTitleShot.blocked = true;
    rollTitleShot.reasons.push("Finish the active match first.");
  }
  for (const title of Object.values(state.titles) as TitleState[]) {
    if (title.division !== state.playerDivision) continue;
    if (!title.holderId) {
      rollTitleShot.blocked = true;
      rollTitleShot.reasons.push(`${title.name} is vacant; resolve the vacancy instead of rolling a shot.`);
      continue;
    }
    const candidates = state.rankings[title.division]?.entries.filter((row) => row.entrantId !== title.holderId);
    if (!candidates?.length) {
      rollTitleShot.blocked = true;
      rollTitleShot.reasons.push(`${title.name} has no eligible ranked challengers.`);
    }
  }
  reasons.push(rollTitleShot);

  const resolveVacancy: BlockedReason = {
    action: "resolve-vacancy",
    label: "Resolve a vacant title",
    blocked: false,
    reasons: [],
    hint: "Vacancies use ranked contenders or a seeded four-team tournament.",
  };
  if (state.activeMatch) {
    resolveVacancy.blocked = true;
    resolveVacancy.reasons.push("Finish the active match first.");
  }
  for (const title of Object.values(state.titles) as TitleState[]) {
    if (title.holderId !== null || title.division !== state.playerDivision) continue;
    const contenders = state.rankings[title.division]?.entries.length ?? 0;
    if (contenders < 2) {
      resolveVacancy.blocked = true;
      resolveVacancy.reasons.push(`${title.name} vacancy needs at least two ranked contenders; only ${contenders} are ranked.`);
    }
  }
  reasons.push(resolveVacancy);

  const playDueMatch: BlockedReason = {
    action: "play-due-match",
    label: "Play a due scheduled match",
    blocked: false,
    reasons: [],
    hint: "Playing runs the full match engine and lets you commit the official result.",
  };
  if (!due) {
    playDueMatch.blocked = true;
    playDueMatch.reasons.push("There is no scheduled match due on or before the current date.");
  } else {
    const hurt = due.wrestlerIds
      .flat()
      .filter((id) => state.injuries.some((row) => row.wrestlerId === id && row.returnDate > due.date));
    if (hurt.length) {
      playDueMatch.blocked = true;
      playDueMatch.reasons.push(...hurt.map((id) => `${state.roster[id]?.name ?? id} is injured through the match date.`));
    }
  }
  reasons.push(playDueMatch);

  const spendWp: BlockedReason = {
    action: "spend-wp",
    label: "Spend earned WP on the player's upgrades",
    blocked: false,
    reasons: [],
    hint: "Match results award WP automatically; spend them on attributes, skills, maneuvers, or drawback reductions.",
  };
  const recordId = playerWrestlerIds(state)[0];
  const record = recordId ? state.roster[recordId] : null;
  if (record) {
    const cheapest = Math.min(
      ...(Object.keys(ATTRIBUTE_ADVANCEMENT_COSTS) as Array<keyof typeof ATTRIBUTE_ADVANCEMENT_COSTS>).map(
        (key) => ATTRIBUTE_ADVANCEMENT_COSTS[key],
      ),
    );
    if (record.careerWp < cheapest) {
      spendWp.blocked = true;
      spendWp.reasons.push(`${record.name} has only ${record.careerWp} WP; the cheapest upgrade costs ${cheapest} WP.`);
      spendWp.hint = "Win matches to earn WP, then return to spend them.";
    }
  }
  reasons.push(spendWp);

  return reasons;
}

export function onboardingContent(): OnboardingStep[] {
  return [
    {
      id: "welcome",
      kicker: "WELCOME",
      title: "Run the Territory",
      view: "exhibition",
      points: [
        "Project Ringcraft is a deterministic adaptation of All Star Wrestling (1991).",
        "Every action commits through the rules core; React only displays state and submits intents.",
        "This tour walks the four surfaces, then the Career loop that ties them together.",
      ],
    },
    {
      id: "exhibition",
      kicker: "1 · EXHIBITION",
      title: "One-off matches",
      view: "exhibition",
      points: [
        "Pick a mode, seed, time limit, roster, and AI difficulty, then start the match.",
        "Difficulty is a visible setting that only changes which legal action the AI picks; it never changes rules dice or outcomes.",
        "Opposition AI difficulty: novice plays forgiving hash-derived mistakes, standard is the deterministic baseline, veteran plans one move ahead, ruthless plans two - difficulty never changes rules dice.",
        "Every legal action comes from the shared validator with its dice and formulas.",
        "The replay footer must always read REPLAY VERIFIED.",
      ],
    },
    {
      id: "creator",
      kicker: "2 · CREATOR",
      title: "Build a legal wrestler",
      view: "creator",
      points: [
        "Spend the generated budget on attributes, moves, skills, and drawbacks.",
        "The creator rejects illegal packages until every invariant passes.",
        "Finalized wrestlers join your roster for Exhibitions and Careers.",
      ],
    },
    {
      id: "progression",
      kicker: "3 · PROGRESSION",
      title: "Spend match WP",
      view: "progression",
      points: [
        "Apply a match award to grant WP and Fame on the M4 tables.",
        "Spend WP on attributes, skills, maneuvers, or drawback reductions.",
        "Careers award match WP automatically at commit time.",
      ],
    },
    {
      id: "career",
      kicker: "4 · CAREER",
      title: "The verified loop",
      view: "career",
      points: [
        "Start or resume a private career; the engine handles calendars, rankings, titles, and injuries.",
        "Opposition AI difficulty: novice plays forgiving hash-derived mistakes, standard is the deterministic baseline, veteran plans one move ahead, ruthless plans two - difficulty never changes rules dice.",
        "Accept offers, roll title shots, honor defense obligations, and play due matches.",
        "Autosave, named save files, and export/import JSON keep your career durable.",
        "Watch the latest official result, month-end notes, and your dossier as you go.",
      ],
    },
    {
      id: "go",
      kicker: "5 · GO",
      title: "What's next",
      view: "exhibition",
      points: [
        "Play an exhibition, build a wrestler, then open Career and start a private run.",
        "This is a private candidate; source transcription sign-off remains outside the app.",
        "Tap ? any time to reopen this tour.",
      ],
    },
  ];
}