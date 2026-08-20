import { describe, expect, it } from "vitest";
import {
  AI_DIFFICULTIES,
  advanceCampaignDays,
  advanceUntilPlayerDecision,
  chooseDeterministicPolicyAction,
  choosePolicyAction,
  createCampaign,
  createMatch,
  createRandomCampaign,
  createRandomMatch,
  createRng,
  generateRandomSeed,
  hashCampaignState,
  hashMatchState,
  importCampaignJson,
  replayFromInputLog,
  serializeCampaign,
  submitPlayerIntent,
  suggestPlayerMatch,
} from "../src/core";
import type { AiDifficulty, MatchState } from "../src/core";
import { makeCareerRecord } from "../scripts/m10-ruthless-campaign";
import { underdogSetup } from "../scripts/m11-playtest-batch";

function fixedSource(value: number) {
  return (buffer: Uint32Array): Uint32Array => {
    buffer[0] = value >>> 0;
    return buffer;
  };
}

function playerDecision(seed = 9, difficulty: AiDifficulty = "standard"): MatchState {
  const setup = underdogSetup(seed);
  let cursor = createMatch({ seed: 1_000 + seed, mode: "singles", timeLimitMinutes: 6, aiDifficulty: difficulty, roster: setup.roster, teamMembers: setup.teamMembers });
  for (let guard = 0; guard < 500; guard += 1) {
    cursor = advanceUntilPlayerDecision(cursor);
    if (cursor.decision) return cursor;
    if (cursor.result) throw new Error("Match ended before a player decision.");
  }
  throw new Error("No player decision reached.");
}

describe("randomized normal play", () => {
  it("maps secure entropy to nonzero deterministic seeds", () => {
    expect(generateRandomSeed(fixedSource(0))).toBe(1);
    expect(generateRandomSeed(fixedSource(101))).toBe(101);
    expect(generateRandomSeed(fixedSource(0xffff_ffff))).toBe(0xffff_ffff);
  });

  it("creates randomized matches while preserving manual-seed deterministic replay", () => {
    const one = createRandomMatch({ mode: "singles" }, fixedSource(101));
    const two = createRandomMatch({ mode: "singles" }, fixedSource(202));
    expect(one.config.seed).toBe(101);
    expect(two.config.seed).toBe(202);
    expect(one.rng).toEqual(createRng(101));
    expect(two.rng).toEqual(createRng(202));

    let manual = createMatch({ seed: 1991, mode: "singles", aiDifficulty: "standard" });
    for (let guard = 0; !manual.result && guard < 8_000; guard += 1) {
      manual = advanceUntilPlayerDecision(manual);
      if (manual.result) break;
      if (!manual.decision) throw new Error("Manual match stalled.");
      manual = submitPlayerIntent(manual, chooseDeterministicPolicyAction(manual, manual.decision).intent);
    }
    expect(manual.result).toBeTruthy();
    expect(hashMatchState(replayFromInputLog(manual))).toBe(hashMatchState(manual));
  });

  it("a new-dice rematch requests a fresh seed while same-seed replay retains it", () => {
    const original = createRandomMatch({ mode: "singles", aiDifficulty: "standard" }, fixedSource(555));
    const rematch = createRandomMatch(original.config, fixedSource(777));
    const sameSeed = createMatch(original.config);
    expect(original.config.seed).toBe(555);
    expect(rematch.config.seed).toBe(777);
    expect(sameSeed.config.seed).toBe(555);
    expect(rematch.config.mode).toBe(original.config.mode);
    expect(rematch.config.aiDifficulty).toBe(original.config.aiDifficulty);
  });

  it("creates a random Career and preserves its seed/RNG through export/import", () => {
    const roster = Array.from({ length: 6 }, (_, index) => makeCareerRecord(5_100, index));
    const config = { name: "Random Career", startDate: "1991-01-01", roster, playerEntrantId: roster[4].id, playerDivision: "singles" as const, aiDifficulty: "standard" as const };
    const campaign = createRandomCampaign(config, fixedSource(303));
    expect(campaign.seed).toBe(303);
    expect(campaign.rng).toEqual(createRng(303));

    const imported = importCampaignJson(serializeCampaign(campaign, false)).state;
    expect(imported.seed).toBe(campaign.seed);
    expect(imported.rng).toEqual(campaign.rng);
    expect(hashCampaignState(imported)).toBe(hashCampaignState(campaign));
    expect(suggestPlayerMatch(imported)).toEqual(suggestPlayerMatch(campaign));
    expect(hashCampaignState(advanceCampaignDays(imported, 1))).toBe(hashCampaignState(advanceCampaignDays(campaign, 1)));

    const deterministic = createCampaign({ ...config, seed: 303 });
    expect(hashCampaignState(deterministic)).toBe(hashCampaignState(campaign));
  });
});

describe("fair AI live-RNG isolation", () => {
  it("does not change a decision when only the hidden live RNG future changes", () => {
    for (const difficulty of AI_DIFFICULTIES) {
      const original = playerDecision(17, difficulty);
      const altered = structuredClone(original);
      altered.rng = createRng(0xdead_beef);
      const originalRng = structuredClone(original.rng);
      const alteredRng = structuredClone(altered.rng);
      const originalHash = hashMatchState(original);
      const alteredHash = hashMatchState(altered);

      const a = choosePolicyAction(original, original.decision!, difficulty);
      const b = choosePolicyAction(altered, altered.decision!, difficulty);
      expect(b.key).toBe(a.key);
      expect(original.rng).toEqual(originalRng);
      expect(altered.rng).toEqual(alteredRng);
      expect(hashMatchState(original)).toBe(originalHash);
      expect(hashMatchState(altered)).toBe(alteredHash);
    }
  });
});

describe("bonus-attack empty-action regression", () => {
  it("never opens a mandatory zero-action decision on the historical repro seed", () => {
    const setup = underdogSetup(100_002);
    let cursor = createMatch({ seed: 100_002, mode: "singles", timeLimitMinutes: 6, aiDifficulty: "novice", roster: setup.roster, teamMembers: setup.teamMembers });
    let guard = 0;
    while (!cursor.result && guard < 8_000) {
      cursor = advanceUntilPlayerDecision(cursor);
      if (cursor.result) break;
      expect(cursor.decision).toBeTruthy();
      expect(cursor.decision!.actions.length).toBeGreaterThan(0);
      cursor = submitPlayerIntent(cursor, chooseDeterministicPolicyAction(cursor, cursor.decision!).intent);
      guard += 1;
    }
    expect(cursor.result).toBeTruthy();
  });
});


describe("final stress-regression seeds", () => {
  it.each([
    { seed: 50_025, mode: "singles" as const },
    { seed: 50_061, mode: "tag" as const },
  ])("completes Novice $mode seed $seed without an impossible follow-up", ({ seed, mode }) => {
    let cursor = createMatch({ seed, mode, timeLimitMinutes: 8, aiDifficulty: "novice" });
    let guard = 0;
    while (!cursor.result && guard < 8_000) {
      cursor = advanceUntilPlayerDecision(cursor);
      if (cursor.result) break;
      expect(cursor.decision).toBeTruthy();
      expect(cursor.decision!.actions.length).toBeGreaterThan(0);
      cursor = submitPlayerIntent(cursor, chooseDeterministicPolicyAction(cursor, cursor.decision!).intent);
      guard += 1;
    }
    expect(cursor.result).toBeTruthy();
  });
});
