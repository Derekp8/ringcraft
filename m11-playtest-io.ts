import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashMatchState, replayFromInputLog } from "../src/core";
import type { WrestlerCareerRecord } from "../src/core";
import {
  ALL_BALANCE_BATCHES,
  buildAnalytics,
  buildMatchSetup,
  h2hMatchSetup,
  playBalanceMatch,
  reportHash,
  rowFromState,
  underdogMatchSetup,
} from "./m11-playtest-batch";
import type { PlaytestBalanceReport, PlaytestBatchSpec } from "./m11-playtest-batch";

export async function loadM10Rosters(): Promise<Record<string, WrestlerCareerRecord[]>> {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const fixture = JSON.parse(await readFile(join(projectRoot, "fixtures", "m10", "ai-decision-log-v1.json"), "utf8")) as { rosters: Record<string, WrestlerCareerRecord[]> };
  return fixture.rosters;
}

/**
 * Builds the match setup for a batch run, resolving roster sources. `seasonOffset`
 * shifts the seed base so the same corpus can be re-run across seeded "seasons"
 * (the M11 pacing-trend gate); batch index keeps batches disjoint within a season.
 */
export async function matchSetupFor(spec: PlaytestBatchSpec, index: number, seed: number, seasonOffset = 0) {
  const seedBase = index * 1000 + seasonOffset;
  if (spec.rosterKey === "m10-underdog") return underdogMatchSetup(spec, seedBase, seed);
  if (spec.rosterKey === "h2h-equal") return h2hMatchSetup(spec, seedBase, seed);
  const records = (await loadM10Rosters())[spec.rosterKey];
  if (!records) throw new Error(`Unknown roster key ${spec.rosterKey} in the M10 corpus fixture.`);
  return buildMatchSetup(spec, spec.rosterKey, records, seedBase, seed);
}

/** Builds the full report by playing every batch match (shared corpus plus head-to-head pairs). */
export async function buildPlaytestBalanceReport(): Promise<PlaytestBalanceReport> {
  const batches: PlaytestBalanceReport["batches"] = [];
  for (const [index, spec] of ALL_BALANCE_BATCHES.entries()) {
    const seedBase = index * 1000;
    const playerSide = spec.playerSide ?? "v1";
    const matches: PlaytestBalanceReport["batches"][number]["matches"] = [];
    for (let seed = 0; seed < spec.seeds; seed += 1) {
      const setup = await matchSetupFor(spec, index, seed);
      matches.push(rowFromState(playBalanceMatch(setup, playerSide), seed));
    }
    batches.push({ label: spec.label, rosterKey: spec.rosterKey, variety: spec.variety, difficulty: spec.difficulty, playerSide, seedBase, timeLimitMinutes: 8, matches });
  }
  const report = { schema: "asw91-playtest-balance-report-v1", policy: "asw91-ai-policy-v1", ruleset: "classic-1991-vertical-slice", timeLimitMinutes: 8, batches, analytics: buildAnalytics(batches), reportHash: "" } as PlaytestBalanceReport;
  report.reportHash = reportHash(report);
  return report;
}

/** Re-derives every batch match and returns per-batch verification results. */
export async function verifyPlaytestBalanceReport(report: PlaytestBalanceReport): Promise<{ ok: boolean; errors: string[]; replaySamples: number }> {
  const errors: string[] = [];
  let replaySamples = 0;
  for (const [index, spec] of ALL_BALANCE_BATCHES.entries()) {
    const expected = report.batches[index];
    const playerSide = spec.playerSide ?? "v1";
    if (!expected || expected.label !== spec.label || expected.playerSide !== playerSide) {
      errors.push(`Batch ${index}: expected ${spec.label} (playerSide ${playerSide}), found ${expected?.label ?? "none"} (${expected?.playerSide ?? "n/a"}).`);
      continue;
    }
    for (let seed = 0; seed < spec.seeds; seed += 1) {
      const setup = await matchSetupFor(spec, index, seed);
      const actual = rowFromState(playBalanceMatch(setup, playerSide), seed);
      const pinned = expected.matches[seed];
      if (!pinned) {
        errors.push(`${spec.label} seed ${seed}: missing pinned row.`);
        continue;
      }
      if (actual.winnerTeam !== pinned.winnerTeam || actual.method !== pinned.method || actual.minutes !== pinned.minutes || actual.ticks !== pinned.ticks || actual.finalHash !== pinned.finalHash) {
        errors.push(`${spec.label} seed ${seed}: diverged (winner ${actual.winnerTeam} vs ${pinned.winnerTeam}, method ${actual.method} vs ${pinned.method}, hash ${actual.finalHash} vs ${pinned.finalHash}).`);
      }
    }
  }
  // Sample replay-through-input-log determinism across varieties (the strongest
  // replay contract) on a small fixed subset of matches — including the first
  // head-to-head pair (batch 11) so the policy-vs-policy mode is covered.
  const samples: Array<{ batch: number; seed: number }> = [
    { batch: 1, seed: 0 }, { batch: 6, seed: 7 }, { batch: 9, seed: 13 }, { batch: 10, seed: 3 }, { batch: 11, seed: 0 },
  ];
  for (const sample of samples) {
    const spec = ALL_BALANCE_BATCHES[sample.batch];
    const setup = await matchSetupFor(spec, sample.batch, sample.seed);
    const live = playBalanceMatch(setup, spec.playerSide ?? "v1");
    if (hashMatchState(replayFromInputLog(live)) !== hashMatchState(live)) {
      errors.push(`Replay sample ${spec.label} seed ${sample.seed}: input-log replay diverged from the live run.`);
    }
    replaySamples += 1;
  }
  // Aggregate determinism.
  if (JSON.stringify(buildAnalytics(report.batches)) !== JSON.stringify(report.analytics)) {
    errors.push("Aggregates diverged from the pinned report.");
  }
  if (reportHash(report) !== report.reportHash) {
    errors.push("reportHash diverged from the pinned value.");
  }
  // Variety method-set invariants (the M11 gate guarantees these).
  const allowedCage = new Set(["pin", "submission", "escape", "time-limit-draw"]);
  const allowedLadder = new Set(["pin", "submission", "retrieval", "time-limit-draw"]);
  for (const batch of report.batches) {
    for (const row of batch.matches) {
      const allowed = batch.variety === "cage" ? allowedCage : batch.variety === "ladder" ? allowedLadder : null;
      if (allowed && !allowed.has(row.method)) errors.push(`${batch.label} seed ${row.seed}: method ${row.method} is impossible in a ${batch.variety} match.`);
    }
  }
  return { ok: errors.length === 0, errors, replaySamples };
}
