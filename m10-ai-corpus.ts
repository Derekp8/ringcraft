import {
  advanceUntilPlayerDecision,
  autoAllocateCreationPoints,
  careerRecordToDefinition,
  createCreationSession,
  createMatch,
  finalizeCreationSession,
  fnv1a32,
  hashMatchState,
  rollCreationHistory,
  rollCreationStature,
  setCreationIdentity,
  setCreationSide,
  submitPlayerIntent,
} from "../src/core";
import type { AiDifficulty, LegalAction, MatchSetup, MatchState, WrestlerCareerRecord } from "../src/core";

export const M10_DECISION_LOG_SCHEMA = "m10-ai-decision-log-v1";
export const M10_CAPTURED_POLICY = "asw91-ai-policy-v1";

/**
 * Normalizes line endings (CRLF and lone CR to LF) before content hashing, so
 * the corpus fixture's pinned hash is stable regardless of checkout EOL
 * settings. The canonical gate runs on Linux (LF checkouts), but a Windows
 * checkout with `core.autocrlf=true` materializes the fixture as CRLF; the
 * `?raw`/readFile text then differs from the LF blob and would shift the
 * hash without this normalization. LF-only text passes through byte-identically.
 */
export function normalizeFixtureEol(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export interface CorpusMatchConfig {
  label: string;
  seed: number;
  mode: "singles" | "tag";
  timeLimitMinutes: number;
  /** Key into the fixture `rosters` map. */
  rosterKey: string;
  /** Runs the same seed/roster with team roles swapped so the other side's decisions surface as player decisions. */
  swapped: boolean;
  /** Rules Lab-style scripted dice; the replay contract derives AI moves from the config, so these must round-trip with the fixture. */
  scriptedRolls?: number[];
  /** Visible AI opposition difficulty; part of the replay contract via `hashMatchState`. Absent equals `standard` (the v1 baseline). */
  aiDifficulty?: AiDifficulty;
}

export interface AiDecisionEntry {
  tick: number;
  actorId: string;
  kind: string;
  chosenKey: string;
  /** Deterministic per-decision hash over (seed, tick, actorId, kind, chosenKey) so a single changed decision is located by seed, tick, and kind. */
  hash: string;
}

/** Canonical per-decision hash; stable across replays and regenerations of the same decision. */
export function corpusDecisionHash(seed: number, entry: Pick<AiDecisionEntry, "tick" | "actorId" | "kind" | "chosenKey">): string {
  return fnv1a32({ seed, tick: entry.tick, actorId: entry.actorId, kind: entry.kind, chosenKey: entry.chosenKey });
}

export interface CorpusMatchRecord {
  label: string;
  config: CorpusMatchConfig;
  decisions: AiDecisionEntry[];
  /** Canonical hash of the terminal match state captured when the run completed. */
  finalStateHash: string;
}

export interface CorpusReplayResult {
  entries: AiDecisionEntry[];
  /** Canonical hash of the terminal match state replayed under the injected selector. */
  finalStateHash: string;
}

export type DivergenceReason = "field-mismatch" | "missing-golden" | "missing-actual";

/** A single diverged decision, located by run label, seed, tick, and kind. */
export interface CorpusDecisionDivergence {
  recordIndex: number;
  label: string;
  seed: number;
  decisionIndex: number;
  tick: number;
  actorId: string;
  kind: string;
  reason: DivergenceReason;
  golden?: AiDecisionEntry;
  actual?: AiDecisionEntry;
}

/** Run-level divergence (decision count or final match state hash). */
export interface CorpusRunDivergence {
  recordIndex: number;
  label: string;
  seed: number;
  expectedDecisionCount: number;
  actualDecisionCount: number;
  goldenFinalStateHash?: string;
  actualFinalStateHash?: string;
}

export interface CorpusDiffResult {
  runs: number;
  decisions: number;
  divergences: CorpusDecisionDivergence[];
  runDivergences: CorpusRunDivergence[];
  divergenceCount: number;
  clean: boolean;
}

/**
 * Whole-corpus diff: replays every run under the injected selector and reports
 * every diverged decision across all runs (not just the first), plus any
 * run-level count or final-state-hash divergences. Each decision divergence
 * carries the exact run label, seed, tick, kind, and both sides so a scratch
 * mutation is located precisely. The CLI verifier's `verifyCorpusFixture`
 * throws on the first entry of this diff, so the fast-failing gate and the
 * full-reporting tool share one locating implementation.
 */
export function diffCorpusFixture(fixture: DecisionLogFixture, select: PolicySelect): CorpusDiffResult {
  const divergences: CorpusDecisionDivergence[] = [];
  const runDivergences: CorpusRunDivergence[] = [];
  let decisions = 0;
  for (let recordIndex = 0; recordIndex < fixture.corpus.length; recordIndex += 1) {
    const record = fixture.corpus[recordIndex];
    const { entries: actual, finalStateHash: replayedHash } = collectCorpusDecisions(record.config, fixture.rosters[record.config.rosterKey], select);
    const expected = record.decisions;
    decisions += expected.length;

    let expectedCount = expected.length;
    let actualCount = actual.length;
    if (actual.length !== expected.length) {
      runDivergences.push({ recordIndex, label: record.label, seed: record.config.seed, expectedDecisionCount: expected.length, actualDecisionCount: actual.length });
    }
    if (replayedHash !== record.finalStateHash) {
      runDivergences.push({ recordIndex, label: record.label, seed: record.config.seed, expectedDecisionCount: expected.length, actualDecisionCount: actual.length, goldenFinalStateHash: record.finalStateHash, actualFinalStateHash: replayedHash });
    }

    const breadth = Math.max(expected.length, actual.length);
    for (let index = 0; index < breadth; index += 1) {
      const golden = expected[index];
      const replayed = actual[index];
      if (!golden || !replayed) {
        divergences.push({
          recordIndex,
          label: record.label,
          seed: record.config.seed,
          decisionIndex: index,
          tick: (golden ?? replayed)!.tick,
          actorId: (golden ?? replayed)!.actorId,
          kind: (golden ?? replayed)!.kind,
          reason: golden ? "missing-actual" : "missing-golden",
          golden,
          actual: replayed,
        });
        continue;
      }
      if (golden.tick !== replayed.tick || golden.actorId !== replayed.actorId || golden.kind !== replayed.kind || golden.chosenKey !== replayed.chosenKey || golden.hash !== replayed.hash) {
        divergences.push({
          recordIndex,
          label: record.label,
          seed: record.config.seed,
          decisionIndex: index,
          tick: golden.tick,
          actorId: golden.actorId,
          kind: golden.kind,
          reason: "field-mismatch",
          golden,
          actual: replayed,
        });
      }
    }
  }
  return { runs: fixture.corpus.length, decisions, divergences, runDivergences, divergenceCount: divergences.length + runDivergences.length, clean: divergences.length === 0 && runDivergences.length === 0 };
}

/**
 * Verifies a corpus fixture by replaying every run under the injected selector
 * and throwing on the first divergence with the exact seed, tick, and kind in
 * the message. Built on `diffCorpusFixture`, so the fast-failing gate and the
 * whole-corpus diff tool share one locating implementation. Shared by
 * `verify-m10-corpus.ts` (the CLI verifier) and the mutation-fault-injection
 * test, so both exercise the same locating logic.
 */
export function verifyCorpusFixture(fixture: DecisionLogFixture, select: PolicySelect): void {
  const diff = diffCorpusFixture(fixture, select);
  // Preserve the original per-record priority: count mismatch, then decision
  // divergence, then final-state hash — in record order — so the fast-failing
  // gate reports the same first failure the diff tool would surface.
  for (let recordIndex = 0; recordIndex < fixture.corpus.length; recordIndex += 1) {
    const runDivergences = diff.runDivergences.filter((entry) => entry.recordIndex === recordIndex);
    const countMismatch = runDivergences.find((entry) => entry.goldenFinalStateHash === undefined);
    if (countMismatch) throw new Error(`${countMismatch.label}: expected ${countMismatch.expectedDecisionCount} decisions, replayed ${countMismatch.actualDecisionCount}.`);
    const first = diff.divergences.find((entry) => entry.recordIndex === recordIndex);
    if (first) {
      if (first.reason === "missing-actual" || first.reason === "missing-golden") {
        throw new Error(`${first.label}: expected ${first.golden ? "a decision" : "fewer decisions"} at index ${first.decisionIndex} (seed ${first.seed}, tick ${first.tick}, kind ${first.kind}); ${first.reason === "missing-actual" ? "replay produced no decision" : "golden log has no decision"}.`);
      }
      throw new Error(`${first.label} (seed ${first.seed}, tick ${first.tick}, kind ${first.kind}): decision ${first.decisionIndex} diverged.\n  golden: ${JSON.stringify(first.golden)}\n  actual: ${JSON.stringify(first.actual)}`);
    }
    const finalStateMismatch = runDivergences.find((entry) => entry.goldenFinalStateHash !== undefined);
    if (finalStateMismatch) throw new Error(`${finalStateMismatch.label}: final state hash diverged.\n  golden: ${finalStateMismatch.goldenFinalStateHash}\n  actual: ${finalStateMismatch.actualFinalStateHash}`);
  }
}

export interface DecisionLogFixture {
  schema: string;
  capturedPolicy: string;
  rosters: Record<string, WrestlerCareerRecord[]>;
  corpus: CorpusMatchRecord[];
}

export function makeCorpusRecord(seed: number, index: number): WrestlerCareerRecord {
  let session = createCreationSession(seed);
  session = setCreationIdentity(session, { name: `Corpus Wrestler ${index}`, epithet: `Seed ${seed}`, affiliation: "M10 AI Corpus" });
  session = setCreationSide(session, index % 2 ? "rulebreaker" : "fan-favorite");
  session = rollCreationStature(session);
  session = rollCreationHistory(session);
  session = autoAllocateCreationPoints(session);
  return finalizeCreationSession(session).finalized!;
}

export function buildCorpusMatchSetup(config: CorpusMatchConfig, records: WrestlerCareerRecord[]): MatchSetup {
  const ids = records.map((record) => record.id);
  const aiDifficulty = config.aiDifficulty;
  if (config.mode === "tag") {
    if (ids.length !== 4) throw new Error("Tag corpus matches require exactly four roster records.");
    const playerIds = config.swapped ? [ids[1], ids[3]] : [ids[0], ids[2]];
    const aiIds = config.swapped ? [ids[0], ids[2]] : [ids[1], ids[3]];
    const byId = new Map(records.map((record, index) => [ids[index], record]));
    return {
      seed: config.seed,
      timeLimitMinutes: config.timeLimitMinutes,
      mode: "tag",
      scriptedRolls: config.scriptedRolls,
      aiDifficulty,
      roster: Object.fromEntries([...playerIds.map((id) => [id, careerRecordToDefinition(byId.get(id)!, id, "player")]), ...aiIds.map((id) => [id, careerRecordToDefinition(byId.get(id)!, id, "ai")])]),
      teamMembers: { player: playerIds, ai: aiIds },
    };
  }
  if (ids.length !== 2) throw new Error("Singles corpus matches require exactly two roster records.");
  const playerId = config.swapped ? ids[1] : ids[0];
  const aiId = config.swapped ? ids[0] : ids[1];
  const byId = new Map(records.map((record, index) => [ids[index], record]));
  return {
    seed: config.seed,
    timeLimitMinutes: config.timeLimitMinutes,
    mode: "singles",
    scriptedRolls: config.scriptedRolls,
    aiDifficulty,
    roster: {
      [playerId]: careerRecordToDefinition(byId.get(playerId)!, playerId, "player"),
      [aiId]: careerRecordToDefinition(byId.get(aiId)!, aiId, "ai"),
    },
    teamMembers: { player: [playerId], ai: [aiId] },
  };
}

export type PolicySelect = (state: MatchState, decision: NonNullable<MatchState["decision"]>) => LegalAction;

/**
 * Replays a corpus match and records every multi-action player-side decision the
 * injected selector makes. AI-side decisions are resolved inside
 * `advanceUntilPlayerDecision`; running each match twice with swapped sides
 * surfaces both wrestlers' decisions with their kinds.
 */
export function collectCorpusDecisions(config: CorpusMatchConfig, records: WrestlerCareerRecord[], select: PolicySelect): CorpusReplayResult {
  let state = createMatch(buildCorpusMatchSetup(config, records));
  const entries: AiDecisionEntry[] = [];
  let guard = 0;
  while (!state.result) {
    guard += 1;
    if (guard > 200_000) throw new Error(`Corpus match ${config.label} exceeded the decision guard.`);
    state = advanceUntilPlayerDecision(state);
    if (state.result) break;
    const decision = state.decision;
    if (!decision) throw new Error(`Corpus match ${config.label} stalled without a decision.`);
    const action = select(state, decision);
    const entry = { tick: state.tick, actorId: decision.actorId, kind: decision.kind, chosenKey: action.key };
    entries.push({ ...entry, hash: corpusDecisionHash(state.config.seed, entry) });
    state = submitPlayerIntent(state, action.intent);
  }
  return { entries, finalStateHash: hashMatchState(state) };
}

export function kindCoverage(records: CorpusMatchRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) for (const entry of record.decisions) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  return counts;
}

export const ALL_DECISION_KINDS = [
  "turn",
  "dodge-commit",
  "damage-charm",
  "hold-escape",
  "pin-followup",
  "submission-followup",
  "interference",
  "bonus-attack",
  "knockout-pin",
  "tag-double-team",
  "universal-recovery",
  "outside-recovery",
] as const;

/** Greedy, order-stable selection of the smallest prefix that covers every decision kind. */
export function selectMinimalCorpus(records: CorpusMatchRecord[]): CorpusMatchRecord[] {
  const covered = new Set<string>();
  const selected: CorpusMatchRecord[] = [];
  for (const record of records) {
    const newKinds = record.decisions.map((entry) => entry.kind).filter((kind) => !covered.has(kind));
    if (newKinds.length === 0) continue;
    for (const kind of newKinds) covered.add(kind);
    selected.push(record);
    if (covered.size === ALL_DECISION_KINDS.length) break;
  }
  return selected;
}
