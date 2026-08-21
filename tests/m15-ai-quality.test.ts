import { describe, expect, it } from "vitest";
import { AI_DIFFICULTIES, AI_POLICY_VERSION } from "../src/core";
import { M15_AI_QUALITY_SCHEMA, M15_AI_QUALITY_SEEDS, buildAiDecisionQualityReport } from "../scripts/m15-ai-quality";

describe("M15 AI decision-quality corpus", () => {
  it("completes every fixed-seed mode/difficulty row with legal deterministic AI choices", { timeout: 180_000 }, () => {
    const report = buildAiDecisionQualityReport();
    expect(report.schema).toBe(M15_AI_QUALITY_SCHEMA);
    expect(report.aiPolicyVersion).toBe(AI_POLICY_VERSION);
    expect(report.rows).toHaveLength(AI_DIFFICULTIES.length * 2);
    expect(report.totals.matches).toBe(AI_DIFFICULTIES.length * 2 * M15_AI_QUALITY_SEEDS.length);
    expect(report.totals.illegalChoices).toBe(0);
    expect(report.totals.stalled).toBe(0);
    expect(report.totals.replayDivergences).toBe(0);
    expect(report.totals.aiDecisions).toBeGreaterThan(0);

    for (const difficulty of AI_DIFFICULTIES) {
      for (const mode of ["singles", "tag"] as const) {
        const row = report.rows.find((candidate) => candidate.difficulty === difficulty && candidate.mode === mode);
        expect(row, `${difficulty} ${mode}`).toBeTruthy();
        expect(row!.seedsEvaluated).toEqual([...M15_AI_QUALITY_SEEDS]);
        expect(row!.matchesCompleted).toBe(M15_AI_QUALITY_SEEDS.length);
        expect(row!.legalityProbes).toBe(M15_AI_QUALITY_SEEDS.length);
        expect(row!.illegalChoices).toBe(0);
        expect(row!.impossibleOrStalledStates).toBe(0);
        expect(row!.replayDivergences).toBe(0);
        expect(Object.values(row!.resultMethods).reduce((sum, count) => sum + count, 0)).toBe(M15_AI_QUALITY_SEEDS.length);
        expect(row!.decisionsEvaluated).toBeGreaterThan(0);
      }
    }
  });
});
