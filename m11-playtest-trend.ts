import { canonicalHash64 } from "../src/core";
import type { MatchVariety } from "../src/core";
import { buildAnalytics } from "./m11-playtest-batch";
import type { BalanceBatch } from "./m11-playtest-batch";

export const PLAYTEST_TREND_SCHEMA = "asw91-playtest-trend-report-v1";
export const PLAYTEST_TREND_SEASONS = 5;
/** Seed-base stride between seasons: season s shifts every batch by s * STRIDE. */
export const PLAYTEST_SEASON_STRIDE = 10_000;
/** Pacing-drift bounds the trend gate asserts (documented in the M11 audit). */
export const TREND_MEAN_SPREAD_BOUND = 0.25;
export const TREND_DRAW_RATE_SPREAD_BOUND = 0.25;
export const TREND_METHOD_SHARE_SPREAD_BOUND = 0.3;

export interface TrendSeason {
  season: number;
  seedBaseOffset: number;
  batches: BalanceBatch[];
}

export interface VarietyLengthTrend {
  meanOfMeanMinutes: number;
  minMeanMinutes: number;
  maxMeanMinutes: number;
  meanSpreadRelative: number;
  meanOfMeanTicks: number;
  drawRateSpread: number;
}

export interface MethodShareTrend {
  meanShare: number;
  minShare: number;
  maxShare: number;
  shareSpread: number;
}

export interface PlaytestTrendReport {
  schema: typeof PLAYTEST_TREND_SCHEMA;
  policy: "asw91-ai-policy-v1";
  ruleset: "classic-1991-vertical-slice";
  timeLimitMinutes: number;
  seasons: TrendSeason[];
  trend: {
    matchLength: { byVariety: Record<MatchVariety, VarietyLengthTrend> };
    finishMethods: { byVariety: Record<MatchVariety, Record<string, MethodShareTrend>> };
    pacingStable: boolean;
  };
  reportHash: string;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Derives the per-variety pacing-drift summary from the season analytics. */
export function buildTrendSummary(seasons: TrendSeason[]): PlaytestTrendReport["trend"] {
  const varieties = ["standard", "cage", "ladder"] as const;
  const matchLength = {} as PlaytestTrendReport["trend"]["matchLength"]["byVariety"];
  const finishMethods = {} as PlaytestTrendReport["trend"]["finishMethods"]["byVariety"];
  const seasonAnalytics = seasons.map((season) => buildAnalytics(season.batches));
  for (const variety of varieties) {
    const seasonLengths = seasonAnalytics.map((analytics) => analytics.matchLength.byVariety[variety]);
    const meanMinutes = seasonLengths.map((row) => row.meanMinutes);
    const meanTicks = seasonLengths.map((row) => row.meanTicks);
    const drawRates = seasonLengths.map((row) => row.drawRate);
    matchLength[variety] = {
      meanOfMeanMinutes: mean(meanMinutes),
      minMeanMinutes: Math.min(...meanMinutes),
      maxMeanMinutes: Math.max(...meanMinutes),
      meanSpreadRelative: mean(meanMinutes) === 0 ? 0 : (Math.max(...meanMinutes) - Math.min(...meanMinutes)) / mean(meanMinutes),
      meanOfMeanTicks: mean(meanTicks),
      drawRateSpread: Math.max(...drawRates) - Math.min(...drawRates),
    };
    // Method shares per season (count / total rows of that variety in the season).
    const methodTotals = new Map<string, number[]>();
    for (const [seasonIndex, season] of seasons.entries()) {
      const rows = season.batches.filter((batch) => batch.variety === variety).flatMap((batch) => batch.matches);
      const counts = seasonAnalytics[seasonIndex].finishMethods.byVariety[variety] ?? {};
      for (const [method, count] of Object.entries(counts)) {
        const list = methodTotals.get(method) ?? [];
        list.push((count ?? 0) / rows.length);
        methodTotals.set(method, list);
      }
    }
    const methods = {} as Record<string, MethodShareTrend>;
    for (const [method, shares] of methodTotals) {
      methods[method] = {
        meanShare: mean(shares),
        minShare: Math.min(...shares),
        maxShare: Math.max(...shares),
        shareSpread: Math.max(...shares) - Math.min(...shares),
      };
    }
    finishMethods[variety] = methods;
  }
  const spreadsOk = (Object.keys(matchLength) as MatchVariety[]).every((variety) => matchLength[variety].meanSpreadRelative <= TREND_MEAN_SPREAD_BOUND && matchLength[variety].drawRateSpread <= TREND_DRAW_RATE_SPREAD_BOUND);
  const sharesOk = (Object.keys(finishMethods) as MatchVariety[]).every((variety) => Object.values(finishMethods[variety]).every((row) => row.shareSpread <= TREND_METHOD_SHARE_SPREAD_BOUND));
  return { matchLength: { byVariety: matchLength }, finishMethods: { byVariety: finishMethods }, pacingStable: spreadsOk && sharesOk };
}

/** Canonical hash of the report over everything except the reportHash field itself. */
export function trendReportHash(report: PlaytestTrendReport): string {
  const { reportHash: _ignored, ...rest } = report;
  return canonicalHash64(rest);
}
