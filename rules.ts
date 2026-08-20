import { fnv1a32 } from "./hash";
import type { DiceExpression, ManeuverDefinition, WrestlerDefinition, WrestlerId } from "./types";

export const RULESET_VERSION = "1.1.0-m4-candidate";

export const PHASE_SCHEDULE: Readonly<Record<number, readonly number[]>> = {
  0: [],
  1: [5],
  2: [5, 10],
  3: [3, 6, 9],
  4: [2, 5, 7, 10],
  5: [2, 4, 6, 8, 10],
  6: [2, 3, 5, 6, 8, 9],
  7: [2, 3, 5, 6, 7, 9, 10],
  8: [1, 2, 3, 5, 6, 8, 9, 10],
  9: [1, 2, 3, 4, 6, 7, 8, 9, 10],
  10: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
};

export const ATTRIBUTE_LOOKUPS = {
  powAv: [0, 1, 1, 2, 2, 3, 3, 4, 4, 5],
  powDv: [0, 0, 0, 0, 0, 0, 0, 1, 1, 2],
  agiAv: [0, 0, 0, 1, 1, 2, 2, 3, 3, 4],
  agiDv: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4],
  quiAv: [0, 0, 0, 0, 1, 1, 2, 2, 3, 3],
  quiDv: [0, 1, 1, 2, 2, 3, 4, 5, 6, 7],
  tecAv: [0, 1, 1, 2, 2, 3, 4, 5, 6, 7],
  tecDv: [0, 0, 0, 0, 1, 1, 2, 2, 3, 3],
} as const;

export const BODY_TABLE = [
  [1, 1, 2, 2],
  [1, 2, 3, 3],
  [2, 3, 3, 4],
  [2, 3, 4, 5],
  [3, 4, 4, 5],
  [4, 5, 5, 6],
] as const;

export const DAMAGE_BONUS_BANDS: ReadonlyArray<{ maxPow: number; expression: DiceExpression }> = [
  { maxPow: 20, expression: { dice: 0, sides: 6, flat: 0 } },
  { maxPow: 30, expression: { dice: 0, sides: 6, flat: 1 } },
  { maxPow: 60, expression: { dice: 0, sides: 6, flat: 2 } },
  { maxPow: 70, expression: { dice: 1, sides: 6, flat: 0 } },
  { maxPow: 80, expression: { dice: 1, sides: 6, flat: 1 } },
  { maxPow: 90, expression: { dice: 1, sides: 6, flat: 2 } },
  { maxPow: 100, expression: { dice: 2, sides: 6, flat: 0 } },
];

export const CHARM_EFFECTS = {
  0: { ordinaryCheck: 0, restrictedCheck: 0, damageDice: 0, recovery: 0 },
  1: { ordinaryCheck: 1, restrictedCheck: 0, damageDice: 1, recovery: 5 },
  2: { ordinaryCheck: 3, restrictedCheck: 1, damageDice: 2, recovery: 10 },
  3: { ordinaryCheck: 5, restrictedCheck: 3, damageDice: 3, recovery: 15 },
} as const;

export const CRITICAL_HOLD_BANDS = [
  { max: 20, effect: "skip-1" }, { max: 30, effect: "skip-1-escape-1" },
  { max: 40, effect: "skip-1-escape-2" }, { max: 50, effect: "damage-d6-1" },
  { max: 55, effect: "damage-d6-2" }, { max: 60, effect: "damage-d6-3" },
  { max: 65, effect: "damage-x2" }, { max: 70, effect: "damage-x3" },
  { max: 80, effect: "dv-rest-1" }, { max: 90, effect: "dv-rest-2" },
  { max: 95, effect: "half-dv-rest" }, { max: 98, effect: "sprain" },
  { max: 99, effect: "break" }, { max: 100, effect: "break-submit" },
] as const;

export const CRITICAL_STRIKE_BANDS = [
  { max: 20, effect: "skip-1" }, { max: 30, effect: "skip-1-av-next-2" },
  { max: 40, effect: "stun-d6" }, { max: 50, effect: "bonus-attack" },
  { max: 60, effect: "bonus-attack-av-2" }, { max: 70, effect: "damage-d6-2" },
  { max: 75, effect: "damage-d6-3" }, { max: 80, effect: "damage-d6-4" },
  { max: 85, effect: "damage-x2" }, { max: 90, effect: "damage-x3" },
  { max: 95, effect: "dv-rest-2" }, { max: 97, effect: "av-5-half-dv" },
  { max: 99, effect: "av-5-half-dv-injury" }, { max: 100, effect: "knockout-d6-minutes" },
] as const;

export const FUMBLE_BANDS = [
  { max: 10, effect: "skip-1" }, { max: 20, effect: "skip-1-dv-next-2" },
  { max: 30, effect: "end-d6-1" }, { max: 40, effect: "end-d6-2" },
  { max: 50, effect: "end-d6-3" }, { max: 60, effect: "ref-stun-5" },
  { max: 65, effect: "ref-stun-10" }, { max: 70, effect: "ref-ko-d10" },
  { max: 75, effect: "ref-ko-2d10" }, { max: 80, effect: "ref-check" },
  { max: 90, effect: "ref-check-10" }, { max: 95, effect: "self-injury" },
  { max: 98, effect: "rollup" }, { max: 99, effect: "rollup-5" },
  { max: 100, effect: "turnbuckle-ko" },
] as const;

function hold(
  id: string,
  name: string,
  minAttribute: number,
  dice: number,
  flat: number,
  endCost: number,
  usesDamageBonus: boolean,
  breakRating: number,
  listedCost: number,
  submission = false,
  illegal = false,
): ManeuverDefinition {
  return { id, name, kind: "hold", minAttribute, damage: { dice, sides: 6, flat }, endCost, listedCost, usesDamageBonus, breakRating, submission, illegal };
}

function strike(
  id: string,
  name: string,
  minAttribute: number,
  dice: number,
  flat: number,
  endCost: number,
  usesDamageBonus: boolean,
  whipEligible: boolean,
  listedCost: number,
  finisher = false,
  illegal = false,
  throwsOut = false,
): ManeuverDefinition {
  return { id, name, kind: "strike", minAttribute, damage: { dice, sides: 6, flat }, endCost, listedCost, usesDamageBonus, whipEligible, finisher, illegal, throwsOut };
}

// Complete source maneuver charts, transcribed from printed pp. 39-41.
const maneuverRows: ManeuverDefinition[] = [
  hold("abdominal-stretch", "Abdominal Stretch", 60, 2, -1, 4, false, 3, 10),
  hold("arm-bar", "Arm Bar", 30, 1, 0, 2, false, 1, 5),
  hold("bear-hug", "Bear Hug", 10, 2, 1, 5, true, 6, 24, true),
  hold("boston-crab", "Boston Crab", 55, 3, 1, 6, false, 8, 26, true),
  hold("boston-crab-single-leg", "Boston Crab, Single Leg", 50, 2, 0, 4, false, 4, 12),
  hold("camel-clutch", "Camel Clutch", 65, 3, -1, 5, false, 7, 24, true),
  hold("choke", "Choke", 0, 1, 0, 3, true, 3, 8, false, true),
  hold("choke-with-ropes", "Choke with Ropes", 0, 2, -1, 2, true, 4, 15, false, true),
  hold("claw", "Claw", 20, 3, -1, 5, true, 6, 28, true),
  hold("double-arm-chicken-wing", "Double-Arm Chicken Wing", 70, 2, 2, 6, false, 7, 20, true),
  hold("figure-four-leglock", "Figure-Four Leglock", 70, 3, 2, 5, false, 8, 28, true),
  hold("front-face-lock", "Front Face Lock", 50, 1, 1, 2, false, 3, 8),
  hold("full-nelson", "Full Nelson", 30, 2, 2, 5, true, 6, 25, true),
  hold("half-nelson", "Half Nelson", 20, 2, -1, 3, true, 3, 16),
  hold("hammerlock", "Hammerlock", 40, 1, 0, 2, false, 2, 6),
  hold("headlock", "Headlock", 30, 1, 1, 2, true, 2, 12),
  hold("leg-scissors", "Leg Scissors", 30, 1, 1, 3, false, 2, 6),
  hold("leglock", "Leglock", 50, 1, 2, 3, false, 2, 7),
  hold("neck-vise", "Neck Vise", 20, 2, 0, 3, true, 4, 18),
  hold("nerve-pinch", "Nerve Pinch", 35, 2, 1, 4, true, 5, 24, true),
  hold("scorpion-leglock", "Scorpion Leglock", 70, 3, 2, 6, false, 8, 27, true),
  hold("sleeper", "Sleeper", 40, 2, 1, 3, false, 5, 20, true),
  hold("the-rack", "The Rack", 40, 3, 0, 6, true, 8, 30, true),
  hold("wristlock", "Wristlock", 50, 1, 0, 2, true, 2, 11),

  strike("airplane-spin", "Airplane Spin", 30, 4, -1, 5, false, false, 6),
  strike("arm-drag-takedown", "Arm Drag Takedown", 0, 1, -1, 1, false, true, 6),
  strike("atomic-drop", "Atomic Drop", 30, 4, 2, 4, false, false, 10),
  strike("back-bodydrop", "Back Bodydrop", 30, 2, 2, 4, false, true, 9),
  strike("backbreaker", "Backbreaker", 35, 4, 2, 7, true, false, 12),
  strike("big-splash", "Big Splash", 0, 4, 2, 6, true, false, 13),
  strike("bite", "Bite", 0, 1, 2, 1, false, false, 1, false, true),
  strike("body-slam", "Body Slam", 25, 2, 1, 3, true, false, 9),
  strike("body-tackle", "Body Tackle", 0, 3, 1, 5, true, true, 15),
  strike("brainbuster", "Brainbuster", 50, 6, 2, 8, false, false, 17, true),
  strike("bulldog", "Bulldog", 0, 4, 0, 4, false, false, 8),
  strike("chop-to-chest", "Chop to Chest", 0, 1, 2, 2, false, true, 8),
  strike("chop-to-throat", "Chop to Throat", 0, 2, 0, 2, false, true, 9),
  strike("clothesline", "Clothesline", 0, 3, 0, 5, true, true, 14),
  strike("clothesline-charging", "Clothesline, Charging", 0, 3, 2, 6, true, true, 15),
  strike("clothesline-flying", "Clothesline, Flying", 0, 4, 0, 6, true, true, 16),
  strike("clothesline-off-top-rope", "Clothesline, Off Top Rope", 0, 5, 0, 8, true, false, 17, true),
  strike("ddt", "DDT", 0, 5, 2, 5, false, false, 17, true),
  strike("ddt-off-ropes", "DDT Off Ropes", 65, 6, 1, 7, false, false, 17, true),
  strike("double-axe-handle", "Double Axe Handle", 0, 2, -1, 4, true, true, 11),
  strike("double-axe-handle-off-ropes", "Double Axe Handle, Off Ropes", 0, 2, 1, 5, true, false, 7),
  strike("double-axe-handle-running", "Double Axe Handle, Running", 0, 2, 0, 5, true, true, 11),
  strike("drop-kick", "Drop Kick", 0, 2, 0, 4, true, true, 12),
  strike("drop-kick-off-ropes", "Drop Kick Off Ropes", 0, 4, 0, 6, true, false, 11),
  strike("elbow-drop", "Elbow Drop", 0, 2, 2, 3, false, false, 5),
  strike("elbow-drop-off-ropes", "Elbow Drop Off Ropes", 0, 6, 0, 7, false, false, 16, true),
  strike("elbow-smash", "Elbow Smash", 0, 2, 0, 4, true, true, 12),
  strike("eye-gouge", "Eye Gouge", 0, 1, 2, 1, false, false, 1, false, true),
  strike("face-rake", "Face Rake", 0, 1, 1, 1, false, false, 3),
  strike("face-rub-in-mat", "Face Rub in Mat", 0, 1, 2, 2, false, false, 3),
  strike("fistdrop", "Fistdrop", 0, 2, 2, 3, false, false, 5),
  strike("fistdrop-flying", "Fistdrop, Flying", 0, 3, 2, 4, false, false, 7),
  strike("flying-bodypress", "Flying Bodypress", 0, 4, 1, 6, false, true, 12),
  strike("forearm-smash", "Forearm Smash", 0, 2, -1, 2, true, false, 8),
  strike("headbutt", "Headbutt", 0, 3, 1, 5, true, true, 15),
  strike("headbutt-flying", "Headbutt, Flying", 0, 5, 1, 8, true, false, 18, true),
  strike("head-to-buckle", "Head to Buckle", 0, 2, 1, 3, true, false, 9),
  strike("heart-punch", "Heart Punch", 60, 5, 2, 6, true, false, 21, true),
  strike("high-cross-bodyblock", "High Cross Bodyblock", 0, 5, 2, 8, false, false, 14, true),
  strike("hip-toss", "Hip Toss", 0, 2, -1, 4, false, true, 6),
  strike("karate-chop", "Karate Chop", 0, 2, -1, 2, false, true, 8),
  strike("karate-kick", "Karate Kick", 0, 3, 0, 4, true, true, 15),
  strike("kick-reverse", "Kick, Reverse", 0, 3, 2, 5, true, true, 16),
  strike("kick-to-midsection", "Kick to Midsection", 0, 3, 1, 4, true, false, 11),
  strike("knee-drop", "Knee Drop", 0, 2, 1, 2, false, false, 5),
  strike("knee-drop-off-ropes", "Knee Drop Off Ropes", 0, 5, -1, 4, false, false, 10),
  strike("leg-drop", "Leg Drop", 0, 2, 2, 2, false, false, 6),
  strike("leg-drop-off-ropes", "Leg Drop Off Ropes", 0, 4, 1, 4, false, false, 9),
  strike("mouth-ripper", "Mouth Ripper", 0, 2, 1, 2, false, false, 2, false, true),
  strike("neckbreaker", "Neckbreaker", 0, 4, 0, 5, true, false, 12),
  strike("neckbreaker-flying", "Neckbreaker, Flying", 0, 5, -1, 6, false, true, 13),
  strike("piledriver", "Piledriver", 40, 6, 0, 8, true, false, 20, true),
  strike("power-bomb", "Power Bomb", 80, 5, 2, 9, true, false, 18, true),
  strike("powerslam", "Powerslam", 45, 3, 2, 6, true, true, 15),
  strike("powerslam-running", "Powerslam, Running", 50, 4, 2, 7, true, false, 12),
  strike("press-and-slam", "Press & Slam", 70, 5, 1, 9, true, false, 17, true),
  strike("punch", "Punch", 0, 1, 0, 3, true, true, 10),
  strike("rake-with-boot", "Rake With Boot", 0, 2, -1, 1, false, false, 4),
  strike("rope-burn", "Rope Burn", 0, 2, -1, 2, false, false, 3),
  strike("russian-leg-sweep", "Russian Leg Sweep", 0, 2, 0, 2, false, false, 4),
  strike("shoulderblock", "Shoulderblock", 0, 2, -1, 4, true, true, 11),
  strike("shoulder-breaker", "Shoulder Breaker", 50, 5, 2, 7, true, false, 20, true),
  strike("shoulder-to-steel-pole", "Shoulder to Steel Pole", 0, 3, 1, 2, true, false, 13),
  strike("splash-from-top-rope", "Splash From Top Rope", 0, 6, 0, 10, true, false, 18, true),
  strike("snapmare", "Snapmare", 0, 1, 1, 2, false, false, 2),
  strike("suplex", "Suplex", 20, 3, -1, 3, false, false, 5),
  strike("suplex-bearhug", "Suplex, Bearhug", 75, 5, 2, 8, true, false, 19, true),
  strike("suplex-belly-to-back", "Suplex, Belly to Back", 30, 4, -1, 6, true, false, 10),
  strike("suplex-belly-to-belly", "Suplex, Belly to Belly", 55, 5, 2, 7, true, false, 20, true),
  strike("suplex-double-arm", "Suplex, Double Arm", 40, 4, 2, 5, false, false, 9),
  strike("suplex-gutwrench", "Suplex, Gutwrench", 60, 5, 0, 5, true, false, 20, true),
  strike("suplex-headscissor", "Suplex, Headscissor", 30, 3, 1, 5, true, true, 15),
  strike("suplex-side", "Suplex, Side", 40, 4, 0, 6, true, false, 11),
  strike("suplex-snap", "Suplex, Snap", 30, 4, 1, 4, false, false, 9),
  strike("suplex-standing-vertical", "Suplex, Standing Vertical", 35, 5, -1, 4, false, false, 10),
  strike("superplex", "Superplex", 60, 6, 2, 9, false, false, 16, true),
  strike("throw-out-of-ring", "Throw Out of Ring", 0, 3, 1, 5, false, true, 10, false, false, true),
  strike("turnbuckle-smash", "Turnbuckle Smash", 0, 3, 1, 5, true, false, 10),
];

export const MANEUVERS: Readonly<Record<string, ManeuverDefinition>> = Object.freeze(
  Object.fromEntries(maneuverRows.map((move) => [move.id, Object.freeze(move)])),
);

const emptySkills = (): WrestlerDefinition["skills"] => ({
  breakHold: 0, distractReferee: 0, dodge: 0, escapePin: 0, illegalPin: 0,
  irishWhip: 0, pinInterference: 0, tagTeam: 0, charm: 0,
});

export const WRESTLERS: Readonly<Record<WrestlerId, WrestlerDefinition>> = {
  "player-a": {
    id: "player-a", teamId: "player", name: "Atlas King", epithet: "The Iron Standard", side: "fan-favorite", weight: 245,
    attributes: { pow: 62, agi: 50, qui: 61, tec: 55, end: 60 },
    maneuverLevels: { "arm-bar": 2, headlock: 2, "bear-hug": 1, "body-slam": 2, clothesline: 1, powerslam: 1, "throw-out-of-ring": 1 },
    skills: { ...emptySkills(), breakHold: 2, dodge: 2, escapePin: 1, irishWhip: 2, tagTeam: 2, charm: 4 },
    drawbacks: [{ type: "egotist", damageThreshold: 20, rollThreshold: 9 }], fame: 8,
  },
  "player-b": {
    id: "player-b", teamId: "player", name: "Nova Hart", epithet: "The Blue Comet", side: "fan-favorite", weight: 208,
    attributes: { pow: 48, agi: 70, qui: 68, tec: 70, end: 52 },
    maneuverLevels: { "arm-drag-takedown": 3, "drop-kick": 3, "flying-bodypress": 2, headlock: 2, "figure-four-leglock": 1, "throw-out-of-ring": 1 },
    skills: { ...emptySkills(), breakHold: 2, distractReferee: 2, dodge: 3, escapePin: 2, irishWhip: 3, tagTeam: 3, charm: 3 },
    drawbacks: [{ type: "glass-jaw", damageThreshold: 25, rollThreshold: 9 }], fame: 6,
  },
  "ai-a": {
    id: "ai-a", teamId: "ai", name: "Duke Vane", epithet: "The Velvet Vice", side: "rulebreaker", weight: 268,
    attributes: { pow: 55, agi: 60, qui: 55, tec: 55, end: 55 },
    maneuverLevels: { headlock: 1, "bear-hug": 1, "body-slam": 2, clothesline: 2, "eye-gouge": 2, "choke-with-ropes": 1, "throw-out-of-ring": 2 },
    skills: { ...emptySkills(), breakHold: 1, distractReferee: 2, dodge: 2, escapePin: 1, illegalPin: 2, irishWhip: 2, pinInterference: 2, tagTeam: 2 },
    drawbacks: [{ type: "old-injury", damageThreshold: 25, rollThreshold: 9 }], fame: 2,
  },
  "ai-b": {
    id: "ai-b", teamId: "ai", name: "Rex Ransom", epithet: "The Concrete Crown", side: "rulebreaker", weight: 306,
    attributes: { pow: 72, agi: 40, qui: 45, tec: 48, end: 66 },
    maneuverLevels: { "neck-vise": 2, "the-rack": 1, backbreaker: 2, "big-splash": 2, "mouth-ripper": 2, "throw-out-of-ring": 2, "body-tackle": 1 },
    skills: { ...emptySkills(), breakHold: 2, distractReferee: 1, dodge: 1, escapePin: 1, illegalPin: 1, irishWhip: 1, pinInterference: 2, tagTeam: 2 },
    drawbacks: [{ type: "stupid-moves", intervalMinutes: 2, rollThreshold: 9 }], fame: 3,
  },
};

export const FIXTURE_ROSTER = WRESTLERS;

export function maneuverConstructionCost(move: ManeuverDefinition): number {
  if (move.kind === "hold") {
    return move.damage.dice * 6 + move.damage.flat + (move.usesDamageBonus ? 5 : 0) + (move.submission ? 5 : 0) +
      (move.breakRating ?? 0) - (move.illegal ? 3 : 0) - move.endCost;
  }
  return move.damage.dice * 3 + move.damage.flat + (move.usesDamageBonus ? 5 : 0) + (move.finisher ? 5 : 0) +
    (move.whipEligible ? 5 : 0) - (move.illegal ? 3 : 0) - move.endCost;
}

export function validateRulesData(): string[] {
  const errors: string[] = [];
  const holds = maneuverRows.filter((move) => move.kind === "hold");
  if (holds.length !== 24) errors.push(`Expected 24 source Holds, found ${holds.length}.`);
  for (const move of maneuverRows) {
    const computed = maneuverConstructionCost(move);
    if (computed !== move.listedCost) errors.push(`${move.name}: listed cost ${move.listedCost}, computed ${computed}.`);
    if (move.kind === "hold" && move.submission && (move.breakRating ?? 0) < 5) errors.push(`${move.name}: Submission Hold BRK below 5.`);
    if (move.kind === "strike" && move.finisher && move.damage.dice < 5) errors.push(`${move.name}: finisher below 5D6.`);
  }
  for (const wrestler of Object.values(WRESTLERS)) {
    if (wrestler.skills.charm > Math.floor(wrestler.fame / 2)) errors.push(`${wrestler.name}: Charm exceeds Fame cap.`);
    for (const moveId of Object.keys(wrestler.maneuverLevels)) if (!MANEUVERS[moveId]) errors.push(`${wrestler.name}: unknown maneuver ${moveId}.`);
  }
  return errors;
}

export const DATA_HASH = fnv1a32({
  rulesetVersion: RULESET_VERSION,
  phaseSchedule: PHASE_SCHEDULE,
  attributes: ATTRIBUTE_LOOKUPS,
  body: BODY_TABLE,
  damageBonus: DAMAGE_BONUS_BANDS,
  charm: CHARM_EFFECTS,
  criticalHold: CRITICAL_HOLD_BANDS,
  criticalStrike: CRITICAL_STRIKE_BANDS,
  fumble: FUMBLE_BANDS,
  maneuvers: MANEUVERS,
});
