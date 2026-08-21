import { describe, expect, it } from "vitest";
import {
  PLAYTEST_SEASON_STRIDE,
  PLAYTEST_TREND_SCHEMA,
  PLAYTEST_TREND_SEASONS,
  TREND_DRAW_RATE_SPREAD_BOUND,
  TREND_MEAN_SPREAD_BOUND,
  TREND_METHOD_SHARE_SPREAD_BOUND,
  buildTrendSummary,
  trendReportHash,
} from "../scripts/m11-playtest-trend";
import type { PlaytestTrendReport } from "../scripts/m11-playtest-trend";
import reportFixture from "../fixtures/m11/playtest-trend-report-v1.json";
import balanceFixture from "../fixtures/m11/playtest-balance-report-v1.json";

const report = reportFixture as PlaytestTrendReport;

describe("M11 playtest pacing-trend report", () => {
  it("declares the trend schema and fixed season corpus", () => {
    expect(report.schema).toBe(PLAYTEST_TREND_SCHEMA);
    expect(report.policy).toBe("asw91-ai-policy-v1");
    expect(report.seasons.length).toBe(PLAYTEST_TREND_SEASONS);
    for (const [seasonIndex, season] of report.seasons.entries()) {
      expect(season.season).toBe(seasonIndex);
      expect(season.seedBaseOffset).toBe(seasonIndex * PLAYTEST_SEASON_STRIDE);
    }
    // Every season replays the same 11-batch corpus at a disjoint seed window.
    const first = report.seasons[0];
    const last = report.seasons.at(-1)!;
    expect(first.batches.map((batch) => batch.label)).toEqual(last.batches.map((batch) => batch.label));
    for (const batch of first.batches) expect(batch.matches.length).toBeGreaterThan(0);
  });

  it("pins the report hash and the pacing-stable verdict", () => {
    expect(report.reportHash).toBe("c14n-fnv1a64-v1:84e05a2da0502ee6");
    expect(report.trend.pacingStable).toBe(true);
    expect(trendReportHash(report)).toBe(report.reportHash);
  });

  it("keeps every variety's pacing drift inside the documented bounds", () => {
    for (const variety of ["standard", "cage", "ladder"] as const) {
      const length = report.trend.matchLength.byVariety[variety];
      expect(length.meanSpreadRelative).toBeLessThanOrEqual(TREND_MEAN_SPREAD_BOUND);
      expect(length.drawRateSpread).toBeLessThanOrEqual(TREND_DRAW_RATE_SPREAD_BOUND);
      expect(length.minMeanMinutes).toBeGreaterThanOrEqual(1);
      expect(length.maxMeanMinutes).toBeLessThanOrEqual(report.timeLimitMinutes);
      for (const method of Object.values(report.trend.finishMethods.byVariety[variety])) {
        expect(method.shareSpread).toBeLessThanOrEqual(TREND_METHOD_SHARE_SPREAD_BOUND);
      }
    }
  });

  it("keeps the variety pacing ordering across seasons (cage/ladder faster than standard)", () => {
    for (const season of report.seasons) {
      const lengths = Object.fromEntries(season.batches.map((batch) => [batch.variety, batch.matches]));
      const meanMinutes = (variety: "standard" | "cage" | "ladder") => {
        const rows = season.batches.filter((batch) => batch.variety === variety).flatMap((batch) => batch.matches);
        return rows.reduce((sum, row) => sum + row.minutes, 0) / rows.length;
      };
      expect(meanMinutes("cage")).toBeLessThan(meanMinutes("standard"));
      expect(meanMinutes("ladder")).toBeLessThan(meanMinutes("standard"));
      void lengths;
    }
  });

  it("season 0 replays the balance-report corpus exactly (shared batch 0 rows)", () => {
    // The trend gate's season 0 uses the same seed base as the balance report
    // (batch index * 1000), so its first batch must byte-match the balance fixture.
    const trendBatch0 = report.seasons[0].batches[0];
    const balanceBatch0 = balanceFixture.batches[0];
    expect(trendBatch0.label).toBe(balanceBatch0.label);
    expect(trendBatch0.matches).toEqual(balanceBatch0.matches);
  });

  it("derives the pinned trend summary from the fixture seasons (aggregate determinism)", () => {
    const derived = buildTrendSummary(report.seasons);
    expect(derived).toEqual(report.trend);
  });
});
