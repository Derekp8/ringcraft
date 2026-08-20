import { describe, expect, it } from "vitest";
import {
  AI_DIFFICULTIES,
  AI_DIFFICULTY_HINTS,
  AI_POLICY_VERSION,
  AI_SEARCH_CLONE_BUDGET,
  NOVICE_MISTAKE_RATE,
  advanceUntilPlayerDecision,
  beginScheduledMatch,
  careerRecordToDefinition,
  checkpointScheduledMatch,
  chooseDeterministicPolicyAction,
  choosePolicyAction,
  commitScheduledMatchResult,
  createCampaign,
  createMatch,
  declineSuggestedMatch,
  hashCampaignState,
  hashMatchState,
  importCampaignJson,
  markDiscardable,
  replayFromInputLog,
  replayScheduledCampaignMatch,
  scheduleCampaignMatch,
  serializeCampaign,
  submitPlayerIntent,
  suggestPlayerMatch,
  validateCampaignState,
  WRESTLERS,
} from "../src/core";
import type { AiDifficulty, CampaignState, Intent, MatchState } from "../src/core";
import { RUTHLESS_CAMPAIGN_DERIVATION, deriveRuthlessCampaign, makeCareerRecord } from "../scripts/m10-ruthless-campaign";
import { HEAD_TO_HEAD_BATCHES, h2hMatchSetup, makeUnderdogRecord as makeLadderRecord, playBalanceMatch, rowFromState, underdogSetup as ladderSetup } from "../scripts/m11-playtest-batch";

/**
 * The historical underdog corpus remains useful for deterministic replay and
 * balance reporting, but it is no longer a strength gate: the old strict
 * ladder was partly created by Veteran/Ruthless seeing upcoming live dice.
 * Strength is now certified head-to-head on equal rosters.
 */
const H2H_STRENGTH_SEEDS = 64;
const H2H_STRENGTH_SEED_BASE = 13_000;
const H2H_STRENGTH_LABELS = [
  "h2h-novice-standard",
  "h2h-standard-veteran",
  "h2h-veteran-ruthless",
  "h2h-standard-ruthless",
] as const;

/** Plays a ladder match headless: the player side is fixed at v1, the AI at `difficulty`. */
function playLadderMatch(seed: number, difficulty: AiDifficulty): { outcome: "ai" | "player" | "draw"; final: MatchState } {
  const s = ladderSetup(seed);
  // The cursor is owned by this loop and discarded at the end, so it is marked
  // discardable: the engine advances it in place (no defensive JSON clone per
  // player turn) and records events without a per-event full-state hash. The
  // decisions, RNG stream, input log, and final `hashMatchState` are identical
  // to the live path — `hashMatchState` excludes the event array — so the
  // replay and hash pins are unchanged. This is the separation gate's hot loop.
  let cursor = markDiscardable(createMatch({ seed: 1000 + seed, timeLimitMinutes: 6, mode: "singles", aiDifficulty: difficulty, roster: s.roster, teamMembers: s.teamMembers }));
  let guard = 0;
  while (!cursor.result && guard < 8000) {
    cursor = advanceUntilPlayerDecision(cursor);
    if (cursor.result) break;
    const decision = cursor.decision;
    if (!decision) throw new Error("stalled");
    const action = chooseDeterministicPolicyAction(cursor, decision);
    cursor = submitPlayerIntent(cursor, action.intent);
    guard += 1;
  }
  const outcome = !cursor.result ? "draw" : cursor.result.winnerTeamId === "ai" ? "ai" : cursor.result.winnerTeamId === "player" ? "player" : "draw";
  return { outcome, final: cursor };
}

/** Replicates the DecisionPanel's default filters: prepared moves only, charm-0 variants. */
function intentCharm(intent: Intent): number | null {
  if (intent.type === "attack" || intent.type === "irish-whip") return intent.attackCharm;
  if (["recover", "tag", "distract-referee", "pin-interference"].includes(intent.type)) return (intent as { charm: number }).charm;
  return null;
}

/** The first action the visual gate's "click the first visible action" loop picks. */
function firstVisibleAction(cursor: MatchState) {
  const decision = cursor.decision!;
  const raw = decision.actions;
  const hasCharmVariants = decision.kind !== "damage-charm" && raw.some((action) => (intentCharm(action.intent) ?? 0) > 0);
  for (const action of raw) {
    const actionCharm = intentCharm(action.intent);
    if (hasCharmVariants && actionCharm !== null && actionCharm !== 0) continue;
    if (action.label.includes("(untrained)")) continue;
    return action;
  }
  return raw[0];
}

function atPlayerDecision(seed: number, difficulty: AiDifficulty = "standard"): MatchState {
  const s = ladderSetup(seed);
  let cursor = createMatch({ seed: 1000 + seed, timeLimitMinutes: 6, mode: "singles", aiDifficulty: difficulty, roster: s.roster, teamMembers: s.teamMembers });
  for (let guard = 0; guard < 200; guard += 1) {
    cursor = advanceUntilPlayerDecision(cursor);
    if (cursor.decision) return cursor;
    if (cursor.result) throw new Error("match ended before a player decision");
  }
  throw new Error("no player decision reached");
}

describe("M10 AI policy table", () => {
  it("declares the four-difficulty ladder and the policy version", () => {
    expect(AI_DIFFICULTIES).toEqual(["novice", "standard", "veteran", "ruthless"]);
    expect(AI_POLICY_VERSION).toBe("asw91-ai-policy-v1");
    expect(AI_SEARCH_CLONE_BUDGET).toBeLessThanOrEqual(40);
    // The 35% deterministic mistake trigger is retained; a triggered mistake
    // now selects the lowest-scoring legal action, keeping Novice meaningfully
    // below Standard without consulting the live RNG.
    expect(NOVICE_MISTAKE_RATE).toBe(0.35);
  });

  it("hints every ladder level with behavior copy matching the policy", () => {
    expect(Object.keys(AI_DIFFICULTY_HINTS).sort()).toEqual([...AI_DIFFICULTIES].sort());
    for (const difficulty of AI_DIFFICULTIES) {
      const hint = AI_DIFFICULTY_HINTS[difficulty];
      expect(hint.length).toBeGreaterThan(20);
    }
    expect(AI_DIFFICULTY_HINTS.novice).toMatch(/suboptimal move/i);
    expect(AI_DIFFICULTY_HINTS.standard).toMatch(/zero randomness|deterministic baseline/i);
    expect(AI_DIFFICULTY_HINTS.veteran).toMatch(/1-ply/i);
    expect(AI_DIFFICULTY_HINTS.ruthless).toMatch(/2-ply/i);
  });

  it("routes default and standard difficulty through the v1 path with zero PRNG consumed", () => {
    for (const seed of [0, 7, 31, 1991]) {
      const cursor = atPlayerDecision(seed);
      const decision = cursor.decision!;
      const stateBefore = hashMatchState(cursor);
      const rngBefore = cursor.rng.state;
      const v1 = chooseDeterministicPolicyAction(cursor, decision);
      const viaDefault = choosePolicyAction(cursor, decision);
      const viaStandard = choosePolicyAction(cursor, decision, "standard");
      expect(viaDefault.key).toBe(v1.key);
      expect(viaStandard.key).toBe(v1.key);
      expect(cursor.rng.state).toBe(rngBefore);
      expect(hashMatchState(cursor)).toBe(stateBefore);
    }
  });

  it("replays a seeded match identically at every difficulty (replayFromInputLog)", () => {
    for (const difficulty of AI_DIFFICULTIES) {
      const { final } = playLadderMatch(3, difficulty);
      expect(final.result).toBeTruthy();
      const replay = replayFromInputLog(final);
      expect(hashMatchState(replay)).toBe(hashMatchState(final));
    }
  });

  it("separates the fair difficulty ladder on a fixed equal-roster head-to-head corpus", () => {
    for (const [pairIndex, label] of H2H_STRENGTH_LABELS.entries()) {
      const spec = HEAD_TO_HEAD_BATCHES.find((entry) => entry.label === label);
      if (!spec) throw new Error(`Missing head-to-head batch ${label}.`);
      let lowerWins = 0;
      let higherWins = 0;
      let draws = 0;
      for (let seed = 0; seed < H2H_STRENGTH_SEEDS; seed += 1) {
        const setup = h2hMatchSetup(spec, H2H_STRENGTH_SEED_BASE + pairIndex * 1000, seed);
        const row = rowFromState(playBalanceMatch(setup, spec.playerSide ?? "v1"), seed);
        if (row.winnerTeam === null) draws += 1;
        else if (row.winnerTeam === "player") lowerWins += 1;
        else higherWins += 1;
      }
      expect(lowerWins + higherWins + draws).toBe(H2H_STRENGTH_SEEDS);
      expect(higherWins).toBeGreaterThan(lowerWins);
    }
  }, 300_000);

  it("pins the seeded ruthless exhibition replay hash as a golden value (visual-gate contract)", () => {
    // Replicates the m10-difficulty-exhibition gate profile: seed 1991, ruthless,
    // default fixture roster, with the player clicking the first visible action.
    // The final match hash must equal the visual gate's golden replay pin, so the
    // unit suite guards the exact ruthless replay contract without the browser.
    const roster = {
      "player-a": { ...structuredClone(WRESTLERS["player-a"]), id: "player-a" as const, teamId: "player" as const, sourceRecordId: WRESTLERS["player-a"].id },
      "ai-a": { ...structuredClone(WRESTLERS["ai-a"]), id: "ai-a" as const, teamId: "ai" as const, sourceRecordId: WRESTLERS["ai-a"].id },
    };
    let cursor = createMatch({ seed: 1991, aiDifficulty: "ruthless", roster, teamMembers: { player: ["player-a"], ai: ["ai-a"] } });
    let guard = 0;
    while (!cursor.result && guard < 8000) {
      cursor = advanceUntilPlayerDecision(cursor);
      if (cursor.result) break;
      const action = firstVisibleAction(cursor);
      cursor = submitPlayerIntent(cursor, action.intent);
      guard += 1;
    }
    expect(cursor.result).toBeTruthy();
    expect(hashMatchState(replayFromInputLog(cursor))).toBe(hashMatchState(cursor));
    expect(hashMatchState(cursor)).toBe("c14n-fnv1a64-v1:03e0fea1cb9c5be1");
  }, 120_000);

  it("pins the seeded veteran exhibition replay hash as a golden value (ladder coverage)", () => {
    // Same harness as the ruthless pin: seed 1991, default fixture roster, player
    // clicking the first visible action, but with the veteran (1-ply) policy. The
    // hash differs from ruthless, so the 1-ply search path is pinned independently
    // of the browser gate.
    const roster = {
      "player-a": { ...structuredClone(WRESTLERS["player-a"]), id: "player-a" as const, teamId: "player" as const, sourceRecordId: WRESTLERS["player-a"].id },
      "ai-a": { ...structuredClone(WRESTLERS["ai-a"]), id: "ai-a" as const, teamId: "ai" as const, sourceRecordId: WRESTLERS["ai-a"].id },
    };
    let cursor = createMatch({ seed: 1991, aiDifficulty: "veteran", roster, teamMembers: { player: ["player-a"], ai: ["ai-a"] } });
    let guard = 0;
    while (!cursor.result && guard < 8000) {
      cursor = advanceUntilPlayerDecision(cursor);
      if (cursor.result) break;
      const action = firstVisibleAction(cursor);
      cursor = submitPlayerIntent(cursor, action.intent);
      guard += 1;
    }
    expect(cursor.result).toBeTruthy();
    expect(hashMatchState(replayFromInputLog(cursor))).toBe(hashMatchState(cursor));
    expect(hashMatchState(cursor)).toBe("c14n-fnv1a64-v1:d2ff1b584b113ad2");
  }, 120_000);

  it("pins the seeded standard exhibition replay hash as a golden value (ladder coverage)", () => {
    // Same harness as the ruthless pin with the default difficulty: the
    // deterministic v1 baseline. The hash differs from veteran and ruthless, so
    // the whole ladder (novice/standard/veteran/ruthless) carries a golden
    // replay identity at the same seed.
    const roster = {
      "player-a": { ...structuredClone(WRESTLERS["player-a"]), id: "player-a" as const, teamId: "player" as const, sourceRecordId: WRESTLERS["player-a"].id },
      "ai-a": { ...structuredClone(WRESTLERS["ai-a"]), id: "ai-a" as const, teamId: "ai" as const, sourceRecordId: WRESTLERS["ai-a"].id },
    };
    let cursor = createMatch({ seed: 1991, aiDifficulty: "standard", roster, teamMembers: { player: ["player-a"], ai: ["ai-a"] } });
    let guard = 0;
    while (!cursor.result && guard < 8000) {
      cursor = advanceUntilPlayerDecision(cursor);
      if (cursor.result) break;
      const action = firstVisibleAction(cursor);
      cursor = submitPlayerIntent(cursor, action.intent);
      guard += 1;
    }
    expect(cursor.result).toBeTruthy();
    expect(hashMatchState(replayFromInputLog(cursor))).toBe(hashMatchState(cursor));
    expect(hashMatchState(cursor)).toBe("c14n-fnv1a64-v1:5635330ed338d5ab");
  }, 120_000);

  it("pins the seeded novice exhibition replay hash as a golden value (ladder coverage)", () => {
    // Same harness as the ruthless pin with the novice (hash-derived mistake)
    // policy: the weak end of the ladder is pinned independently of the browser
    // gate, so all four ladder levels carry a golden replay identity.
    const roster = {
      "player-a": { ...structuredClone(WRESTLERS["player-a"]), id: "player-a" as const, teamId: "player" as const, sourceRecordId: WRESTLERS["player-a"].id },
      "ai-a": { ...structuredClone(WRESTLERS["ai-a"]), id: "ai-a" as const, teamId: "ai" as const, sourceRecordId: WRESTLERS["ai-a"].id },
    };
    let cursor = createMatch({ seed: 1991, aiDifficulty: "novice", roster, teamMembers: { player: ["player-a"], ai: ["ai-a"] } });
    let guard = 0;
    while (!cursor.result && guard < 8000) {
      cursor = advanceUntilPlayerDecision(cursor);
      if (cursor.result) break;
      const action = firstVisibleAction(cursor);
      cursor = submitPlayerIntent(cursor, action.intent);
      guard += 1;
    }
    expect(cursor.result).toBeTruthy();
    expect(hashMatchState(replayFromInputLog(cursor))).toBe(hashMatchState(cursor));
    expect(hashMatchState(cursor)).toBe("c14n-fnv1a64-v1:3920db1a93c324f1");
  }, 120_000);

  it("pins the full ladder: all four difficulties produce distinct golden replay hashes at seed 1991", () => {
    const roster = {
      "player-a": { ...structuredClone(WRESTLERS["player-a"]), id: "player-a" as const, teamId: "player" as const, sourceRecordId: WRESTLERS["player-a"].id },
      "ai-a": { ...structuredClone(WRESTLERS["ai-a"]), id: "ai-a" as const, teamId: "ai" as const, sourceRecordId: WRESTLERS["ai-a"].id },
    };
    const hashes = new Map<AiDifficulty, string>();
    for (const difficulty of ["novice", "standard", "veteran", "ruthless"] as const) {
      let cursor = createMatch({ seed: 1991, aiDifficulty: difficulty, roster, teamMembers: { player: ["player-a"], ai: ["ai-a"] } });
      let guard = 0;
      while (!cursor.result && guard < 8000) {
        cursor = advanceUntilPlayerDecision(cursor);
        if (cursor.result) break;
        const action = firstVisibleAction(cursor);
        cursor = submitPlayerIntent(cursor, action.intent);
        guard += 1;
      }
      expect(cursor.result).toBeTruthy();
      hashes.set(difficulty, hashMatchState(cursor));
    }
    expect(new Set(hashes.values()).size).toBe(4);
    expect(hashes.get("novice")).toBe("c14n-fnv1a64-v1:3920db1a93c324f1");
    expect(hashes.get("standard")).toBe("c14n-fnv1a64-v1:5635330ed338d5ab");
    expect(hashes.get("veteran")).toBe("c14n-fnv1a64-v1:d2ff1b584b113ad2");
    expect(hashes.get("ruthless")).toBe("c14n-fnv1a64-v1:03e0fea1cb9c5be1");
  }, 240_000);

  it("pins the seeded tag-team exhibition replay hash as a golden value (visual-gate contract)", () => {
    // Replicates the tag-desktop gate profile: mode tag, seed 1991, standard
    // difficulty, all four fixture wrestlers (each stamped with sourceRecordId
    // by assignChoice), player clicking the first visible action. The final hash
    // must equal the visual gate's golden tag replay pin.
    const roster = {
      "player-a": { ...structuredClone(WRESTLERS["player-a"]), id: "player-a" as const, teamId: "player" as const, sourceRecordId: WRESTLERS["player-a"].id },
      "player-b": { ...structuredClone(WRESTLERS["player-b"]), id: "player-b" as const, teamId: "player" as const, sourceRecordId: WRESTLERS["player-b"].id },
      "ai-a": { ...structuredClone(WRESTLERS["ai-a"]), id: "ai-a" as const, teamId: "ai" as const, sourceRecordId: WRESTLERS["ai-a"].id },
      "ai-b": { ...structuredClone(WRESTLERS["ai-b"]), id: "ai-b" as const, teamId: "ai" as const, sourceRecordId: WRESTLERS["ai-b"].id },
    };
    let cursor = createMatch({ seed: 1991, mode: "tag", aiDifficulty: "standard", roster, teamMembers: { player: ["player-a", "player-b"], ai: ["ai-a", "ai-b"] } });
    let guard = 0;
    while (!cursor.result && guard < 8000) {
      cursor = advanceUntilPlayerDecision(cursor);
      if (cursor.result) break;
      const action = firstVisibleAction(cursor);
      cursor = submitPlayerIntent(cursor, action.intent);
      guard += 1;
    }
    expect(cursor.result).toBeTruthy();
    expect(hashMatchState(replayFromInputLog(cursor))).toBe(hashMatchState(cursor));
    expect(hashMatchState(cursor)).toBe("c14n-fnv1a64-v1:1b26c32a342f08c8");
  }, 120_000);

  it("never lets search clones mutate the live match state or dice stream", () => {
    for (const difficulty of ["veteran", "ruthless"] as const) {
      const cursor = atPlayerDecision(0, difficulty);
      const decision = cursor.decision!;
      const stateBefore = hashMatchState(cursor);
      const rngBefore = cursor.rng.state;
      const pick = choosePolicyAction(cursor, decision, difficulty);
      expect(pick).toBeTruthy();
      expect(cursor.rng.state).toBe(rngBefore);
      expect(hashMatchState(cursor)).toBe(stateBefore);
    }
  });
});

/** Plays a ruthless career's offered match headless and commits the official result. */
function playRuthlessCareer(seed: number): CampaignState {
  return deriveRuthlessCampaign({ ...RUTHLESS_CAMPAIGN_DERIVATION, campaignSeed: seed }).committed;
}

describe("M10 campaign difficulty integration", () => {
  it("pins the campaign difficulty on scheduled matches and the match configuration", () => {
    const roster = Array.from({ length: 6 }, (_, index) => makeCareerRecord(4000, index));
    const campaign = createCampaign({ name: "Ruthless Career", seed: 1991, startDate: "1991-01-01", roster, playerEntrantId: roster[4].id, playerDivision: "singles", aiDifficulty: "ruthless" });
    expect(campaign.aiDifficulty).toBe("ruthless");
    const suggestion = suggestPlayerMatch(campaign);
    const scheduled = scheduleCampaignMatch(campaign, suggestion);
    const due = scheduled.schedule.find((row) => row.status === "scheduled")!;
    expect(due.aiDifficulty).toBe("ruthless");
    const playing = beginScheduledMatch(scheduled, due.id);
    expect(playing.activeMatch?.config.aiDifficulty).toBe("ruthless");
  });

  it("round-trips a ruthless campaign through export/import with a stable hash and verifying replay", () => {
    const roster = Array.from({ length: 6 }, (_, index) => makeCareerRecord(4100, index));
    let campaign = createCampaign({ name: "Ruthless Career", seed: 2001, startDate: "1991-01-01", roster, playerEntrantId: roster[4].id, playerDivision: "singles", aiDifficulty: "ruthless" });
    const suggestion = suggestPlayerMatch(campaign);
    campaign = scheduleCampaignMatch(campaign, suggestion);
    const due = campaign.schedule.find((row) => row.status === "scheduled")!;
    campaign = beginScheduledMatch(campaign, due.id);
    let match = campaign.activeMatch!;
    let guard = 0;
    while (!match.result && guard < 8000) {
      match = advanceUntilPlayerDecision(match);
      if (match.result) break;
      if (!match.decision) throw new Error("stalled");
      const action = chooseDeterministicPolicyAction(match, match.decision);
      match = submitPlayerIntent(match, action.intent);
      guard += 1;
    }
    expect(match.result).toBeTruthy();
    campaign = checkpointScheduledMatch(campaign, match);
    campaign = commitScheduledMatchResult(campaign);

    // Replay verification: the committed match re-derives the AI's ruthless moves
    // and the stored replay hash (this throws on any divergence).
    const scheduledRow = campaign.schedule.find((row) => row.id === due.id)!;
    const replayed = replayScheduledCampaignMatch(campaign, due.id);
    expect(hashMatchState(replayed)).toBe(scheduledRow.result!.finalMatchHash);

    // Export/import round trip preserves the difficulty and the canonical hash.
    const json = serializeCampaign(campaign, false);
    const imported = importCampaignJson(json).state;
    expect(imported.aiDifficulty).toBe("ruthless");
    expect(hashCampaignState(imported)).toBe(hashCampaignState(campaign));
    expect(validateCampaignState(imported)).toEqual([]);
  }, 120_000);

  it("pins the final campaign hash after the committed ruthless match (campaign-level replay contract)", () => {
    // First derivation: the committed campaign's canonical hash, which the
    // commit event already records as its post-state hash.
    const first = playRuthlessCareer(2003);
    const pinned = hashCampaignState(first);
    const commitEvent = first.events.find((row) => row.type === "commit-match-result")!;
    expect(pinned).toBe(commitEvent.postStateHash);
    expect(pinned).toBe("c14n-fnv1a64-v1:8eef4a9e466cf392");

    // Campaign-level replay: a from-scratch re-derivation with the same seed
    // reproduces the identical final campaign hash (mirrors the corpus
    // finalStateHash contract), and the committed match still replays from its
    // stored replay data.
    const replayed = playRuthlessCareer(2003);
    expect(hashCampaignState(replayed)).toBe(pinned);
    const due = first.schedule.find((row) => row.status === "completed")!;
    expect(hashMatchState(replayScheduledCampaignMatch(first, due.id))).toBe(due.result!.finalMatchHash);
  }, 120_000);

  it("pins the campaign hash after advancing a full month with the ruthless match committed (month-end replay contract)", () => {
    const playMonthEnd = (seed: number): CampaignState => deriveRuthlessCampaign({ ...RUTHLESS_CAMPAIGN_DERIVATION, campaignSeed: seed }).final;

    // First derivation: the committed match is folded into the January rating
    // table, month-end finalization re-rolls February obligations, and the
    // resulting campaign hash is recorded by the advance event as its
    // post-state hash.
    const first = playMonthEnd(2003);
    expect(first.currentDate).toBe("1991-02-01");
    // The finalization that folds the committed match into the January rating
    // table runs on the last day of January, so the committed table is 1991-01.
    expect(first.rankings.singles.month).toBe("1991-01");
    const pinned = hashCampaignState(first);
    const advanceEvent = first.events.at(-1)!;
    expect(advanceEvent.type).toBe("advance-calendar");
    expect(pinned).toBe(advanceEvent.postStateHash);
    expect(pinned).toBe("c14n-fnv1a64-v1:57d08699c66d7f5a");

    // Month-end replay: a from-scratch re-derivation with the same seed
    // reproduces the identical hash, and the committed match still replays.
    const replayed = playMonthEnd(2003);
    expect(hashCampaignState(replayed)).toBe(pinned);
    const due = first.schedule.find((row) => row.status === "completed")!;
    expect(hashMatchState(replayScheduledCampaignMatch(first, due.id))).toBe(due.result!.finalMatchHash);
  }, 120_000);

  it("rejects unknown difficulty values through the match setup path and campaign validator", () => {
    const s = ladderSetup(0);
    expect(() => createMatch({ seed: 5, mode: "singles", aiDifficulty: "legendary" as AiDifficulty, roster: s.roster, teamMembers: s.teamMembers })).toThrow(/unsupported ai difficulty/i);
    const roster = Array.from({ length: 4 }, (_, index) => makeCareerRecord(4200, index));
    expect(() => createCampaign({ name: "Bad", seed: 1, startDate: "1991-01-01", roster, playerEntrantId: roster[0].id, playerDivision: "singles", aiDifficulty: "impossible" as AiDifficulty })).toThrow(/aiDifficulty: unsupported impossible/);
  });
});
