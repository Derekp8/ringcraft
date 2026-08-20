import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chooseDeterministicPolicyAction, choosePolicyAction } from "../src/core";
import type { Attributes, SkillLevels, WrestlerCareerRecord } from "../src/core";
import {
  ALL_DECISION_KINDS,
  M10_CAPTURED_POLICY,
  M10_DECISION_LOG_SCHEMA,
  collectCorpusDecisions,
  kindCoverage,
  makeCorpusRecord,
  selectMinimalCorpus,
} from "./m10-ai-corpus";
import type { CorpusMatchConfig, CorpusMatchRecord } from "./m10-ai-corpus";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const fixturePath = join(projectRoot, "fixtures", "m10", "ai-decision-log-v1.json");

/**
 * Crafts a roster record. maneuverLevels are REPLACED when patched so moves
 * granted by the creation pipeline (history gifts, persona bonuses) cannot leak
 * into a deliberately narrow moveset; the same for skills when patched.
 */
function craft(seed: number, index: number, patch: { fame?: number; skills?: Partial<SkillLevels>; maneuverLevels?: Record<string, number>; attributes?: Partial<Attributes> }): WrestlerCareerRecord {
  const base = makeCorpusRecord(seed, index);
  return {
    ...base,
    ...(patch.fame !== undefined ? { fame: patch.fame } : {}),
    ...(patch.skills ? { skills: { ...base.skills, ...patch.skills } } : {}),
    ...(patch.maneuverLevels !== undefined ? { maneuverLevels: patch.maneuverLevels } : {}),
    ...(patch.attributes ? { attributes: { ...base.attributes, ...patch.attributes } } : {}),
  };
}

const allRounder = (seed: number, index: number, agi: number, qui: number, tag = false): WrestlerCareerRecord => craft(seed, index, {
  fame: 6,
  skills: { charm: 3, breakHold: 3, dodge: 3, escapePin: 2, ...(tag ? { tagTeam: 3 } : {}) },
  attributes: { pow: 85, agi, qui, tec: 80, end: 80 },
  maneuverLevels: {
    punch: 3, "body-slam": 3, clothesline: 3, "drop-kick": 3, "forearm-smash": 3, headbutt: 2, suplex: 2, shoulderblock: 2, "elbow-smash": 2, "karate-kick": 2,
    "figure-four-leglock": 3, "boston-crab": 3, sleeper: 3, "bear-hug": 3, headlock: 2, "arm-bar": 2, wristlock: 2,
  },
});

// A submission specialist whose ONLY maneuvers are purchased submission Holds,
// so the v1 policy's highest-scoring attack is always a submission Hold and the
// engine reaches submission-followup / hold-escape / maintain-hold states.
const submissionOnly = (seed: number, index: number, agi: number, qui: number): WrestlerCareerRecord => craft(seed, index, {
  skills: { breakHold: 3, dodge: 3, escapePin: 2 },
  attributes: { pow: 80, agi, qui, tec: 90, end: 80 },
  maneuverLevels: {
    "figure-four-leglock": 3, "boston-crab": 3, sleeper: 3, "camel-clutch": 3, "nerve-pinch": 3, "scorpion-leglock": 3, claw: 3, "double-arm-chicken-wing": 3,
  },
});

const jobber = (seed: number, index: number, agi = 40): WrestlerCareerRecord => craft(seed, index, { fame: 6, skills: { charm: 3 }, attributes: { pow: 40, agi, qui: 40, tec: 40, end: 60 } });

// Weak player-side tag team vs a strong AI legal. The tagger's DAM pool is kept
// just under 36 (end 26 -> ceil((40+26)/2) = 33) so the v1 policy's tag score
// (+180/pool per point of damage) out-scores its damage recovery (+5/point); the
// AI legal's solo phases beat the tagger down until the tag fires from a phase
// the AI legal never shares, producing half-target double-team opportunities
// while both teammates are scheduled.
const tagPair = (seed: number, index: number, agi: number): WrestlerCareerRecord => craft(seed, index, {
  fame: 6,
  skills: { charm: 3, tagTeam: 3, dodge: 3, escapePin: 0 },
  attributes: { pow: 40, agi, qui: 40, tec: 50, end: 26 },
  maneuverLevels: { punch: 3, "forearm-smash": 3, "elbow-smash": 2, headlock: 2 },
});

const weakTagger = (seed: number, index: number, agi: number): WrestlerCareerRecord => tagPair(seed, index, agi);
const weakPartner = (seed: number, index: number, agi: number): WrestlerCareerRecord => tagPair(seed, index, agi);

const rosters: Record<string, WrestlerCareerRecord[]> = {
  "standard-singles": [makeCorpusRecord(5100, 0), makeCorpusRecord(5200, 1)],
  "dominant-singles": [allRounder(5110, 0, 75, 60), jobber(5210, 1, 40)],
  "submission-singles": [submissionOnly(5120, 0, 50, 60), jobber(5220, 1, 40)],
  "equal-singles": [allRounder(5130, 0, 75, 60), allRounder(5230, 1, 55, 70)],
  "standard-tag": [makeCorpusRecord(6100, 0), makeCorpusRecord(6200, 1), makeCorpusRecord(6300, 2), makeCorpusRecord(6400, 3)],
  "dominant-tag": [allRounder(6110, 0, 75, 60, true), allRounder(6210, 1, 55, 70, true), jobber(6310, 2, 45), jobber(6320, 3, 35)],
  // buildCorpusMatchSetup maps player = indices {0,2} and ai = {1,3}, so the array
  // interleaves [player1, ai1, player2, ai2]: the weak player pair vs the strong AI pair.
  // Player pair AGI 40 (phases 2,5,7,10); AI legal AGI 50 (phases 2,4,6,8,10) gets
  // solo hits at phases 4,6,8; the tagger turns at its solo phases 5,7.
  "double-team-tag": [weakTagger(6410, 0, 40), allRounder(6430, 1, 50, 60), weakPartner(6420, 2, 40), allRounder(6440, 3, 60, 70)],
};

function seedRange(start: number, count: number, rosterKey: string, mode: "singles" | "tag"): CorpusMatchConfig[] {
  return Array.from({ length: count }, (_, index) => [
    { label: `${rosterKey}-${start + index}-a`, seed: start + index, mode, timeLimitMinutes: 15, rosterKey, swapped: false },
    { label: `${rosterKey}-${start + index}-b`, seed: start + index, mode, timeLimitMinutes: 15, rosterKey, swapped: true },
  ] as CorpusMatchConfig[]).flat();
}

// Scripted dice: the referee-level D10 at match start, then the AI's first
// attack (the allRounder's first solo phase, before which nothing rolls) down
// the fumble chart to turnbuckle-ko, which hands the player-side jobber an
// automatic knockout-pin decision.
const knockoutPinConfig: CorpusMatchConfig = { label: "knockout-pin-scripted", seed: 1991, mode: "singles", timeLimitMinutes: 15, rosterKey: "dominant-singles", swapped: true, scriptedRolls: [1, 20, 20, 100] };

// The seeded (1991) ruthless exhibition: the same seed the visual gate's
// m10-difficulty-exhibition profile and the unit-suite golden pin use, replayed
// here under the ruthless policy on the standard-singles roster. Threading
// `aiDifficulty` through the match config makes the ruthless AI part of the
// replay contract (hashMatchState covers it), so the fixtures:verify gate
// guards the ruthless replay independently of the browser and the unit suite.
const ruthlessConfig: CorpusMatchConfig = { label: "ruthless-singles-1991", seed: 1991, mode: "singles", timeLimitMinutes: 15, rosterKey: "standard-singles", swapped: false, aiDifficulty: "ruthless" };

const probe: CorpusMatchConfig[] = [
  ...seedRange(1991, 4, "standard-singles", "singles"),
  ...seedRange(2100, 8, "dominant-singles", "singles"),
  ...seedRange(2200, 8, "submission-singles", "singles"),
  ...seedRange(2300, 8, "equal-singles", "singles"),
  ...seedRange(3000, 4, "standard-tag", "tag"),
  ...seedRange(3100, 8, "dominant-tag", "tag"),
  ...seedRange(3200, 8, "double-team-tag", "tag"),
  knockoutPinConfig,
  ruthlessConfig,
];

// A difficulty-aware selector for the collection pass: standard runs replay
// under the deterministic v1 path; the ruthless run under the 2-ply policy.
// (AI-side decisions resolve internally from state.config.aiDifficulty, so the
// injected selector only affects player-side decisions, which are the recorded
// entries.)
const collectSelect = (config: CorpusMatchConfig) => (state: Parameters<typeof chooseDeterministicPolicyAction>[0], decision: Parameters<typeof chooseDeterministicPolicyAction>[1]) =>
  choosePolicyAction(state, decision, config.aiDifficulty ?? "standard");

const probed: CorpusMatchRecord[] = [];
for (const config of probe) {
  const { entries, finalStateHash } = collectCorpusDecisions(config, rosters[config.rosterKey], collectSelect(config));
  probed.push({ label: config.label, config, decisions: entries, finalStateHash });
}

const byRoster: Record<string, Record<string, number>> = {};
for (const record of probed) {
  const map = (byRoster[record.config.rosterKey] ??= {});
  for (const entry of record.decisions) map[entry.kind] = (map[entry.kind] ?? 0) + 1;
}
console.log("per-roster coverage:", JSON.stringify(byRoster, null, 2));
console.log("probe coverage:", JSON.stringify(kindCoverage(probed), null, 2));
const missing = ALL_DECISION_KINDS.filter((kind) => !kindCoverage(probed)[kind]);
console.log("missing kinds:", missing.length ? missing.join(", ") : "(none)");

const selected = selectMinimalCorpus(probed);
// Force-include the seeded ruthless exhibition so the fixture always carries
// the ruthless replay contract even though it adds no new decision kind.
const ruthlessRecord = probed.find((record) => record.label === ruthlessConfig.label);
if (!ruthlessRecord) throw new Error("Ruthless corpus run did not produce a record.");
const corpus = [...selected.filter((record) => record.label !== ruthlessConfig.label), ruthlessRecord];
const coverage = kindCoverage(corpus);
console.log("minimal subset:", corpus.length, "runs;", corpus.reduce((sum, row) => sum + row.decisions.length, 0), "decisions; kinds covered:", Object.keys(coverage).length);
for (const kind of ALL_DECISION_KINDS) if (!coverage[kind]) throw new Error(`Corpus is missing decision kind ${kind}.`);

const fixture = {
  schema: M10_DECISION_LOG_SCHEMA,
  capturedPolicy: M10_CAPTURED_POLICY,
  rosters,
  corpus,
};
await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${fixturePath}`);
