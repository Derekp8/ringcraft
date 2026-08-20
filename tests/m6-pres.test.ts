import { describe, expect, it } from "vitest";
import fixtureJson from "../fixtures/m5/example-career-save.json";
import inProgressFixtureJson from "../fixtures/m5/example-in-progress-save.json";
import {
  buildCareerDossier,
  buildMonthEndSummary,
  buildPostMatchReport,
  diffCampaignSnapshots,
  explainBlockedActions,
  onboardingContent,
} from "../src/ui/campaign-presentation";
import {
  advanceCampaignDays,
  hashCampaignState,
  importCampaignJson,
  resolveScheduledMatchHeadless,
  scheduleCampaignMatch,
} from "../src/core";
import type { CampaignState, CampaignTitleId, MatchState } from "../src/core";

const FIXTURE = JSON.stringify(fixtureJson);
const PLAYER_ID = "freebuff-fixture-4-cd6e30c5";
const OPPONENT_ID = "freebuff-fixture-2-bcdff567";
const MATCH_ID = "match-49bdb9f5";
const MATCH_HASH = "c14n-fnv1a64-v1:b5cc3ccccd2e25ee";

function loadFixture(): CampaignState {
  return importCampaignJson(FIXTURE).state;
}

describe("M6 pure campaign presentation", () => {
  it("post-match report derives the fixture loss exactly", () => {
    const report = buildPostMatchReport(loadFixture());
    expect(report).not.toBeNull();
    expect(report!.matchId).toBe(MATCH_ID);
    expect(report!.date).toBe("1991-01-01");
    expect(report!.mode).toBe("singles");
    expect(report!.summary).toBe("Freebuff Fixture 2 wins by pin.");
    expect(report!.method).toBe("pin");
    expect(report!.playerInvolved).toBe(true);
    expect(report!.playerOutcome).toBe("loss");
    expect(report!.opponentLabel).toBe("Freebuff Fixture 2");
    expect(report!.titleImpact).toBeNull();
    expect(report!.rankingNotes).toBe("Current #3");
    expect(report!.injuries).toEqual([]);
    expect(report!.wpAwarded).toBe(2);
    expect(report!.matchHash).toBe(MATCH_HASH);
  });

  it("post-match report is null when no completed match exists", () => {
    const fresh = loadFixture();
    fresh.matchHistory = [];
    fresh.schedule = fresh.schedule.map((row) => ({ ...row, status: "scheduled", result: null }));
    expect(buildPostMatchReport(fresh)).toBeNull();
  });

  it("month-end summary reports the finalized 1991-01 table", () => {
    const summary = buildMonthEndSummary(loadFixture());
    expect(summary).not.toBeNull();
    expect(summary!.month).toBe("1991-01");
    expect(summary!.division).toBe("singles");
    expect(summary!.playerRank).toBe(3);
    expect(summary!.playerPriorRank).toBe(3);
    expect(summary!.playerMovement).toBe(0);
    expect(summary!.headline).toEqual([]);
    expect(summary!.injuries).toEqual([]);
  });

  it("career dossier tallies record, WP, titles, injuries, and shots from the fixture", () => {
    const dossier = buildCareerDossier(loadFixture());
    expect(dossier.campaignId).toBe("campaign-4b340d10");
    expect(dossier.name).toBe("Freebuff M5 Example Career");
    expect(dossier.date).toBe("1991-01-01");
    expect(dossier.division).toBe("singles");
    expect(dossier.entrant).toBe("Freebuff Fixture 4");
    expect(dossier.record).toEqual({ wins: 0, draws: 0, losses: 1, matches: 1 });
    expect(dossier.titles).toEqual({ won: 0, retained: 0, lost: 0, current: [] });
    expect(dossier.wp).toEqual({ awarded: 2, spent: 0, balance: 2 });
    expect(dossier.injuries).toEqual({ count: 0, weeks: 0, active: 0 });
    expect(dossier.titleShots).toEqual({ accepted: 0, declined: 0 });
    expect(dossier.vacancyWins).toBe(0);
  });

  it("dossier exports are deterministic", () => {
    const dossier = buildCareerDossier(loadFixture());
    expect(dossier.toJson()).toBe(dossier.toJson());
    expect(dossier.toCsv()).toBe(dossier.toCsv());
    expect(dossier.toJson()).toContain('"campaignId": "campaign-4b340d10"');
    expect(dossier.toCsv()).toContain('"career_name","Freebuff M5 Example Career"');
    expect(dossier.toCsv()).toContain('"losses","1"');
    expect(dossier.toCsv()).toContain('"wp_awarded","2"');
  });

  it("blocked-action guidance is deterministic for the fixture", () => {
    const reasons = explainBlockedActions(loadFixture());
    const byAction = Object.fromEntries(reasons.map((row) => [row.action, row]));
    expect(reasons.map((row) => row.action)).toEqual([
      "accept-offer",
      "advance-day",
      "roll-title-shot",
      "resolve-vacancy",
      "play-due-match",
      "spend-wp",
    ]);
    expect(byAction["accept-offer"].blocked).toBe(false);
    expect(byAction["advance-day"].blocked).toBe(false);
    expect(byAction["roll-title-shot"].blocked).toBe(false);
    expect(byAction["resolve-vacancy"].blocked).toBe(false);
    expect(byAction["play-due-match"].blocked).toBe(true);
    expect(byAction["play-due-match"].reasons[0]).toContain("There is no scheduled match due");
    expect(byAction["spend-wp"].blocked).toBe(true);
    expect(byAction["spend-wp"].reasons[0]).toContain("only 2 WP");
    expect(byAction["spend-wp"].hint).toContain("Win matches to earn WP");
  });

  it("advance-day is blocked while a due match remains unresolved", () => {
    const state = loadFixture();
    const due = state.schedule.find((row) => row.id === MATCH_ID)!;
    state.schedule = state.schedule.map((row) => (row.id === MATCH_ID ? { ...due, status: "scheduled", result: null } : row));
    const reason = explainBlockedActions(state).find((row) => row.action === "advance-day")!;
    expect(reason.blocked).toBe(true);
    expect(reason.reasons[0]).toContain(MATCH_ID);
  });

  it("a blocked accept-offer surfaces the engine's own blocker text", () => {
    const state = loadFixture();
    state.injuries = state.rankings.singles.entries
      .filter((entry) => entry.entrantId !== PLAYER_ID)
      .map((entry, index) => ({
        id: `inj-${index}`,
        wrestlerId: entry.entrantId,
        sourceMatchId: MATCH_ID,
        occurredDate: "1991-01-01",
        weeks: 4,
        returnDate: "1991-01-29",
        active: true,
        detail: "Test layoff.",
      }));
    const reason = explainBlockedActions(state).find((row) => row.action === "accept-offer")!;
    expect(reason.blocked).toBe(true);
    expect(reason.reasons[0]).toContain("No legal, available ranked opponent exists");
    expect(reason.hint).toContain("Resolve the reported blocker");
  });

  it("title-impact branch renders for a title match", () => {
    const state = loadFixture();
    const match = state.schedule.find((row) => row.id === MATCH_ID)!;
    match.titleId = "television" as CampaignTitleId;
    const title = state.titles[match.titleId];
    title.holderId = PLAYER_ID;
    title.history.push({
      date: "1991-01-01",
      type: "won",
      entrantId: PLAYER_ID,
      matchId: MATCH_ID,
      detail: "Won the title by pin.",
    });
    const report = buildPostMatchReport(state)!;
    expect(report.titleImpact).toContain("Won Television");
    expect(report.titleImpact).toContain("Won the title by pin.");
  });

  it("month-end headline surfaces in-month title history", () => {
    const state = loadFixture();
    const title = state.titles["world-heavyweight"];
    title.history.push({ date: "1991-01-15", type: "retained", entrantId: "freebuff-fixture-1-1c4455bc", detail: "Retained against a challenger." });
    const summary = buildMonthEndSummary(state)!;
    expect(summary.headline).toContain("World Heavyweight: Retained against a challenger.");
  });

  it("month-end roster lines are empty when the player has no injuries", () => {
    const summary = buildMonthEndSummary(loadFixture())!;
    expect(summary.rosterLayoffs).toEqual([]);
    expect(summary.rosterRecoveries).toEqual([]);
  });

  it("month-end roster line lists an active player layoff with weeks and return date", () => {
    const state = loadFixture();
    state.injuries.push({
      id: "injury-test-layoff",
      wrestlerId: PLAYER_ID,
      sourceMatchId: MATCH_ID,
      occurredDate: "1991-01-01",
      weeks: 3,
      returnDate: "1991-01-22",
      active: true,
      detail: "Post-match sprain (check 3): 3 week(s) out, eligible again 1991-01-22.",
    });
    const summary = buildMonthEndSummary(state)!;
    expect(summary.rosterLayoffs).toEqual(["Freebuff Fixture 4 (3 weeks, out until 1991-01-22)"]);
    expect(summary.rosterRecoveries).toEqual([]);
  });

  it("month-end roster line lists a recovery that resolved during the month", () => {
    const state = loadFixture();
    state.injuries.push({
      id: "injury-test-recovery",
      wrestlerId: PLAYER_ID,
      sourceMatchId: MATCH_ID,
      occurredDate: "1991-01-01",
      weeks: 3,
      returnDate: "1991-01-22",
      active: false,
      detail: "Post-match sprain (check 3): 3 week(s) out, eligible again 1991-01-22.",
    });
    const summary = buildMonthEndSummary(state)!;
    expect(summary.rosterLayoffs).toEqual([]);
    expect(summary.rosterRecoveries).toEqual(["Freebuff Fixture 4 (returned 1991-01-22)"]);
  });

  it("month-end roster lines exclude non-player wrestlers, prior-month recoveries, and future returns", () => {
    const state = loadFixture();
    state.injuries.push(
      { id: "inj-opponent-active", wrestlerId: OPPONENT_ID, sourceMatchId: MATCH_ID, occurredDate: "1991-01-01", weeks: 4, returnDate: "1991-02-05", active: true, detail: "Opponent layoff." },
      { id: "inj-player-old", wrestlerId: PLAYER_ID, sourceMatchId: MATCH_ID, occurredDate: "1990-12-01", weeks: 2, returnDate: "1990-12-15", active: false, detail: "Old recovery." },
      { id: "inj-player-future", wrestlerId: PLAYER_ID, sourceMatchId: MATCH_ID, occurredDate: "1991-02-01", weeks: 2, returnDate: "1991-02-15", active: false, detail: "Next month." },
    );
    const summary = buildMonthEndSummary(state)!;
    expect(summary.rosterLayoffs).toEqual([]);
    expect(summary.rosterRecoveries).toEqual([]);
  });

  it("month-end roster lines cover both tag team members", () => {
    const state = loadFixture();
    state.playerDivision = "tag";
    state.playerEntrantId = "freebuff-fixture-team-1";
    state.teams["freebuff-fixture-team-1"].memberIds = [PLAYER_ID, OPPONENT_ID];
    state.injuries.push(
      { id: "inj-tag-a", wrestlerId: PLAYER_ID, sourceMatchId: MATCH_ID, occurredDate: "1991-01-01", weeks: 3, returnDate: "1991-01-22", active: true, detail: "Sprain." },
      { id: "inj-tag-b", wrestlerId: OPPONENT_ID, sourceMatchId: MATCH_ID, occurredDate: "1991-01-01", weeks: 2, returnDate: "1991-01-15", active: false, detail: "Sprain." },
    );
    const summary = buildMonthEndSummary(state)!;
    expect(summary.rosterLayoffs).toEqual(["Freebuff Fixture 4 (3 weeks, out until 1991-01-22)"]);
    expect(summary.rosterRecoveries).toEqual(["Freebuff Fixture 2 (returned 1991-01-15)"]);
  });

  it("month-end autosave line lists the retained snapshot count and newest restore point", () => {
    const state = loadFixture();
    const summary = buildMonthEndSummary(state, { retained: 4, newestRestorePoint: "1991-01-22T12:00:00.000Z" })!;
    expect(summary.autosaveLine).toBe("Autosaves: 4 snapshots retained; newest restore point 1991-01-22.");
    // Singular form and date-only restore point.
    const single = buildMonthEndSummary(state, { retained: 1, newestRestorePoint: "1991-01-01T12:00:00.000Z" })!;
    expect(single.autosaveLine).toBe("Autosaves: 1 snapshot retained; newest restore point 1991-01-01.");
  });

  it("month-end autosave line is null when the ring is empty or no facts are supplied", () => {
    const state = loadFixture();
    expect(buildMonthEndSummary(state)!.autosaveLine).toBeNull();
    expect(buildMonthEndSummary(state, { retained: 0, newestRestorePoint: null })!.autosaveLine).toBeNull();
    expect(buildMonthEndSummary(state, { retained: 3, newestRestorePoint: null })!.autosaveLine).toBeNull();
  });

  it("derivations never mutate the campaign (pure functions)", () => {
    const state = loadFixture();
    const before = hashCampaignState(state);
    buildPostMatchReport(state);
    buildMonthEndSummary(state);
    buildCareerDossier(state);
    explainBlockedActions(state);
    expect(hashCampaignState(state)).toBe(before);
  });

  it("onboarding content covers all four surfaces plus welcome and go steps", () => {
    const steps = onboardingContent();
    expect(steps).toHaveLength(6);
    expect(steps.map((step) => step.view)).toEqual(["exhibition", "exhibition", "creator", "progression", "career", "exhibition"]);
    expect(steps.every((step) => step.id && step.kicker && step.title && step.points.length > 0)).toBe(true);
    const career = steps.find((step) => step.id === "career")!;
    const difficultyPoint = career.points.find((point) => point.startsWith("Opposition AI difficulty:"))!;
    expect(difficultyPoint).toContain("novice");
    expect(difficultyPoint).toContain("standard");
    expect(difficultyPoint).toContain("veteran");
    expect(difficultyPoint).toContain("ruthless");
    expect(difficultyPoint).toContain("never changes rules dice");
  });
});

describe("campaign snapshot diff", () => {
  it("reports no changes for identical snapshots", () => {
    const state = loadFixture();
    expect(diffCampaignSnapshots(state, state)).toEqual({ changes: [], eventDelta: 0 });
  });

  it("reports date advance and the event delta", () => {
    const before = loadFixture();
    const after = advanceCampaignDays(before, 1);
    const diff = diffCampaignSnapshots(before, after);
    expect(diff.eventDelta).toBe(1);
    expect(diff.changes).toContain("Date: 1991-01-01 -> 1991-01-02");
    expect(diff.changes).toContain("1 new campaign event since this snapshot");
  });

  it("restore direction reports the rollback the load preview will show", () => {
    const current = advanceCampaignDays(loadFixture(), 1);
    const stored = loadFixture();
    const diff = diffCampaignSnapshots(current, stored);
    expect(diff.eventDelta).toBe(-1);
    // The discard count the restore preview warns about mirrors -eventDelta.
    expect(-diff.eventDelta).toBe(1);
    expect(diff.changes).toContain("Date: 1991-01-02 -> 1991-01-01");
    expect(diff.changes).toContain("1 new campaign event since this snapshot");
  });

  it("overwrite and restore directions are exact mirrors of the same pair", () => {
    const current = advanceCampaignDays(loadFixture(), 1);
    const stored = loadFixture();
    const update = diffCampaignSnapshots(stored, current);
    const restore = diffCampaignSnapshots(current, stored);
    expect(update.eventDelta).toBe(1);
    expect(restore.eventDelta).toBe(-1);
    expect(update.changes).toContain("Date: 1991-01-01 -> 1991-01-02");
    expect(restore.changes).toContain("Date: 1991-01-02 -> 1991-01-01");
  });

  it("import direction reports the rollback the import-campaign-JSON preview will show", () => {
    const current = loadFixture();
    const imported = importCampaignJson(JSON.stringify(inProgressFixtureJson)).state;
    const diff = diffCampaignSnapshots(current, imported);
    expect(diff.changes).toContain("Date: 1991-01-01 -> 1991-01-02");
    expect(diff.changes).toContain("An in-progress match checkpoint was added");
    expect(diff.eventDelta).toBe(3);
  });

  it("reports the record line and event delta after playing a real match", () => {
    const base = advanceCampaignDays(loadFixture(), 1);
    const scheduled = scheduleCampaignMatch(base, { date: base.currentDate, entrantIds: [PLAYER_ID, OPPONENT_ID] });
    const after = resolveScheduledMatchHeadless(scheduled, scheduled.schedule.find((row) => row.status === "scheduled")!.id);
    const diff = diffCampaignSnapshots(base, after);
    expect(diff.eventDelta).toBeGreaterThan(0);
    expect(diff.changes.some((line) => line.startsWith("Record:"))).toBe(true);
    expect(diff.changes.some((line) => line.includes("matches)"))).toBe(true);
  });

  it("reports injuries added and cleared by wrestler", () => {
    const before = loadFixture();
    const after: CampaignState = {
      ...before,
      injuries: [
        ...before.injuries,
        { id: "inj-diff-1", wrestlerId: PLAYER_ID, sourceMatchId: MATCH_ID, occurredDate: "1991-01-01", weeks: 3, returnDate: "1991-01-22", active: true, detail: "Sprain." },
      ],
    };
    let diff = diffCampaignSnapshots(before, after);
    expect(diff.changes).toContain(`Injury added: Freebuff Fixture 4 out until 1991-01-22`);

    const cleared: CampaignState = {
      ...after,
      injuries: after.injuries.map((row) => (row.id === "inj-diff-1" ? { ...row, active: false } : row)),
    };
    diff = diffCampaignSnapshots(after, cleared);
    expect(diff.changes).toContain("Injury cleared: Freebuff Fixture 4 (returned 1991-01-22)");
  });

  it("reports a singles champion change", () => {
    const before = loadFixture();
    const newChampion = before.rankings.singles.championId === OPPONENT_ID ? PLAYER_ID : OPPONENT_ID;
    const after: CampaignState = { ...before, rankings: { ...before.rankings, singles: { ...before.rankings.singles, championId: newChampion } } };
    const diff = diffCampaignSnapshots(before, after);
    expect(diff.changes.some((line) => line.startsWith("Singles champion:"))).toBe(true);
  });

  it("reports a title acquired by the player", () => {
    const before = loadFixture();
    const singlesTitle = Object.values(before.titles).find((title) => title.division === "singles")!;
    const after: CampaignState = { ...before, titles: { ...before.titles, [singlesTitle.id]: { ...singlesTitle, holderId: PLAYER_ID } } };
    const diff = diffCampaignSnapshots(before, after);
    expect(diff.changes).toContain(`Titles held: none -> ${singlesTitle.name}`);
  });

  it("reports open-bookings and completed-match count shifts when a completed match is reverted", () => {
    const before = loadFixture();
    const after: CampaignState = {
      ...before,
      schedule: before.schedule.map((row) => (row.id === MATCH_ID ? { ...row, status: "scheduled" as const, result: null } : row)),
    };
    const diff = diffCampaignSnapshots(before, after);
    expect(diff.changes.some((line) => line.startsWith("Open bookings:"))).toBe(true);
    expect(diff.changes.some((line) => line.startsWith("Completed matches:"))).toBe(true);
    expect(diff.changes.some((line) => line.startsWith("Record:"))).toBe(true);
  });

  it("reports an in-progress match checkpoint being added or closed", () => {
    const before = loadFixture();
    expect(before.activeMatch).toBeNull();
    const checkpoint = {} as MatchState;
    const withCheckpoint: CampaignState = { ...before, activeMatch: checkpoint };
    expect(diffCampaignSnapshots(before, withCheckpoint).changes).toContain("An in-progress match checkpoint was added");
    expect(diffCampaignSnapshots(withCheckpoint, before).changes).toContain("The in-progress match checkpoint was closed");
  });

  it("is pure and hash-neutral", () => {
    const before = loadFixture();
    const after = advanceCampaignDays(before, 1);
    const beforeHash = hashCampaignState(before);
    const afterHash = hashCampaignState(after);
    diffCampaignSnapshots(before, after);
    expect(hashCampaignState(before)).toBe(beforeHash);
    expect(hashCampaignState(after)).toBe(afterHash);
  });
});