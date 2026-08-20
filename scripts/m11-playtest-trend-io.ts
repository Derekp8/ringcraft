import {
  PLAYTEST_BATCHES,
  PLAYTEST_TIME_LIMIT_MINUTES,
  playBalanceMatch,
  rowFromState,
} from "./m11-playtest-batch";
import type { BalanceBatch, BalanceMatchRow } from "./m11-playtest-batch";
import { matchSetupFor } from "./m11-playtest-io";
import {
  PLAYTEST_SEASON_STRIDE,
  PLAYTEST_TREND_SCHEMA,
  buildTrendSummary,
  trendReportHash,
} from "./m11-playtest-trend";
import type { PlaytestTrendReport, TrendSeason } from "./m11-playtest-trend";

/** Plays one full season (every batch at the season's seed base) and returns its batches. */
export async function playTrendSeason(season: number): Promise<BalanceBatch[]> {
  const seedBaseOffset = season * PLAYTEST_SEASON_STRIDE;
  const batches: BalanceBatch[] = [];
  for (const [index, spec] of PLAYTEST_BATCHES.entries()) {
    const seedBase = index * 1000 + seedBaseOffset;
    const matches: BalanceMatchRow[] = [];
    for (let seed = 0; seed < spec.seeds; seed += 1) {
      const setup = await matchSetupFor(spec, index, seed, seedBaseOffset);
      matches.push(rowFromState(playBalanceMatch(setup), seed));
    }
    batches.push({ label: spec.label, rosterKey: spec.rosterKey, variety: spec.variety, difficulty: spec.difficulty, playerSide: "v1", seedBase, timeLimitMinutes: PLAYTEST_TIME_LIMIT_MINUTES, matches });
  }
  return batches;
}

export async function buildPlaytestTrendReport(): Promise<PlaytestTrendReport> {
  const seasons: TrendSeason[] = [];
  for (let season = 0; season < PLAYTEST_TREND_SEASONS; season += 1) {
    seasons.push({ season, seedBaseOffset: season * PLAYTEST_SEASON_STRIDE, batches: await playTrendSeason(season) });
  }
  const trend = buildTrendSummary(seasons);
  const report = { schema: PLAYTEST_TREND_SCHEMA, policy: "asw91-ai-policy-v1", ruleset: "classic-1991-vertical-slice", timeLimitMinutes: PLAYTEST_TIME_LIMIT_MINUTES, seasons, trend, reportHash: "" } as PlaytestTrendReport;
  report.reportHash = trendReportHash(report);
  return report;
}

/**
 * Re-derives every season match and compares rows, aggregates, the trend
 * summary, drift bounds, and the report hash against the pinned fixture.
 */
export async function verifyPlaytestTrendReport(report: PlaytestTrendReport): Promise<{ ok: boolean; errors: string[]; matchesReplayed: number }> {
  const errors: string[] = [];
  let matchesReplayed = 0;
  const replayedSeasons: TrendSeason[] = [];
  for (let season = 0; season < report.seasons.length; season += 1) {
    const pinned = report.seasons[season];
    if (pinned.season !== season) errors.push(`Season ${season}: expected season ${season}, found ${pinned.season}.`);
    const expectedOffset = season * PLAYTEST_SEASON_STRIDE;
    if (pinned.seedBaseOffset !== expectedOffset) errors.push(`Season ${season}: expected offset ${expectedOffset}, found ${pinned.seedBaseOffset}.`);
    const replayed = await playTrendSeason(season);
    replayedSeasons.push({ season, seedBaseOffset: expectedOffset, batches: replayed });
    for (const [index, batch] of replayed.entries()) {
      const pinnedBatch = pinned.batches[index];
      if (!pinnedBatch || pinnedBatch.label !== batch.label) {
        errors.push(`Season ${season} batch ${index}: expected ${batch.label}, found ${pinnedBatch?.label ?? "none"}.`);
        continue;
      }
      for (let seed = 0; seed < batch.matches.length; seed += 1) {
        matchesReplayed += 1;
        const actual = batch.matches[seed];
        const expected = pinnedBatch.matches[seed];
        if (!expected || actual.winnerTeam !== expected.winnerTeam || actual.method !== expected.method || actual.minutes !== expected.minutes || actual.ticks !== expected.ticks || actual.finalHash !== expected.finalHash) {
          errors.push(`Season ${season} ${batch.label} seed ${seed}: diverged (winner ${actual.winnerTeam} vs ${expected?.winnerTeam ?? "none"}, method ${actual.method} vs ${expected?.method ?? "none"}, hash ${actual.finalHash} vs ${expected?.finalHash ?? "none"}).`);
        }
      }
    }
  }
  const expectedTrend = buildTrendSummary(replayedSeasons);
  if (JSON.stringify(expectedTrend) !== JSON.stringify(report.trend)) errors.push("Trend summary diverged from the pinned report.");
  if (trendReportHash(report) !== report.reportHash) errors.push("reportHash diverged from the pinned value.");
  if (!report.trend.pacingStable) errors.push("pacingStable is false: drift exceeds the documented bounds.");
  return { ok: errors.length === 0, errors, matchesReplayed };
}
