import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_SCHEMA_VERSION,
  CAMPAIGN_RULESET_VERSION,
  CAMPAIGN_TITLES,
  MONTHLY_RATING_POINTS,
  M5_DATA_HASH,
  M5_DATA_PACK_VERSION,
  UNRANKED_PRIOR_RANK,
  addCalendarDays,
  advanceCampaignDays,
  autoAllocateCreationPoints,
  beginScheduledMatch,
  campaignSummary,
  checkpointScheduledMatch,
  chooseCampaignAiDecision,
  commitScheduledMatchResult,
  createCampaign,
  createCreationSession,
  createMatch,
  finalizeCreationSession,
  declineSuggestedMatch,
  hashCampaignState,
  hashMatchState,
  grantExtraTitleShot,
  importCampaignJson,
  previousRankBonus,
  ratingPoints,
  requiredDefensesForRoll,
  respondToTitleShot,
  resolveScheduledMatchHeadless,
  resolveVacantTitle,
  rollCreationHistory,
  titleShotExtraGrantLine,
  rollCreationStature,
  rollTitleShot,
  scheduleCampaignMatch,
  serializeCampaign,
  setCreationIdentity,
  setCreationSide,
  submitPlayerIntent,
  suggestPlayerMatch,
  titleShotModifier,
  titleShotStartingRank,
  validateCampaignSave,
  validateCampaignState,
  verifyCampaignRoundTrip,
  replayScheduledCampaignMatch,
  replayFromInputLog,
} from "../src/core";
import type { CampaignDivision, CampaignState, CampaignTitleId, Intent, WrestlerCareerRecord } from "../src/core";

function makeRecord(seed: number, index: number): WrestlerCareerRecord {
  let session = createCreationSession(seed);
  session = setCreationIdentity(session, { name: `M5 Wrestler ${index}`, epithet: `Seed ${seed}`, affiliation: "M5 Test Roster" });
  session = setCreationSide(session, index % 2 ? "rulebreaker" : "fan-favorite");
  session = rollCreationStature(session);
  session = rollCreationHistory(session);
  session = autoAllocateCreationPoints(session);
  return finalizeCreationSession(session).finalized!;
}

const RECORDS = Array.from({ length: 12 }, (_, index) => makeRecord(8000 + index, index + 1));
const TEAMS = Array.from({ length: 6 }, (_, index) => ({
  id: `m5-team-${index + 1}`,
  name: `M5 Team ${index + 1}`,
  memberIds: [RECORDS[index * 2].id, RECORDS[index * 2 + 1].id] as [string, string],
  side: RECORDS[index * 2].side,
}));

function campaign(seed = 1991, division: CampaignDivision = "singles"): CampaignState {
  return createCampaign({
    name: `M5 ${division} ${seed}`,
    seed,
    startDate: "1991-01-01",
    roster: RECORDS,
    teams: TEAMS,
    playerEntrantId: division === "singles" ? RECORDS[4].id : TEAMS[2].id,
    playerDivision: division,
  });
}

function choose(state: ReturnType<typeof createMatch>, predicate: (intent: Intent) => boolean): Intent {
  const action = state.decision?.actions.find((row) => predicate(row.intent));
  if (!action) throw new Error(`No legal action matched ${state.decision?.kind}.`);
  return action.intent;
}

describe("M5 immutable campaign rules data", () => {
  it("locks every ratings-chart cell", () => {
    expect(MONTHLY_RATING_POINTS).toEqual({
      "win-pin-submission": { higher: 3, lower: 2 },
      "win-dq-countout": { higher: 2, lower: 1 },
      loss: { higher: -1, lower: -2 },
      "time-limit-draw": { higher: 1, lower: 1 },
      "double-disqualification": { higher: 0, lower: 0 },
    });
    for (const [kind, row] of Object.entries(MONTHLY_RATING_POINTS)) {
      expect(ratingPoints(kind as keyof typeof MONTHLY_RATING_POINTS, true)).toBe(row.higher);
      expect(ratingPoints(kind as keyof typeof MONTHLY_RATING_POINTS, false)).toBe(row.lower);
    }
  });

  it("uses exact prior-rank and unranked boundaries", () => {
    expect(UNRANKED_PRIOR_RANK).toEqual({ singles: 11, tag: 5 });
    expect(previousRankBonus("singles", 0)).toBe(10);
    expect(previousRankBonus("singles", 1)).toBe(9);
    expect(previousRankBonus("singles", 10)).toBe(0);
    expect(previousRankBonus("singles", 11)).toBe(0);
    expect(previousRankBonus("tag", 0)).toBe(4);
    expect(previousRankBonus("tag", 4)).toBe(0);
    expect(previousRankBonus("tag", 5)).toBe(0);
  });

  it("maps all six monthly defense rolls through ceil(1D6/2)", () => {
    expect(Array.from({ length: 6 }, (_, index) => requiredDefensesForRoll(index + 1))).toEqual([1, 1, 2, 2, 3, 3]);
    expect(() => requiredDefensesForRoll(0)).toThrow();
    expect(() => requiredDefensesForRoll(7)).toThrow();
  });

  it("locks title-shot starts and all modifier families", () => {
    expect(titleShotStartingRank("world-heavyweight", null)).toBe(1);
    expect(titleShotStartingRank("international", null)).toBe(2);
    expect(titleShotStartingRank("television", 4)).toBe(5);
    expect(titleShotStartingRank("television", 10)).toBe(2);
    expect(titleShotStartingRank("world-tag", null)).toBe(1);
    expect(titleShotStartingRank("american-tag", null)).toBe(2);
    expect(titleShotModifier("world-heavyweight", "singles", "fan-favorite", "fan-favorite", true, ["international", "television"])).toMatchObject({ total: -12 });
    expect(titleShotModifier("world-tag", "tag", "rulebreaker", "rulebreaker", true, ["american-tag"])).toMatchObject({ total: -6 });
  });

  it("pins all five title definitions to the source divisions and dice", () => {
    expect(Object.keys(CAMPAIGN_TITLES)).toHaveLength(5);
    expect(CAMPAIGN_TITLES["world-heavyweight"]).toMatchObject({ division: "singles", shotDieSides: 10, hierarchy: 3 });
    expect(CAMPAIGN_TITLES["world-tag"]).toMatchObject({ division: "tag", shotDieSides: 6, hierarchy: 2 });
  });
});

describe("M5 campaign creation, rankings, scheduling, and shots", () => {
  it("creates the same complete campaign from the same seed", () => {
    const first = campaign(2201);
    const second = campaign(2201);
    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(CAMPAIGN_SCHEMA_VERSION);
    expect(first.campaignRulesetVersion).toBe(CAMPAIGN_RULESET_VERSION);
    expect(first.dataPackVersion).toBe(M5_DATA_PACK_VERSION);
    expect(first.dataHash).toBe(M5_DATA_HASH);
    expect(first.events[0].dice).toHaveLength(5);
    expect(Object.values(first.titles).every((title) => title.requiredDefenses >= 1 && title.requiredDefenses <= 3)).toBe(true);
    expect(validateCampaignState(first)).toEqual([]);
  });

  it("rejects insufficient rosters and duplicate team members", () => {
    expect(() => createCampaign({ name: "bad", seed: 1, startDate: "1991-01-01", roster: RECORDS.slice(0, 3), playerEntrantId: RECORDS[0].id, playerDivision: "singles" })).toThrow("at least four");
    expect(() => createCampaign({ name: "bad team", seed: 1, startDate: "1991-01-01", roster: RECORDS, teams: [{ id: "bad", name: "Bad", memberIds: [RECORDS[0].id, RECORDS[0].id], side: "fan-favorite" }], playerEntrantId: "bad", playerDivision: "tag" })).toThrow("same wrestler twice");
  });

  it("finalizes and resets monthly ratings only at the month boundary", () => {
    const source = campaign(2202);
    const draft = structuredClone(source);
    const target = draft.rankings.singles.entries[3].entrantId;
    draft.monthlyRatingPoints.singles[target] = 40;
    draft.currentDate = "1991-01-31";
    for (const title of Object.values(draft.titles)) { title.completedDefenses = title.requiredDefenses; title.lastDefenseDate = "1991-01-31"; }
    const next = advanceCampaignDays(draft, 1);
    expect(next.currentDate).toBe("1991-02-01");
    expect(next.rankingHistory.filter((row) => row.month === "1991-01")).toHaveLength(2);
    expect(next.monthlyRatingPoints.singles).toEqual({});
    expect(next.rankings.singles.entries.some((row) => row.entrantId === target && row.totalPoints >= 40)).toBe(true);
    expect(next.rankings.singles.entries[0].entrantId).toBe(next.titles.international.holderId);
    expect(next.rankings.tag.entries[0].entrantId).toBe(next.titles["american-tag"].holderId);
  });

  it("records deterministic D6 tiebreaks after RP, prior rank, and WP tie", () => {
    const draft = campaign(2203);
    draft.currentDate = "1991-01-31";
    for (const record of Object.values(draft.roster)) record.careerWp = 0;
    for (const row of draft.rankings.singles.entries) row.rank = 5;
    draft.rng.scriptedRolls = Array(100).fill(0).map((_, index) => index % 6 + 1);
    draft.rng.scriptedIndex = 0;
    for (const title of Object.values(draft.titles)) title.completedDefenses = title.requiredDefenses;
    const next = advanceCampaignDays(draft, 1);
    expect(next.events.at(-1)?.dice.some((die) => die.label.includes("rating tiebreak"))).toBe(true);
    expect(new Set(next.rankings.singles.entries.map((row) => row.rank)).size).toBe(next.rankings.singles.entries.length);
  });

  it("schedules one legal booking and prevents double booking", () => {
    const source = campaign(2204);
    const request = suggestPlayerMatch(source);
    const scheduled = scheduleCampaignMatch(source, request);
    expect(scheduled.schedule).toHaveLength(1);
    expect(scheduled.events.at(-1)?.dice).toHaveLength(5);
    expect(() => scheduleCampaignMatch(scheduled, request)).toThrow(/already booked|already has scheduled/);
    expect(() => advanceCampaignDays(scheduled, 1)).toThrow("unresolved scheduled match");
  });

  it("records an optional match decline without booking or consuming dice", () => {
    const source = campaign(2211);
    const next = declineSuggestedMatch(source);
    expect(next.schedule).toEqual([]);
    expect(next.rng).toEqual(source.rng);
    expect(next.events.at(-1)).toMatchObject({ type: "decline-match-offer", dice: [] });
    expect(next.events.at(-1)?.postStateHash).toBe(hashCampaignState(next));
  });

  it("traverses candidates, records exact title-shot arithmetic, and schedules accepted offers", () => {
    const source = campaign(2205);
    source.rng.scriptedRolls = [10];
    source.rng.scriptedIndex = 0;
    const rolled = rollTitleShot(source, "world-heavyweight");
    const offer = rolled.titleShotOffers.at(-1)!;
    expect(offer.status).toBe("offered");
    expect(offer.modifiedRoll).toBeGreaterThanOrEqual(offer.candidateRank);
    const accepted = respondToTitleShot(rolled, offer.id, true, rolled.currentDate);
    expect(accepted.titleShotOffers.at(-1)?.status).toBe("accepted");
    expect(accepted.schedule.at(-1)?.titleId).toBe("world-heavyweight");
    expect(accepted.titles["world-heavyweight"].shotsReceived["1991-01"]).toContain(offer.candidateId);
  });

  it("records decline without scheduling or losing candidate history", () => {
    const source = campaign(2206);
    source.rng.scriptedRolls = [10];
    source.rng.scriptedIndex = 0;
    const rolled = rollTitleShot(source, "world-heavyweight");
    const offer = rolled.titleShotOffers.at(-1)!;
    const declined = respondToTitleShot(rolled, offer.id, false);
    expect(declined.titleShotOffers.at(-1)?.status).toBe("declined");
    expect(declined.schedule).toHaveLength(0);
  });

  it("blocks champion-granted extra shots until mandatory obligations are complete", () => {
    const source = campaign(2210);
    const title = source.titles["world-heavyweight"];
    const candidate = source.rankings.singles.entries.find((row) => row.entrantId !== title.holderId)!.entrantId;
    expect(() => grantExtraTitleShot(source, "world-heavyweight", candidate, source.currentDate)).toThrow("remaining mandatory defense");
    const complete = structuredClone(source);
    complete.titles["world-heavyweight"].completedDefenses = complete.titles["world-heavyweight"].requiredDefenses;
    const next = grantExtraTitleShot(complete, "world-heavyweight", candidate, complete.currentDate);
    expect(next.schedule.at(-1)?.mandatoryDefense).toBe(false);
    // M13: the consolidated extra-shot grant line is recorded on the schedule
    // event itself, symmetric to the rolled path's consolidated grant line on
    // the roll-title-shot event — the manual booking is auditable from the log.
    const scheduleEvent = next.events.at(-1)!;
    expect(scheduleEvent.type).toBe("schedule-match");
    const titleName = "World Heavyweight";
    const expected = titleShotExtraGrantLine(candidate, titleName, complete.titles["world-heavyweight"].requiredDefenses, complete.titles["world-heavyweight"].requiredDefenses);
    expect(scheduleEvent.detail.includes(expected)).toBe(true);
    // The line names the challenger and the completed/required defense counts.
    expect(expected).toContain(`${candidate} granted extra World Heavyweight shot`);
    expect(expected).toMatch(/mandatory defenses complete \d+\/\d+/);
  });

  it("records ranked-contender and four-seed tournament vacancy methods", () => {
    const ranked = campaign(2207);
    ranked.titles.television.holderId = null;
    ranked.titles.television.status = "vacant";
    const rankedCompetition = resolveVacantTitle(ranked, "television", ranked.currentDate);
    expect(rankedCompetition.vacancies.at(-1)).toMatchObject({ titleId: "television", method: "ranked-contenders", status: "active" });
    expect(rankedCompetition.schedule.at(-1)).toMatchObject({ vacancyTitleId: "television", vacancyRound: "final" });
    expect(rankedCompetition.events.at(-1)?.postStateHash).toBe(hashCampaignState(rankedCompetition));

    const tournament = campaign(2208);
    tournament.vacancyMethod = "tournament";
    tournament.titles.television.holderId = null;
    tournament.titles.television.status = "vacant";
    const bracket = resolveVacantTitle(tournament, "television", tournament.currentDate);
    const competitionId = bracket.vacancies.at(-1)!.id;
    expect(bracket.vacancies.at(-1)?.entrantIds).toHaveLength(4);
    expect(bracket.schedule.filter((row) => row.vacancyCompetitionId === competitionId && row.vacancyRound === "semifinal")).toHaveLength(2);
    expect(bracket.events.at(-1)?.postStateHash).toBe(hashCampaignState(bracket));
  });

  it("makes transparent campaign-AI choices only from supplied legal alternatives", () => {
    const decision = chooseCampaignAiDecision(campaign(2209), "title-shot", RECORDS[3].id, [
      { id: "decline", label: "Decline", score: 1, basis: "preserve higher-title eligibility" },
      { id: "accept", label: "Accept", score: 6, basis: "legal championship opportunity" },
    ]);
    expect(decision.selectedId).toBe("accept");
    expect(decision.legalAlternatives).toHaveLength(2);
    expect(decision.explanation).toContain("No hidden state or modifier");
  });
});

describe("M5 full-engine result integration and injuries", () => {
  it("runs a scheduled match through the existing engine and applies it exactly once", () => {
    let state = campaign(2301);
    state = scheduleCampaignMatch(state, suggestPlayerMatch(state));
    const scheduledId = state.schedule[0].id;
    state = beginScheduledMatch(state, scheduledId);
    expect(state.activeMatch?.events[0].type).toBe("match-start");
    let match = state.activeMatch!;
    let guard = 0;
    while (!match.result) {
      if (!match.decision) throw new Error("Expected player decision.");
      match = submitPlayerIntent(match, match.decision.actions[0].intent);
      guard += 1;
      if (guard > 5000) throw new Error("Scripted match did not terminate.");
    }
    state = checkpointScheduledMatch(state, match);
    const beforeWp = Object.fromEntries(state.schedule[0].wrestlerIds.flat().map((id) => [id, state.roster[id].careerWp]));
    state = commitScheduledMatchResult(state);
    expect(state.schedule[0].status).toBe("completed");
    expect(state.appliedMatchIds).toEqual([scheduledId]);
    expect(state.schedule[0].result?.finalMatchHash).toBe(hashMatchState(replayFromInputLog(match)));
    expect(hashMatchState(replayScheduledCampaignMatch(state, scheduledId))).toBe(state.schedule[0].result?.finalMatchHash);
    expect(state.schedule[0].wrestlerIds.flat().some((id) => state.roster[id].careerWp > beforeWp[id])).toBe(true);
    expect(() => commitScheduledMatchResult(state)).toThrow("No active match");
  }, 30_000);

  it("persists Critical Hold 100's inherited layoff and blocks scheduling until the exact return date", () => {
    let state = campaign(2302);
    const entrants: [string, string] = [RECORDS[4].id, RECORDS[5].id];
    state = scheduleCampaignMatch(state, { date: state.currentDate, entrantIds: entrants, playerControlled: true });
    state = beginScheduledMatch(state, state.schedule[0].id);
    let match = createMatch({ ...state.activeMatch!.config, scriptedRolls: [5, 1, 1, 100, 6, 6, 6, 6, 20] });
    if (match.decision?.kind === "dodge-commit") match = submitPlayerIntent(match, choose(match, (intent) => intent.type === "dodge-commit" && !intent.dodge));
    match = submitPlayerIntent(match, choose(match, (intent) => intent.type === "attack" && intent.maneuverId === "bear-hug" && intent.attackCharm === 0));
    if (match.decision?.kind === "damage-charm") match = submitPlayerIntent(match, choose(match, (intent) => intent.type === "choose-damage-charm" && intent.charm === 0));
    expect(match.result?.method).toBe("submission");
    expect(match.wrestlers[entrants[1]].injuryWeeks).toBe(6);
    state = checkpointScheduledMatch(state, match);
    state = commitScheduledMatchResult(state);
    const injury = state.injuries.find((row) => row.wrestlerId === entrants[1])!;
    expect(injury.returnDate).toBe(addCalendarDays(state.currentDate, 42));
    expect(() => scheduleCampaignMatch(state, { date: addCalendarDays(state.currentDate, 41), entrantIds: [entrants[1], RECORDS[6].id] })).toThrow("injured through");
    const beforeReturn = advanceCampaignDays(state, 41);
    expect(beforeReturn.injuries.find((row) => row.id === injury.id)?.active).toBe(true);
    const returned = advanceCampaignDays(beforeReturn, 1);
    expect(returned.injuries.find((row) => row.id === injury.id)?.active).toBe(false);
  }, 30_000);

  it("strips a champion who misses the rolling/monthly obligation", () => {
    const source = campaign(2303);
    const advanced = advanceCampaignDays(source, 31);
    expect(Object.values(advanced.titles).some((title) => title.status === "vacant" && title.history.some((row) => row.type === "stripped"))).toBe(true);
    expect(campaignSummary(advanced).strippingEvents).not.toBe(0);
  });
});

function activeInjury(state: CampaignState, wrestlerId: string): boolean {
  return state.injuries.some((row) => row.wrestlerId === wrestlerId && row.active && state.currentDate < row.returnDate);
}

function nextRequiredDefense(state: CampaignState): { titleId: CampaignTitleId; holderId: string; challengerId: string } | null {
  for (const titleId of Object.keys(state.titles) as CampaignTitleId[]) {
    const title = state.titles[titleId];
    if (!title.holderId || title.completedDefenses >= title.requiredDefenses) continue;
    const holderWrestlers = title.division === "singles" ? [title.holderId] : [...state.teams[title.holderId].memberIds];
    if (holderWrestlers.some((id) => activeInjury(state, id))) continue;
    const challenger = state.rankings[title.division].entries.map((row) => row.entrantId).find((id) => {
      if (id === title.holderId) return false;
      const ids = title.division === "singles" ? [id] : [...state.teams[id].memberIds];
      return ids.every((wrestlerId) => !activeInjury(state, wrestlerId));
    });
    if (challenger) return { titleId, holderId: title.holderId, challengerId: challenger };
  }
  return null;
}

function runTwelveMonthPolicy(source: CampaignState, reloadAtMonth: boolean): CampaignState {
  let state = source;
  const endDate = addCalendarDays(state.startDate, 365);
  let previousMonth = state.currentDate.slice(0, 7);
  let guard = 0;
  while (state.currentDate < endDate) {
    const required = nextRequiredDefense(state);
    if (required) {
      state = scheduleCampaignMatch(state, { date: state.currentDate, entrantIds: [required.holderId, required.challengerId], titleId: required.titleId, mandatoryDefense: true, playerControlled: false, timeLimitMinutes: 2 });
      state = resolveScheduledMatchHeadless(state, state.schedule.at(-1)!.id);
    }
    state = advanceCampaignDays(state, 1);
    const month = state.currentDate.slice(0, 7);
    if (reloadAtMonth && month !== previousMonth) {
      const beforeReload = hashCampaignState(state);
      state = importCampaignJson(serializeCampaign(state, false)).state;
      if (hashCampaignState(state) !== beforeReload) throw new Error(`Monthly save/reload drifted at ${month}.`);
    }
    previousMonth = month;
    guard += 1;
    if (guard > 366) throw new Error("Twelve-month policy exceeded calendar guard.");
  }
  return state;
}

describe("M5 twelve-month adversarial campaigns", () => {
  it("keeps solo and tag careers valid and save/reload-identical for twelve months", () => {
    const soloStart = campaign(2501, "singles");
    const soloReloaded = runTwelveMonthPolicy(soloStart, true);
    expect(validateCampaignState(soloReloaded)).toEqual([]);
    expect(soloReloaded.schedule.every((row) => row.status === "completed" && row.result && row.replayConfig)).toBe(true);
    expect(soloReloaded.schedule.every((row) => hashMatchState(replayScheduledCampaignMatch(soloReloaded, row.id)) === row.result!.finalMatchHash)).toBe(true);

    const tagStart = campaign(2502, "tag");
    const tagReloaded = runTwelveMonthPolicy(tagStart, true);
    expect(validateCampaignState(tagReloaded)).toEqual([]);
    expect(tagReloaded.schedule.every((row) => row.status === "completed" && row.result && row.replayConfig)).toBe(true);
    expect(tagReloaded.schedule.every((row) => hashMatchState(replayScheduledCampaignMatch(tagReloaded, row.id)) === row.result!.finalMatchHash)).toBe(true);
    expect(campaignSummary(soloReloaded).days).toBe(365);
    expect(campaignSummary(tagReloaded).days).toBe(365);
    const evidence = (state: CampaignState) => ({
      ...campaignSummary(state),
      matchResults: Object.fromEntries(["pin", "submission", "disqualification", "countout", "time-limit-draw"].map((method) => [method, state.schedule.filter((row) => row.result?.method === method).length])),
      replayChecks: state.schedule.length,
      monthlySaveReloadCheckpoints: 12,
      rankingTables: state.rankingHistory.length,
    });
    console.log(`M5_YEAR_MATRIX_JSON ${JSON.stringify({ solo: evidence(soloReloaded), tag: evidence(tagReloaded) })}`);
  }, 120_000);
});

describe("M5 save, recovery, import, and migration boundary", () => {
  it("round-trips byte-stably and preserves canonical state/next PRNG", () => {
    const source = campaign(2401, "tag");
    const result = verifyCampaignRoundTrip(source);
    expect(result.valid).toBe(true);
    const imported = importCampaignJson(serializeCampaign(source, false));
    expect(imported.fromVersion).toBe(CAMPAIGN_SCHEMA_VERSION);
    expect(imported.notices).toEqual([]);
    expect(hashCampaignState(imported.state)).toBe(hashCampaignState(source));
    expect(imported.state.rng).toEqual(source.rng);
  });

  it("rejects corrupt, truncated, unsupported, and data-mismatched saves", () => {
    expect(() => importCampaignJson("{\"schemaVersion\":" )).toThrow("corrupt or truncated");
    const unsupported = JSON.parse(serializeCampaign(campaign(2402))) as Record<string, unknown>;
    unsupported.schemaVersion = "asw91-campaign-v0";
    expect(() => importCampaignJson(JSON.stringify(unsupported))).toThrow("unsupported schema");
    const mismatch = JSON.parse(serializeCampaign(campaign(2403))) as Record<string, unknown>;
    mismatch.dataHash = "wrong";
    expect(validateCampaignSave(mismatch).some((line) => line.includes("No silent recomputation"))).toBe(true);
    expect(() => importCampaignJson(JSON.stringify(mismatch))).toThrow("dataHash");
  });

  it("rolls back invalid campaign transactions without consuming source dice", () => {
    const source = campaign(2404);
    const before = structuredClone(source.rng);
    expect(() => scheduleCampaignMatch(source, { date: "1990-01-01", entrantIds: [RECORDS[4].id, RECORDS[5].id] })).toThrow("past");
    expect(source.rng).toEqual(before);
    expect(source.schedule).toEqual([]);
  });
});
