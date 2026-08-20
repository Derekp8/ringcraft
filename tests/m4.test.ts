import { describe, expect, it } from "vitest";
import {
  AGE_CAPS,
  ATTRIBUTE_LOOKUPS,
  ATTRIBUTE_ADVANCEMENT_COSTS,
  BASE_CREATION_SKILL_POINTS,
  BODY_TABLE,
  DEBUT_RESULT_BANDS,
  FEDERATION_BANDS,
  HEIGHT_WEIGHT_BANDS,
  MANEUVERS,
  RULESET_VERSION,
  SPECIAL_SKILLS,
  activePhases,
  addCreationCustomManeuver,
  addPreviousExperience,
  applyProgression,
  autoAllocateCreationPoints,
  baseAv,
  baseDv,
  body,
  buildCustomManeuver,
  calculateMatchWp,
  careerRecordToDefinition,
  createCreationSession,
  createMatch,
  createProgressionState,
  creationDerivedPreview,
  creationPointSummary,
  drawbackAward,
  finalizeCreationSession,
  hashMatchState,
  importReferenceRosterJson,
  importWrestlerJson,
  recoveryModifier,
  replayCreationSession,
  replayFromInputLog,
  replayProgression,
  rollCreationHistory,
  rollCreationStature,
  serializeWrestler,
  setCreationDrawback,
  setCreationStature,
  specialSkillCap,
  startingDamage,
  validateCreationSession,
  validateManeuverDraft,
  validateWrestlerRecord,
  WRESTLERS,
} from "../src/core";
import type {
  CreationSession,
  DrawbackDefinition,
  ManeuverDraft,
  WrestlerCareerRecord,
} from "../src/core";

function scripted(session: CreationSession, rolls: number[]): CreationSession {
  const next = structuredClone(session);
  next.rng.scriptedRolls = rolls;
  next.rng.scriptedIndex = 0;
  return next;
}

function legalSession(seed = 1991, drawback?: DrawbackDefinition): CreationSession {
  let session = createCreationSession(seed);
  session = rollCreationStature(session);
  session = rollCreationHistory(session);
  if (drawback) session = setCreationDrawback(session, drawback);
  session = autoAllocateCreationPoints(session);
  expect(validateCreationSession(session)).toEqual([]);
  return session;
}

function legalRecord(seed = 1991, drawback?: DrawbackDefinition): WrestlerCareerRecord {
  return finalizeCreationSession(legalSession(seed, drawback)).finalized!;
}

describe("M4 source tables and deterministic creation", () => {
  it("generates an immutable 10D10+200 physical pool deterministically", () => {
    const first = createCreationSession(41991);
    const second = createCreationSession(41991);
    expect(first).toEqual(second);
    expect(first.physicalPointTotal).toBeGreaterThanOrEqual(210);
    expect(first.physicalPointTotal).toBeLessThanOrEqual(300);
    expect(Object.values(first.attributes).reduce((sum, value) => sum + value, 0)).toBe(first.physicalPointTotal);
    expect(first.events[0].dice).toHaveLength(10);
    expect(first.events[0].detail[0]).toContain("10D10 + 200");
  });

  it("hits the exact minimum and maximum physical-pool totals", () => {
    expect(createCreationSession(1, Array(10).fill(1)).physicalPointTotal).toBe(210);
    expect(createCreationSession(1, Array(10).fill(10)).physicalPointTotal).toBe(300);
  });

  it("locks every AV/DV lookup band and both ends of each band", () => {
    expect(ATTRIBUTE_LOOKUPS).toEqual({
      powAv: [0, 1, 1, 2, 2, 3, 3, 4, 4, 5], powDv: [0, 0, 0, 0, 0, 0, 0, 1, 1, 2],
      agiAv: [0, 0, 0, 1, 1, 2, 2, 3, 3, 4], agiDv: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4],
      quiAv: [0, 0, 0, 0, 1, 1, 2, 2, 3, 3], quiDv: [0, 1, 1, 2, 2, 3, 4, 5, 6, 7],
      tecAv: [0, 1, 1, 2, 2, 3, 4, 5, 6, 7], tecDv: [0, 0, 0, 0, 1, 1, 2, 2, 3, 3],
    });
    for (let band = 0; band < 10; band += 1) {
      const low = band * 10 + 1;
      const high = (band + 1) * 10;
      const lowAttributes = { pow: low, agi: low, qui: low, tec: low, end: 1 };
      const highAttributes = { ...lowAttributes, pow: high, agi: high, qui: high, tec: high };
      expect(baseAv(lowAttributes), `AV band ${band}`).toBe(baseAv(highAttributes));
      expect(baseDv(lowAttributes), `DV band ${band}`).toBe(baseDv(highAttributes));
    }
  });

  it("covers every BODY cell, eligibility edge, DAM PTS rounding, REC edge, and zero-phase AGI", () => {
    expect(BODY_TABLE).toEqual([[1, 1, 2, 2], [1, 2, 3, 3], [2, 3, 3, 4], [2, 3, 4, 5], [3, 4, 4, 5], [4, 5, 5, 6]]);
    const powers = [1, 20, 40, 60, 80, 100];
    const weights = [200, 201, 301, 401];
    for (const [powIndex, pow] of powers.entries()) for (const [weightIndex, weight] of weights.entries()) {
      const definition = { ...structuredClone(WRESTLERS["player-a"]), weight, attributes: { ...WRESTLERS["player-a"].attributes, pow } };
      expect(body(definition), `POW ${pow}, weight ${weight}`).toBe(BODY_TABLE[powIndex][weightIndex]);
    }
    const odd = { ...structuredClone(WRESTLERS["player-a"]), attributes: { ...WRESTLERS["player-a"].attributes, pow: 1, end: 2 } };
    expect(startingDamage(odd)).toBe(2);
    expect(recoveryModifier({ ...odd, attributes: { ...odd.attributes, end: 41 } })).toBe(5);
    expect(activePhases({ ...odd, attributes: { ...odd.attributes, agi: 9 } })).toEqual([]);
    let session = setCreationStature(createCreationSession(44), 70, 235);
    expect(creationDerivedPreview(session).lightHeavyweightEligible).toBe(true);
    session = setCreationStature(session, 70, 236);
    expect(creationDerivedPreview(session).lightHeavyweightEligible).toBe(false);
  });

  it("locks all ten height/weight percentile bands and their endpoints", () => {
    expect(HEIGHT_WEIGHT_BANDS).toEqual([
      { min: 1, max: 5, baseHeightInches: 64, weightBase: 190, weightDice: 3, weightSides: 6 },
      { min: 6, max: 15, baseHeightInches: 66, weightBase: 200, weightDice: 3, weightSides: 6 },
      { min: 16, max: 30, baseHeightInches: 68, weightBase: 210, weightDice: 4, weightSides: 6 },
      { min: 31, max: 50, baseHeightInches: 70, weightBase: 225, weightDice: 4, weightSides: 6 },
      { min: 51, max: 70, baseHeightInches: 72, weightBase: 235, weightDice: 5, weightSides: 6 },
      { min: 71, max: 80, baseHeightInches: 74, weightBase: 250, weightDice: 6, weightSides: 6 },
      { min: 81, max: 90, baseHeightInches: 76, weightBase: 265, weightDice: 6, weightSides: 10 },
      { min: 91, max: 95, baseHeightInches: 78, weightBase: 280, weightDice: 8, weightSides: 10 },
      { min: 96, max: 99, baseHeightInches: 80, weightBase: 320, weightDice: 10, weightSides: 10 },
      { min: 100, max: 100, baseHeightInches: 82, weightBase: 375, weightDice: 12, weightSides: 10 },
    ]);
    const low = rollCreationStature(scripted(createCreationSession(1), [1, 1, 1, 1, 1]));
    expect([low.heightInches, low.weight]).toEqual([65, 193]);
    const high = rollCreationStature(scripted(createCreationSession(1), [100, 6, ...Array(12).fill(10)]));
    expect([high.heightInches, high.weight]).toEqual([88, 495]);
  });

  it("resolves debut age/result boundary arithmetic with explicit dice evidence", () => {
    let young = scripted(createCreationSession(10), [1, 6, 1]);
    young = rollCreationHistory(young);
    expect(young.history?.debutAge).toBe(16);
    expect(young.history?.debutTotal).toBe(1 + baseAv(young.attributes));
    expect(young.history?.debutResult).toBe("loss-pin-submission");
    let veteran = scripted(createCreationSession(10), [100, 6, 100]);
    veteran = rollCreationHistory(veteran);
    expect(veteran.history?.debutAge).toBe(28);
    expect(veteran.history?.debutResult).toBe("win-pin-submission");
  });

  it("locks contiguous debut and federation chart boundaries", () => {
    expect(DEBUT_RESULT_BANDS.map((row) => [row.min, row.max, row.result])).toEqual([
      [Number.NEGATIVE_INFINITY, 50, "loss-pin-submission"], [51, 70, "loss-dq"], [71, 90, "double-dq"], [91, 99, "win-dq"], [100, Number.POSITIVE_INFINITY, "win-pin-submission"],
    ]);
    expect(FEDERATION_BANDS[0]).toMatchObject({ min: 1, max: 60, id: null });
    expect(FEDERATION_BANDS.at(-1)).toMatchObject({ min: 99, max: 100, id: "aww" });
    for (let index = 1; index < FEDERATION_BANDS.length; index += 1) expect(FEDERATION_BANDS[index].min).toBe(FEDERATION_BANDS[index - 1].max + 1);
  });

  it("adds exactly two years per experience roll and rerolls an ineligible light-heavyweight title", () => {
    let session = createCreationSession(12);
    session = setCreationStature(session, 74, 300);
    session = rollCreationHistory(session);
    const debutAge = session.history!.debutAge;
    session = addPreviousExperience(scripted(session, [96, 30, 80]));
    expect(session.history?.currentAge).toBe(debutAge + 2);
    expect(session.history?.previousExperience[0].rerolls).toEqual([80]);
    expect(session.history?.priorTitles[0].lightHeavyweight).toBe(false);
  });

  it("computes every drawback family from the source matrices", () => {
    expect(drawbackAward({ type: "egotist", damageThreshold: 15, rollThreshold: 9 }, 20)).toBe(15);
    expect(drawbackAward({ type: "egotist", damageThreshold: 25, rollThreshold: 15 }, 100)).toBe(25);
    expect(drawbackAward({ type: "glass-jaw", damageThreshold: 20, rollThreshold: 15 }, 50)).toBe(35);
    expect(drawbackAward({ type: "old-injury", damageThreshold: 30, rollThreshold: 9 }, 50)).toBe(15);
    expect(drawbackAward({ type: "stupid-moves", intervalMinutes: 1, rollThreshold: 12 }, 50)).toBe(30);
  });

  it("exhaustively reconciles all drawback parameter combinations and rejects duplicates", () => {
    const rolls = [9, 12, 15] as const;
    const rollAdjust = [-5, 0, 5];
    const egotistBases = { 15: [20, 25, 25, 30, 35], 20: [15, 15, 20, 25, 25], 25: [10, 10, 15, 20, 20] } as const;
    for (const threshold of [15, 20, 25] as const) for (const [powBand, pow] of [20, 40, 60, 80, 100].entries()) for (const [rollIndex, roll] of rolls.entries()) {
      expect(drawbackAward({ type: "egotist", damageThreshold: threshold, rollThreshold: roll }, pow)).toBe(egotistBases[threshold][powBand] + rollAdjust[rollIndex]);
    }
    const damageBases = { 20: 25, 25: 20, 30: 15 } as const;
    for (const type of ["glass-jaw", "old-injury"] as const) for (const threshold of [20, 25, 30] as const) for (const [rollIndex, roll] of rolls.entries()) {
      expect(drawbackAward({ type, damageThreshold: threshold, rollThreshold: roll }, 50)).toBe(damageBases[threshold] + [0, 5, 10][rollIndex]);
    }
    const intervalBases = { 1: 25, 2: 20, 5: 10 } as const;
    for (const interval of [1, 2, 5] as const) for (const [rollIndex, roll] of rolls.entries()) {
      expect(drawbackAward({ type: "stupid-moves", intervalMinutes: interval, rollThreshold: roll }, 50)).toBe(intervalBases[interval] + [0, 5, 10][rollIndex]);
    }
    const duplicate = legalSession(54, { type: "glass-jaw", damageThreshold: 25, rollThreshold: 12 });
    duplicate.drawbacks.push(structuredClone(duplicate.drawbacks[0]));
    expect(validateCreationSession(duplicate)).toContain("drawbacks: each type may be selected only once.");
  });

  it("accounts for prior-title Fame as creation-only points", () => {
    let session = createCreationSession(56);
    session = setCreationStature(session, 74, 300);
    session = rollCreationHistory(session);
    session = addPreviousExperience(scripted(session, [99, 100]));
    const points = creationPointSummary(session);
    expect(session.history?.priorTitles[0].category).toBe("world-heavyweight");
    expect(session.history?.priorTitles[0].fame).toBe(4);
    expect(points).toMatchObject({ priorTitlePoints: 40, available: 190 });
  });

  it("builds a legal exact-spend package and refuses finalization with a remainder", () => {
    let session = createCreationSession(77);
    session = rollCreationStature(session);
    session = rollCreationHistory(session);
    expect(() => finalizeCreationSession(session)).toThrow(/remain unspent/);
    session = autoAllocateCreationPoints(session);
    expect(creationPointSummary(session)).toMatchObject({ available: BASE_CREATION_SKILL_POINTS, spent: BASE_CREATION_SKILL_POINTS, remaining: 0 });
    expect(validateCreationSession(session)).toEqual([]);
  });

  it("produces legal finalized records across a deterministic seed property sweep", () => {
    for (let seed = 1; seed <= 48; seed += 1) {
      const record = legalRecord(seed);
      expect(record.rulesetVersion).toBe(RULESET_VERSION);
      expect(validateWrestlerRecord(record), `seed ${seed}`).toEqual([]);
      if (seed % 8 === 0) {
        expect(importWrestlerJson(serializeWrestler(record))).toEqual(record);
        const state = createMatch({ seed, roster: { "player-a": careerRecordToDefinition(record, "player-a", "player"), "ai-a": structuredClone(WRESTLERS["ai-a"]) }, teamMembers: { player: ["player-a"], ai: ["ai-a"] } });
        expect(hashMatchState(replayFromInputLog(state))).toBe(hashMatchState(state));
      }
    }
  });

  it("replays the complete creation transaction log to identical state", () => {
    let session = createCreationSession(58);
    session = rollCreationStature(session);
    session = rollCreationHistory(session);
    session = setCreationDrawback(session, { type: "stupid-moves", intervalMinutes: 2, rollThreshold: 12 });
    session = autoAllocateCreationPoints(session);
    session = finalizeCreationSession(session);
    expect(replayCreationSession(session)).toEqual(session);
  });
});

describe("M4 custom maneuver builder and purchase caps", () => {
  const draft: ManeuverDraft = {
    id: "technical-clinch",
    name: "Technical Clinch",
    kind: "hold",
    minAttribute: 20,
    damageDice: 1,
    damageFlat: 0,
    endCost: 2,
    usesDamageBonus: false,
    breakRating: 2,
    submission: false,
    illegal: false,
  };

  it("reconciles a valid custom maneuver's construction equation", () => {
    expect(validateManeuverDraft(draft)).toEqual([]);
    expect(buildCustomManeuver(draft)).toMatchObject({ id: "custom-technical-clinch", listedCost: 6, custom: true });
  });

  it("enforces submission, finisher, illegal, and END constraints", () => {
    expect(validateManeuverDraft({ ...draft, breakRating: 5, submission: false })).toContain("A legal Hold with BRK 5-8 must be a Submission Hold; BRK 1-4 must not be.");
    expect(validateManeuverDraft({ ...draft, kind: "strike", breakRating: undefined, damageDice: 5, finisher: false })).toContain("A Strike dealing 5D6 or more must be a finisher; lower damage must not be.");
    expect(validateManeuverDraft({ ...draft, illegal: true, minAttribute: 20 })).toContain("Illegal Holds have no minimum TEC.");
    expect(validateManeuverDraft({ ...draft, endCost: 9 })).toContain("Hold END must be 1-8.");
  });

  it("persists a custom move through finalization and JSON round trip", () => {
    let session = createCreationSession(333);
    session = rollCreationStature(session);
    session = rollCreationHistory(session);
    session = addCreationCustomManeuver(session, buildCustomManeuver(draft));
    session = autoAllocateCreationPoints(session);
    const record = finalizeCreationSession(session).finalized!;
    const imported = importWrestlerJson(serializeWrestler(record));
    expect(imported).toEqual(record);
    expect(imported.customManeuvers["custom-technical-clinch"].listedCost).toBe(6);
  });

  it("uses TEC/Fame caps, including the distinct Charm cap", () => {
    expect(specialSkillCap("dodge", 59, 99)).toBe(5);
    expect(specialSkillCap("dodge", 100, 0)).toBe(10);
    expect(specialSkillCap("charm", 100, 7)).toBe(3);
    expect(Object.values(SPECIAL_SKILLS).map((skill) => skill.cost)).toEqual([10, 10, 5, 10, 15, 15, 15, 10, 15]);
  });

  it("enforces side locks and the changing distinct-maneuver breadth cap", () => {
    const session = legalSession(350);
    const sideLocked = structuredClone(session);
    sideLocked.maneuverLevels = { choke: 1 };
    expect(validateCreationSession(sideLocked).some((error) => error.includes("only a Rulebreaker"))).toBe(true);
    const breadth = structuredClone(session);
    breadth.maneuverLevels = { punch: 2 };
    expect(validateCreationSession(breadth).some((error) => error.includes("breadth cap 1"))).toBe(true);
    breadth.maneuverLevels["arm-bar"] = 1;
    expect(validateCreationSession(breadth).some((error) => error.includes("breadth cap"))).toBe(false);
    delete breadth.maneuverLevels["arm-bar"];
    expect(validateCreationSession(breadth).some((error) => error.includes("breadth cap 1"))).toBe(true);
  });
});

describe("M4 versioned records and dynamic roster integration", () => {
  it("rejects malformed and incompatible wrestler imports", () => {
    const record = legalRecord(400);
    const malformed = structuredClone(record) as unknown as Record<string, unknown>;
    malformed.schemaVersion = "future-schema";
    expect(() => importWrestlerJson(JSON.stringify(malformed))).toThrow(/unsupported/);
    const tampered = structuredClone(record);
    tampered.creation.spentSkillPoints += 1;
    expect(() => importWrestlerJson(JSON.stringify(tampered))).toThrow(/complete creation budget/);
  });

  it("imports a versioned reference roster without losing record identity", () => {
    const records = [legalRecord(405), legalRecord(406)];
    const imported = importReferenceRosterJson(JSON.stringify({ schemaVersion: "asw91-reference-roster-v1", wrestlers: records }));
    expect(imported).toEqual(records);
  });

  it("runs and replays a singles match with a created wrestler", () => {
    const record = legalRecord(401);
    const roster = {
      "player-a": careerRecordToDefinition(record, "player-a", "player"),
      "ai-a": structuredClone(WRESTLERS["ai-a"]),
    };
    const state = createMatch({ seed: 8, roster, teamMembers: { player: ["player-a"], ai: ["ai-a"] } });
    expect(state.roster["player-a"].sourceRecordId).toBe(record.id);
    expect(state.decision?.actions.length).toBeGreaterThan(0);
    expect(hashMatchState(replayFromInputLog(state))).toBe(hashMatchState(state));
  });

  it("runs and replays a tag match using dynamic definitions in all four slots", () => {
    const first = legalRecord(402);
    const second = legalRecord(403);
    const roster = {
      "player-a": careerRecordToDefinition(first, "player-a", "player"),
      "player-b": careerRecordToDefinition(second, "player-b", "player"),
      "ai-a": { ...structuredClone(WRESTLERS["ai-a"]), id: "ai-a", teamId: "ai" as const },
      "ai-b": { ...structuredClone(WRESTLERS["ai-b"]), id: "ai-b", teamId: "ai" as const },
    };
    const state = createMatch({ mode: "tag", seed: 9, roster, teamMembers: { player: ["player-a", "player-b"], ai: ["ai-a", "ai-b"] } });
    expect(state.activeWrestlerIds).toHaveLength(4);
    expect(hashMatchState(replayFromInputLog(state))).toBe(hashMatchState(state));
  });
});

describe("M4 WP awards and atomic progression", () => {
  it("covers all result and opponent-strength branches, including exact +/-50", () => {
    expect(calculateMatchWp({ result: "win", method: "pin", ownWp: 100, opponentWp: 100 }).amount).toBe(5);
    expect(calculateMatchWp({ result: "win", method: "pin", ownWp: 100, opponentWp: 150 }).amount).toBe(6);
    expect(calculateMatchWp({ result: "win", method: "pin", ownWp: 150, opponentWp: 100 }).amount).toBe(4);
    expect(calculateMatchWp({ result: "loss", method: "pin", ownWp: 100, opponentWp: 100 }).amount).toBe(2);
    expect(calculateMatchWp({ result: "loss", method: "pin", ownWp: 150, opponentWp: 100 }).amount).toBe(1);
    expect(calculateMatchWp({ result: "loss", method: "disqualification", ownWp: 0, opponentWp: 500 }).amount).toBe(0);
    expect(calculateMatchWp({ result: "loss", method: "countout", ownWp: 100, opponentWp: 100 }).amount).toBe(1);
    expect(calculateMatchWp({ result: "draw", method: "time-limit-draw", ownWp: 0, opponentWp: 999 }).amount).toBe(3);
  });

  it("uses tag-team averages and applies title bonuses only to pin/submission wins", () => {
    const tag = calculateMatchWp({ result: "win", method: "pin", ownWp: [80, 120], opponentWp: [140, 160] });
    expect(tag).toMatchObject({ ownComparisonWp: 100, opponentComparisonWp: 150, relation: "stronger", amount: 6 });
    expect(calculateMatchWp({ result: "win", method: "pin", ownWp: 100, opponentWp: 100, titleWonOrRetained: true, titleCategory: "world-heavyweight" }).amount).toBe(8);
    expect(calculateMatchWp({ result: "win", method: "disqualification", ownWp: 100, opponentWp: 100, titleWonOrRetained: true, titleCategory: "world-heavyweight" }).amount).toBe(4);
  });

  it("spends attribute WP atomically, recalculates state, and preserves its input", () => {
    const record = legalRecord(500);
    record.careerWp = 50;
    const source = createProgressionState(record);
    const before = structuredClone(source);
    const next = applyProgression(source, { type: "increase-attribute", attribute: "end" });
    expect(next.record.attributes.end).toBe(record.attributes.end + 1);
    expect(next.record.careerWp).toBe(50 - ATTRIBUTE_ADVANCEMENT_COSTS.end);
    expect(next.events[0].detail.join(" ")).toContain("Derived: AV");
    expect(source).toEqual(before);
  });

  it("enforces all age caps while leaving TEC uncapped", () => {
    expect(AGE_CAPS).toEqual({ pow: 35, agi: 32, qui: 34, tec: null, end: 40 });
    const record = legalRecord(501);
    record.careerWp = 100;
    record.history.debutAge = 40;
    record.history.currentAge = 40;
    expect(() => applyProgression(createProgressionState(record), { type: "increase-attribute", attribute: "pow" })).toThrow(/cap age is 35/);
    const technical = applyProgression(createProgressionState(record), { type: "increase-attribute", attribute: "tec" });
    expect(technical.record.attributes.tec).toBe(record.attributes.tec + 1);
  });

  it("rolls back a failed spend and enforces the maneuver breadth cap", () => {
    const record = legalRecord(502);
    record.careerWp = 100;
    record.maneuverLevels = { punch: 1 };
    const source = createProgressionState(record);
    const snapshot = structuredClone(source);
    expect(() => applyProgression(source, { type: "increase-maneuver", maneuverId: "punch" })).toThrow(/breadth cap 1/);
    expect(source).toEqual(snapshot);
  });

  it("reduces drawbacks point-for-point using creation POW and supports removal", () => {
    const drawback: DrawbackDefinition = { type: "glass-jaw", damageThreshold: 20, rollThreshold: 15 };
    const record = legalRecord(503, drawback);
    const cost = drawbackAward(drawback, record.creation.baseAttributes.pow);
    record.careerWp = cost;
    const next = applyProgression(createProgressionState(record), { type: "reduce-drawback", drawbackType: "glass-jaw", replacement: null });
    expect(next.record.drawbacks).toEqual([]);
    expect(next.record.careerWp).toBe(0);
  });

  it("adds title Fame without converting post-creation Fame into WP", () => {
    const record = legalRecord(504);
    const fameBefore = record.fame;
    const next = applyProgression(createProgressionState(record), {
      type: "award-match-wp",
      award: { result: "win", method: "pin", ownWp: 0, opponentWp: 0, titleWonOrRetained: true, titleCategory: "world-heavyweight" },
    });
    expect(next.record.careerWp).toBe(8);
    expect(next.record.fame).toBe(fameBefore + 4);
    expect(next.events[0].detail.join(" ")).toContain("No post-creation Fame-to-WP conversion");
  });

  it("keeps progressed records schema-valid and round-trippable", () => {
    const record = legalRecord(505);
    record.careerWp = 20;
    const progressed = applyProgression(createProgressionState(record), { type: "increase-attribute", attribute: "tec" }).record;
    expect(validateWrestlerRecord(progressed)).toEqual([]);
    expect(importWrestlerJson(serializeWrestler(progressed))).toEqual(progressed);
    expect(MANEUVERS[Object.keys(progressed.maneuverLevels)[0]]).toBeDefined();
  });

  it("replays progression inputs identically and uses the progressed wrestler in a match", () => {
    const record = legalRecord(506);
    let state = createProgressionState(record);
    state = applyProgression(state, { type: "award-match-wp", award: { result: "win", method: "pin", ownWp: 0, opponentWp: 50 } });
    state = applyProgression(state, { type: "increase-skill", skill: "dodge" });
    expect(replayProgression(state)).toEqual(state);
    const match = createMatch({ seed: 506, roster: { "player-a": careerRecordToDefinition(state.record, "player-a", "player"), "ai-a": structuredClone(WRESTLERS["ai-a"]) }, teamMembers: { player: ["player-a"], ai: ["ai-a"] } });
    expect(match.roster["player-a"].skills.dodge).toBe(1);
    expect(hashMatchState(replayFromInputLog(match))).toBe(hashMatchState(match));
  });
});
