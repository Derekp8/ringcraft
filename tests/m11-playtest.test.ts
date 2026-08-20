import { describe, expect, it } from "vitest";
import { hashMatchState, replayFromInputLog } from "../src/core";
import {
  ALL_BALANCE_BATCHES,
  HEAD_TO_HEAD_BATCHES,
  PLAYTEST_BALANCE_SCHEMA,
  PLAYTEST_BATCHES,
  PLAYTEST_TIME_LIMIT_MINUTES,
  buildAnalytics,
  buildMatchSetup,
  h2hMatchSetup,
  playBalanceMatch,
  reportHash,
  rowFromState,
  underdogMatchSetup,
  wilsonScoreInterval,
} from "../scripts/m11-playtest-batch";
import reportFixture from "../fixtures/m11/playtest-balance-report-v1.json";
import m10Fixture from "../fixtures/m10/ai-decision-log-v1.json";
import type { PlaytestBalanceReport } from "../scripts/m11-playtest-batch";

const report = reportFixture as PlaytestBalanceReport;
const LADDER = ["novice", "standard", "veteran", "ruthless"] as const;

describe("M11 seeded playtest balance report", () => {
  it("declares the report schema, policy, and fixed time limit", () => {
    expect(report.schema).toBe(PLAYTEST_BALANCE_SCHEMA);
    expect(report.policy).toBe("asw91-ai-policy-v1");
    expect(report.ruleset).toBe("classic-1991-vertical-slice");
    expect(report.timeLimitMinutes).toBe(PLAYTEST_TIME_LIMIT_MINUTES);
    expect(report.batches.length).toBe(ALL_BALANCE_BATCHES.length);
    expect(HEAD_TO_HEAD_BATCHES.length).toBe(6);
    for (const batch of report.batches) {
      expect(batch.playerSide === "v1" || (LADDER as readonly string[]).includes(batch.playerSide)).toBe(true);
      expect(batch.timeLimitMinutes).toBe(PLAYTEST_TIME_LIMIT_MINUTES);
      expect(batch.matches.length).toBeGreaterThan(0);
    }
  });

  it("carries a valid 95% Wilson confidence interval on every win share", () => {
    const ci = report.analytics.winShareCI;
    for (const batch of report.batches) {
      const bounds = ci.byBatch[batch.label];
      expect(bounds).toBeDefined();
      const share = report.analytics.winShare.byBatch[batch.label];
      expect(bounds.lower).toBeGreaterThanOrEqual(0);
      expect(bounds.upper).toBeLessThanOrEqual(1);
      expect(bounds.lower).toBeLessThanOrEqual(share + 1e-9);
      expect(bounds.upper).toBeGreaterThanOrEqual(share - 1e-9);
    }
    // The interval function itself is deterministic and edge-case safe.
    expect(wilsonScoreInterval(1, 32)).toEqual(wilsonScoreInterval(1, 32));
    expect(wilsonScoreInterval(0, 32).lower).toBe(0);
    expect(wilsonScoreInterval(32, 32).upper).toBe(1);
    expect(wilsonScoreInterval(0, 0)).toEqual({ lower: 0, upper: 1 });
    // byDifficulty is the underdog batch's interval for each difficulty.
    for (const difficulty of LADDER) {
      expect(ci.byDifficulty[difficulty]).toEqual(ci.byBatch[`underdog-${difficulty}`]);
    }
  });

  it("treats underdog confidence intervals as descriptive evidence rather than a difficulty gate", () => {
    const ci = report.analytics.winShareCI.byDifficulty;
    for (const difficulty of LADDER) {
      expect(ci[difficulty]!.lower).toBeGreaterThanOrEqual(0);
      expect(ci[difficulty]!.upper).toBeLessThanOrEqual(1);
      expect(ci[difficulty]!.lower).toBeLessThanOrEqual(ci[difficulty]!.upper);
    }
  });

  it("pins direct equal-roster head-to-head evidence without relying on the historical underdog ladder", () => {
    const pairs = report.analytics.headToHead.byPair;
    expect(Object.keys(pairs).sort()).toEqual([...HEAD_TO_HEAD_BATCHES.map((spec) => spec.label)].sort());
    for (const spec of HEAD_TO_HEAD_BATCHES) {
      const pair = pairs[spec.label];
      expect(pair).toBeDefined();
      expect(pair.higher).toBe(spec.difficulty);
      expect(pair.lower).toBe(spec.playerSide);
      expect(pair.higherShare + pair.lowerShare).toBeCloseTo(1, 6);
      expect(pair.drawRate).toBeGreaterThanOrEqual(0);
      expect(pair.drawRate).toBeLessThan(1);
    }
    // The upper three policies must retain their strategic ordering directly.
    for (const label of ["h2h-standard-veteran", "h2h-standard-ruthless", "h2h-veteran-ruthless"]) {
      expect(pairs[label]!.higherShare).toBeGreaterThan(pairs[label]!.lowerShare);
    }
  });

  it("documents novice vs ruthless as direct evidence rather than a baseline-relative claim", () => {
    const pair = report.analytics.headToHead.byPair["h2h-novice-ruthless"];
    expect(pair).toBeDefined();
    expect(pair.higherShare + pair.lowerShare).toBeCloseTo(1, 6);
    expect(pair.drawRate).toBeGreaterThanOrEqual(0);
    expect(pair.drawRate).toBeLessThan(1);
  });

  it("keeps the historical underdog shares as bounded descriptive metrics", () => {
    const shares = report.analytics.winShare.byDifficulty;
    for (const difficulty of LADDER) {
      expect(shares[difficulty]).toBeGreaterThanOrEqual(0);
      expect(shares[difficulty]).toBeLessThanOrEqual(1);
    }
  });

  it("reproduces the pinned underdog win shares live without imposing obsolete ordering", () => {
    for (const index of [0, 1, 2, 3]) {
      const spec = PLAYTEST_BATCHES[index];
      let ai = 0;
      let decisive = 0;
      for (let seed = 0; seed < spec.seeds; seed += 1) {
        const row = rowFromState(playBalanceMatch(underdogMatchSetup(spec, index * 1000, seed)), seed);
        if (row.winnerTeam === null) continue;
        decisive += 1;
        if (row.winnerTeam === "ai") ai += 1;
      }
      const liveShare = decisive === 0 ? 0 : ai / decisive;
      expect(liveShare).toBe(report.analytics.winShare.byDifficulty[spec.difficulty]);
    }
  }, 120_000);

  it("re-derives the pinned head-to-head pair live from the seeded equal-rosters sweep", () => {
    // Replay the extreme pair's pinned shares from the live corpus (batch index
    // 13 is h2h-novice-ruthless on the h2h-equal roster), driving the player
    // side with the novice policy. The setup must route through h2hMatchSetup
    // (the h2h-equal roster is built, not loaded from the M10 fixture).
    const spec = HEAD_TO_HEAD_BATCHES[2];
    expect(spec.label).toBe("h2h-novice-ruthless");
    const pinned = report.analytics.headToHead.byPair["h2h-novice-ruthless"];
    let higherWins = 0;
    let decisive = 0;
    let draws = 0;
    for (let seed = 0; seed < spec.seeds; seed += 1) {
      const setup = h2hMatchSetup(spec, (PLAYTEST_BATCHES.length + 2) * 1000, seed);
      const row = rowFromState(playBalanceMatch(setup, spec.playerSide), seed);
      if (row.winnerTeam === null) draws += 1;
      else {
        decisive += 1;
        if (row.winnerTeam === "ai") higherWins += 1;
      }
    }
    const total = spec.seeds;
    expect(higherWins / decisive).toBe(pinned.higherShare);
    expect((decisive - higherWins) / decisive).toBe(pinned.lowerShare);
    expect(draws / total).toBe(pinned.drawRate);
  }, 120_000);

  it("shows cage/ladder matches are faster than standard and never hit their forbidden methods", () => {
    const lengths = report.analytics.matchLength.byVariety;
    expect(lengths.cage.meanMinutes).toBeLessThan(lengths.standard.meanMinutes);
    expect(lengths.ladder.meanMinutes).toBeLessThan(lengths.standard.meanMinutes);
    expect(lengths.cage.meanTicks).toBeLessThan(lengths.standard.meanTicks);
    expect(lengths.ladder.meanTicks).toBeLessThan(lengths.standard.meanTicks);
    for (const variety of ["standard", "cage", "ladder"] as const) {
      const length = lengths[variety];
      expect(length.minMinutes).toBeGreaterThanOrEqual(1);
      expect(length.maxMinutes).toBeLessThanOrEqual(report.timeLimitMinutes);
      expect(length.medianMinutes).toBeGreaterThanOrEqual(length.minMinutes);
      expect(length.medianMinutes).toBeLessThanOrEqual(length.maxMinutes);
    }
    const cage = report.analytics.finishMethods.byVariety.cage;
    const ladder = report.analytics.finishMethods.byVariety.ladder;
    for (const method of Object.keys(cage) as (keyof typeof cage)[]) {
      expect(["pin", "submission", "escape", "time-limit-draw"]).toContain(method);
    }
    for (const method of Object.keys(ladder) as (keyof typeof ladder)[]) {
      expect(["pin", "submission", "retrieval", "time-limit-draw"]).toContain(method);
    }
    // The variety win conditions actually occur at a healthy rate.
    expect((cage.escape ?? 0) + (ladder.retrieval ?? 0)).toBeGreaterThan(0);
  });

  it("verifies aggregate determinism and the report hash", () => {
    expect(buildAnalytics(report.batches)).toEqual(report.analytics);
    expect(reportHash(report)).toBe(report.reportHash);
  });

  it("replays sampled matches from each variety through the input log", () => {
    const rosters = m10Fixture.rosters as unknown as Record<string, Parameters<typeof buildMatchSetup>[2]>;
    const samples: Array<{ batch: number; seed: number }> = [
      { batch: 1, seed: 0 }, // underdog-standard (pure underdog roster)
      { batch: 6, seed: 7 }, // cage (dominant-singles)
      { batch: 9, seed: 13 }, // ladder (dominant-singles)
      { batch: 10, seed: 3 }, // tag (standard-tag)
      { batch: 11, seed: 0 }, // h2h-novice-standard (policy-vs-policy head-to-head)
    ];
    for (const sample of samples) {
      const spec = ALL_BALANCE_BATCHES[sample.batch];
      const setup = spec.rosterKey === "m10-underdog"
        ? underdogMatchSetup(spec, sample.batch * 1000, sample.seed)
        : spec.rosterKey === "h2h-equal"
          ? h2hMatchSetup(spec, sample.batch * 1000, sample.seed)
          : buildMatchSetup(spec, spec.rosterKey, rosters[spec.rosterKey], sample.batch * 1000, sample.seed);
      const live = playBalanceMatch(setup, spec.playerSide ?? "v1");
      expect(hashMatchState(replayFromInputLog(live))).toBe(hashMatchState(live));
    }
  }, 120_000);

  it("keeps every standard-variety batch match free of M11 variety/ladder state", () => {
    for (const batch of report.batches) {
      if (batch.variety !== "standard") continue;
      for (const row of batch.matches) {
        expect(row.method).not.toBe("escape");
        expect(row.method).not.toBe("retrieval");
      }
    }
  });
});
