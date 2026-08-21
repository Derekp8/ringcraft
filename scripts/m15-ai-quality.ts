import {
  AI_DIFFICULTIES,
  AI_POLICY_VERSION,
  advanceUntilPlayerDecision,
  chooseAiAction,
  chooseDeterministicPolicyAction,
  createMatch,
  enumerateTurnActions,
  hashMatchState,
  replayFromInputLog,
  submitPlayerIntent,
} from "../src/core";
import type { AiDifficulty, MatchMode, MatchState } from "../src/core";

export const M15_AI_QUALITY_SCHEMA = "ringcraft-ai-decision-quality-v1";
export const M15_AI_QUALITY_SEEDS = [1991, 2000, 50025, 50061] as const;

export interface AiQualityRow {
  difficulty: AiDifficulty;
  mode: MatchMode;
  seedsEvaluated: number[];
  matchesCompleted: number;
  decisionsEvaluated: number;
  legalityProbes: number;
  illegalChoices: number;
  impossibleOrStalledStates: number;
  replayDivergences: number;
  resultMethods: Record<string, number>;
  averagePlayerDecisions: number;
  medianPlayerDecisions: number;
}

export interface AiDecisionQualityReport {
  schema: typeof M15_AI_QUALITY_SCHEMA;
  aiPolicyVersion: string;
  generatedFrom: "deterministic-fixed-seed-corpus";
  rows: AiQualityRow[];
  totals: {
    matches: number;
    aiDecisions: number;
    legalityProbes: number;
    illegalChoices: number;
    stalled: number;
    replayDivergences: number;
  };
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  if (!ordered.length) return 0;
  return ordered[Math.floor((ordered.length - 1) / 2)];
}

function legalityProbe(state: MatchState): { probes: number; illegal: number } {
  const actorId = state.teams.ai.legalInRingId;
  const actions = enumerateTurnActions(state, actorId);
  if (!actions.length) return { probes: 0, illegal: 0 };
  const decision = { actorId, completesActivationFor: actorId, kind: "turn" as const, prompt: "M15 AI legality probe", actions };
  const selected = chooseAiAction(state, decision);
  return { probes: 1, illegal: actions.includes(selected) ? 0 : 1 };
}

function play(mode: MatchMode, difficulty: AiDifficulty, seed: number): {
  completed: boolean;
  aiDecisions: number;
  replayDiverged: boolean;
  resultMethod: string;
  playerDecisions: number;
  legalityProbes: number;
  illegalChoices: number;
} {
  let state = createMatch({ seed, mode, aiDifficulty: difficulty, timeLimitMinutes: 2 });
  const probe = legalityProbe(state);
  let guard = 0;
  while (!state.result && guard < 500) {
    state = advanceUntilPlayerDecision(state);
    if (state.result) break;
    if (!state.decision?.actions.length) break;
    state = submitPlayerIntent(state, chooseDeterministicPolicyAction(state, state.decision).intent);
    guard += 1;
  }
  const completed = Boolean(state.result);
  const replay = replayFromInputLog(state);
  return {
    completed,
    aiDecisions: state.events.filter((event) => event.type === "ai-choice").length,
    replayDiverged: hashMatchState(replay) !== hashMatchState(state),
    resultMethod: state.result?.method ?? "stalled",
    playerDecisions: state.inputLog.length,
    legalityProbes: probe.probes,
    illegalChoices: probe.illegal,
  };
}

export function buildAiDecisionQualityReport(): AiDecisionQualityReport {
  const rows: AiQualityRow[] = [];
  for (const difficulty of AI_DIFFICULTIES) {
    for (const mode of ["singles", "tag"] as const) {
      const results = M15_AI_QUALITY_SEEDS.map((seed) => play(mode, difficulty, seed));
      const resultMethods: Record<string, number> = {};
      for (const result of results) resultMethods[result.resultMethod] = (resultMethods[result.resultMethod] ?? 0) + 1;
      const decisions = results.map((result) => result.playerDecisions);
      rows.push({
        difficulty,
        mode,
        seedsEvaluated: [...M15_AI_QUALITY_SEEDS],
        matchesCompleted: results.filter((result) => result.completed).length,
        decisionsEvaluated: results.reduce((sum, result) => sum + result.aiDecisions, 0),
        legalityProbes: results.reduce((sum, result) => sum + result.legalityProbes, 0),
        illegalChoices: results.reduce((sum, result) => sum + result.illegalChoices, 0),
        impossibleOrStalledStates: results.filter((result) => !result.completed).length,
        replayDivergences: results.filter((result) => result.replayDiverged).length,
        resultMethods,
        averagePlayerDecisions: decisions.reduce((sum, value) => sum + value, 0) / decisions.length,
        medianPlayerDecisions: median(decisions),
      });
    }
  }
  return {
    schema: M15_AI_QUALITY_SCHEMA,
    aiPolicyVersion: AI_POLICY_VERSION,
    generatedFrom: "deterministic-fixed-seed-corpus",
    rows,
    totals: {
      matches: rows.reduce((sum, row) => sum + row.matchesCompleted, 0),
      aiDecisions: rows.reduce((sum, row) => sum + row.decisionsEvaluated, 0),
      legalityProbes: rows.reduce((sum, row) => sum + row.legalityProbes, 0),
      illegalChoices: rows.reduce((sum, row) => sum + row.illegalChoices, 0),
      stalled: rows.reduce((sum, row) => sum + row.impossibleOrStalledStates, 0),
      replayDivergences: rows.reduce((sum, row) => sum + row.replayDivergences, 0),
    },
  };
}
