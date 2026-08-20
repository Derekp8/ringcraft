import { describe, expect, it } from "vitest";
import reportFixture from "../fixtures/m11/playtest-balance-report-v1.json";
import {
  batchRows,
  ladderRows,
  varietyFinishRows,
  varietyLengthRows,
  type PlaytestReport,
} from "../src/ui/playtest-dashboard";

const report = reportFixture as PlaytestReport;

describe("M11 playtest dashboard presenters", () => {
  it("renders the pinned report identity unchanged", () => {
    expect(report.schema).toBe("asw91-playtest-balance-report-v1");
    expect(report.reportHash).toMatch(/^c14n-fnv1a64-v1:[0-9a-f]{16}$/);
    expect(report.batches.length).toBe(17);
  });

  it("presents the four historical underdog difficulty rows in canonical order", () => {
    const rows = ladderRows(report);
    expect(rows.map((row) => row.difficulty)).toEqual(["novice", "standard", "veteran", "ruthless"]);
    for (const row of rows) {
      expect(row.winShare).toBeGreaterThanOrEqual(0);
      expect(row.winShare).toBeLessThanOrEqual(1);
      expect(row.winShare).toBe(report.analytics.winShare.byDifficulty[row.difficulty]);
    }
  });

  it("presents every batch with its roster, variety, difficulty, and match count", () => {
    const rows = batchRows(report);
    expect(rows).toHaveLength(report.batches.length);
    const underdog = rows.find((row) => row.label === "underdog-ruthless")!;
    expect(underdog).toMatchObject({ rosterKey: "m10-underdog", variety: "Standard", difficulty: "ruthless", matches: 32 });
    expect(underdog.winShare).toBe(report.analytics.winShare.byBatch["underdog-ruthless"]);
    const tag = rows.find((row) => row.label === "tag-standard")!;
    expect(tag.variety).toBe("Standard");
    expect(tag.matches).toBeGreaterThan(0);
    // The head-to-head pairs surface in the batch table with the equal roster.
    const h2h = rows.find((row) => row.label === "h2h-novice-ruthless")!;
    expect(h2h).toMatchObject({ rosterKey: "h2h-equal", variety: "Standard", difficulty: "ruthless", matches: 32 });
    expect(h2h.winShare).toBe(report.analytics.winShare.byBatch["h2h-novice-ruthless"]);
  });

  it("presents match-length distributions for all three varieties", () => {
    const rows = varietyLengthRows(report);
    expect(rows.map((row) => row.variety)).toEqual(["Standard", "Steel Cage", "Ladder"]);
    const standard = rows[0];
    expect(standard.meanMinutes).toBeGreaterThan(4);
    expect(standard.drawRate).toBe(report.analytics.matchLength.byVariety.standard.drawRate);
    const cage = rows[1];
    expect(cage.meanMinutes).toBeLessThan(standard.meanMinutes);
    expect(cage.drawRate).toBeLessThan(standard.drawRate);
    const ladder = rows[2];
    expect(ladder.meanMinutes).toBeLessThan(cage.meanMinutes);
  });

  it("presents finish methods ranked by frequency with pinned counts", () => {
    const rows = varietyFinishRows(report);
    const standard = rows.find((row) => row.variety === "Standard")!;
    expect(standard.methods.reduce((sum, row) => sum + (row.count ?? 0), 0)).toBe(Object.values(report.analytics.finishMethods.byVariety.standard).reduce<number>((a, b) => a + (b ?? 0), 0));
    const cage = rows.find((row) => row.variety === "Steel Cage")!;
    expect(cage.methods[0].count).toBeGreaterThan(0);
    const ladder = rows.find((row) => row.variety === "Ladder")!;
    expect(ladder.methods[0].count).toBeGreaterThan(0);
  });
});
