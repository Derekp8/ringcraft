import { maneuverConstructionCost } from "./rules";
import { fnv1a32 } from "./hash";
import type {
  DrawbackDefinition,
  ManeuverDefinition,
  ManeuverDraft,
  PriorTitle,
  Side,
  SkillLevels,
} from "./types";

export const M4_DATA_PACK_VERSION = "classic-1991-m4-v1";
export const WRESTLER_SCHEMA_VERSION = "asw91-wrestler-v1" as const;
export const BASE_CREATION_SKILL_POINTS = 150;
export const LIGHT_HEAVYWEIGHT_LIMIT = 235;

export const HEIGHT_WEIGHT_BANDS = Object.freeze([
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
] as const);

export const AGE_MODIFIER_BANDS = Object.freeze([
  { min: 1, max: 40, direction: -1 },
  { min: 41, max: 60, direction: 0 },
  { min: 61, max: 100, direction: 1 },
] as const);

export const AGE_CAPS = Object.freeze({ pow: 35, agi: 32, qui: 34, tec: null, end: 40 } as const);
export const ATTRIBUTE_ADVANCEMENT_COSTS = Object.freeze({ pow: 15, agi: 12, qui: 10, tec: 14, end: 9 } as const);
export const TITLE_FAME = Object.freeze({ worldHeavyweight: 4, worldTag: 3, singles: 2, tag: 1 } as const);
export const TITLE_WP_BONUS = Object.freeze({
  "world-heavyweight": 3,
  international: 2,
  "world-tag": 2,
  "american-tag": 1,
  television: 1,
} as const);

export interface FederationBand {
  min: number;
  max: number;
  id: string | null;
  label: string;
}

export const FEDERATION_BANDS: readonly FederationBand[] = Object.freeze([
  { min: 1, max: 60, id: null, label: "No prior circuit" },
  { min: 61, max: 70, id: "twc", label: "Texas circuit" },
  { min: 71, max: 75, id: "spw", label: "South Pacific circuit" },
  { min: 76, max: 80, id: "ssw", label: "Southern States circuit" },
  { min: 81, max: 83, id: "aaw", label: "All-American circuit" },
  { min: 84, max: 85, id: "awc", label: "Australian circuit" },
  { min: 86, max: 87, id: "iaw", label: "Indiana circuit" },
  { min: 88, max: 92, id: "acw", label: "Canadian circuit" },
  { min: 93, max: 95, id: "jwa", label: "Japanese circuit" },
  { min: 96, max: 98, id: "ewl", label: "European circuit" },
  { min: 99, max: 100, id: "aww", label: "World circuit" },
]);

type TitleRow = Omit<PriorTitle, "circuitId"> & { min: number; max: number };

function title(
  id: string,
  label: string,
  category: PriorTitle["category"],
  min: number,
  max: number,
  lightHeavyweight = false,
): TitleRow {
  const fame = category === "world-heavyweight" ? 4 : category === "world-tag" ? 3 : category === "singles" ? 2 : 1;
  return { id, label, category, fame, lightHeavyweight, min, max };
}

// Neutral display labels preserve the source probability and mechanical categories
// without bundling the manual's fictional roster or presentation.
export const CHAMPIONSHIP_BANDS: Readonly<Record<string, readonly TitleRow[]>> = Object.freeze({
  twc: [
    title("twc-tag", "Texas Tag title", "tag", 1, 50),
    title("twc-light", "Texas Light Heavyweight title", "singles", 51, 90, true),
    title("twc-heavy", "Texas Heavyweight title", "singles", 91, Number.POSITIVE_INFINITY),
  ],
  spw: [
    title("spw-island-tag", "Island Tag title", "tag", 1, 40),
    title("spw-pacific-tag", "South Pacific Tag title", "tag", 41, 80),
    title("spw-island-heavy", "Island Heavyweight title", "singles", 81, 100),
    title("spw-pacific-heavy", "South Pacific Heavyweight title", "singles", 101, Number.POSITIVE_INFINITY),
  ],
  ssw: [
    title("ssw-tag", "Southern States Tag title", "tag", 1, 40),
    title("ssw-light", "Southern States Light Heavyweight title", "singles", 41, 75, true),
    title("ssw-tennessee", "Tennessee Heavyweight title", "singles", 76, 100),
    title("ssw-heavy", "Southern States Heavyweight title", "singles", 101, Number.POSITIVE_INFINITY),
  ],
  aaw: [
    title("aaw-tag", "All-American Tag title", "tag", 1, 60),
    title("aaw-tv", "All-American Television title", "singles", 61, 95),
    title("aaw-heavy", "All-American Heavyweight title", "singles", 96, Number.POSITIVE_INFINITY),
  ],
  awc: [
    title("awc-nz-tag", "New Zealand Tag title", "tag", 1, 60),
    title("awc-australian-tag", "Australian Tag title", "tag", 61, 90),
    title("awc-heavy", "Australian Heavyweight title", "singles", 91, Number.POSITIVE_INFINITY),
  ],
  iaw: [
    title("iaw-tag", "Indiana Tag title", "tag", 1, 90),
    title("iaw-heavy", "Indiana Heavyweight title", "singles", 91, Number.POSITIVE_INFINITY),
  ],
  acw: [
    title("acw-tag", "Canadian Tag title", "tag", 1, 50),
    title("acw-tv", "Canadian Television title", "singles", 51, 95),
    title("acw-heavy", "Canadian Heavyweight title", "singles", 96, Number.POSITIVE_INFINITY),
  ],
  jwa: [
    title("jwa-tag", "Japanese Tag title", "tag", 1, 60),
    title("jwa-tv", "Japanese Television title", "singles", 61, 80),
    title("jwa-international", "Japanese International title", "singles", 81, 110),
    title("jwa-heavy", "Japanese Heavyweight title", "singles", 111, Number.POSITIVE_INFINITY),
  ],
  ewl: [
    title("ewl-tag", "European Tag title", "tag", 1, 40),
    title("ewl-light", "European Light Heavyweight title", "singles", 41, 90, true),
    title("ewl-heavy", "European Heavyweight title", "singles", 91, Number.POSITIVE_INFINITY),
  ],
  aww: [
    title("aww-tv", "World Television title", "singles", 1, 60),
    title("aww-light", "World Light Heavyweight title", "singles", 61, 80, true),
    title("aww-american", "American Heavyweight title", "singles", 81, 95),
    title("aww-world-tag", "World Tag title", "world-tag", 96, 115),
    title("aww-world-heavy", "World Heavyweight title", "world-heavyweight", 116, Number.POSITIVE_INFINITY),
  ],
});

export const DEBUT_RESULT_BANDS = Object.freeze([
  { min: Number.NEGATIVE_INFINITY, max: 50, result: "loss-pin-submission" },
  { min: 51, max: 70, result: "loss-dq" },
  { min: 71, max: 90, result: "double-dq" },
  { min: 91, max: 99, result: "win-dq" },
  { min: 100, max: Number.POSITIVE_INFINITY, result: "win-pin-submission" },
] as const);

export interface SpecialSkillDefinition {
  id: keyof SkillLevels;
  label: string;
  cost: number;
  basis: "AV" | "DV" | "special";
  untrainedPenalty: number;
  side?: Side;
  tagOnly?: boolean;
  cap: "technical" | "fame";
}

export const SPECIAL_SKILLS: Readonly<Record<keyof SkillLevels, SpecialSkillDefinition>> = Object.freeze({
  breakHold: { id: "breakHold", label: "Break Hold", cost: 10, basis: "DV", untrainedPenalty: -1, cap: "technical" },
  distractReferee: { id: "distractReferee", label: "Distract Referee", cost: 10, basis: "AV", untrainedPenalty: -5, tagOnly: true, cap: "technical" },
  dodge: { id: "dodge", label: "Dodge", cost: 5, basis: "DV", untrainedPenalty: 0, cap: "technical" },
  escapePin: { id: "escapePin", label: "Escape Pin", cost: 10, basis: "DV", untrainedPenalty: 0, cap: "technical" },
  illegalPin: { id: "illegalPin", label: "Illegal Pin", cost: 15, basis: "AV", untrainedPenalty: 0, side: "rulebreaker", cap: "technical" },
  irishWhip: { id: "irishWhip", label: "Irish Whip", cost: 15, basis: "AV", untrainedPenalty: -5, cap: "technical" },
  pinInterference: { id: "pinInterference", label: "Pin Interference", cost: 15, basis: "AV", untrainedPenalty: -3, tagOnly: true, cap: "technical" },
  tagTeam: { id: "tagTeam", label: "Tag Team", cost: 10, basis: "AV", untrainedPenalty: -5, tagOnly: true, cap: "technical" },
  charm: { id: "charm", label: "Charm", cost: 15, basis: "special", untrainedPenalty: 0, side: "fan-favorite", cap: "fame" },
});

export function emptySkillLevels(): SkillLevels {
  return {
    breakHold: 0,
    distractReferee: 0,
    dodge: 0,
    escapePin: 0,
    illegalPin: 0,
    irishWhip: 0,
    pinInterference: 0,
    tagTeam: 0,
    charm: 0,
  };
}

export function specialSkillCap(skill: keyof SkillLevels, tec: number, fame: number): number {
  return skill === "charm" ? Math.floor(fame / 2) : Math.min(10, Math.floor(tec / 10));
}

const EGOTIST_BASE: Readonly<Record<15 | 20 | 25, readonly [number, number, number, number, number]>> = {
  15: [20, 25, 25, 30, 35],
  20: [15, 15, 20, 25, 25],
  25: [10, 10, 15, 20, 20],
};
const ROLL_MODIFIER: Readonly<Record<9 | 12 | 15, number>> = { 9: -5, 12: 0, 15: 5 };
const DAMAGE_DRAWBACK_BASE: Readonly<Record<20 | 25 | 30, number>> = { 20: 25, 25: 20, 30: 15 };
const DAMAGE_DRAWBACK_ROLL: Readonly<Record<9 | 12 | 15, number>> = { 9: 0, 12: 5, 15: 10 };
const STUPID_MOVES_BASE: Readonly<Record<1 | 2 | 5, number>> = { 1: 25, 2: 20, 5: 10 };

export function drawbackAward(drawback: DrawbackDefinition, basePow: number): number {
  if (drawback.type === "egotist") {
    const powBand = basePow <= 30 ? 0 : basePow <= 50 ? 1 : basePow <= 70 ? 2 : basePow <= 90 ? 3 : 4;
    return EGOTIST_BASE[drawback.damageThreshold][powBand] + ROLL_MODIFIER[drawback.rollThreshold];
  }
  if (drawback.type === "glass-jaw" || drawback.type === "old-injury") {
    return DAMAGE_DRAWBACK_BASE[drawback.damageThreshold] + DAMAGE_DRAWBACK_ROLL[drawback.rollThreshold];
  }
  return STUPID_MOVES_BASE[drawback.intervalMinutes] + DAMAGE_DRAWBACK_ROLL[drawback.rollThreshold];
}

export function withDrawbackAward(drawback: DrawbackDefinition, basePow: number): DrawbackDefinition {
  return { ...drawback, awardedPoints: drawbackAward(drawback, basePow) } as DrawbackDefinition;
}

export function allDrawbackOptions(type: DrawbackDefinition["type"], basePow: number): DrawbackDefinition[] {
  const rows: DrawbackDefinition[] = [];
  if (type === "egotist") for (const damageThreshold of [15, 20, 25] as const) for (const rollThreshold of [9, 12, 15] as const) rows.push({ type, damageThreshold, rollThreshold });
  if (type === "glass-jaw" || type === "old-injury") for (const damageThreshold of [20, 25, 30] as const) for (const rollThreshold of [9, 12, 15] as const) rows.push({ type, damageThreshold, rollThreshold } as DrawbackDefinition);
  if (type === "stupid-moves") for (const intervalMinutes of [1, 2, 5] as const) for (const rollThreshold of [9, 12, 15] as const) rows.push({ type, intervalMinutes, rollThreshold });
  return rows.map((row) => withDrawbackAward(row, basePow)).sort((left, right) => drawbackAward(right, basePow) - drawbackAward(left, basePow));
}

export function maneuverCostEquation(move: ManeuverDefinition): string {
  const terms = move.kind === "hold"
    ? [
        `${move.damage.dice}x6`,
        signed(move.damage.flat),
        move.usesDamageBonus ? "+5 DAM BONUS" : "",
        move.submission ? "+5 submission" : "",
        `+${move.breakRating ?? 0} BRK`,
        move.illegal ? "-3 illegal" : "",
        `-${move.endCost} END`,
      ]
    : [
        `${move.damage.dice}x3`,
        signed(move.damage.flat),
        move.usesDamageBonus ? "+5 DAM BONUS" : "",
        move.finisher ? "+5 finisher" : "",
        move.whipEligible ? "+5 Irish Whip" : "",
        move.illegal ? "-3 illegal" : "",
        `-${move.endCost} END`,
      ];
  return `${terms.filter(Boolean).join(" ")} = ${maneuverConstructionCost(move)} points/level`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `${value}` : "";
}

export function validateManeuverDraft(draft: ManeuverDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("Maneuver name is required.");
  if (!/^[a-z0-9-]+$/.test(draft.id)) errors.push("Maneuver ID must use lowercase letters, numbers, and hyphens.");
  if (!Number.isInteger(draft.damageDice) || draft.damageDice < 1) errors.push("Damage dice must be a positive whole number.");
  if (!Number.isInteger(draft.damageFlat) || draft.damageFlat < -2 || draft.damageFlat > 2) errors.push("Flat damage must be between -2 and +2.");
  if (!Number.isInteger(draft.minAttribute) || draft.minAttribute < 0 || draft.minAttribute > 100) errors.push("Minimum attribute must be 0-100.");
  const maxEnd = draft.kind === "hold" ? 8 : 10;
  if (!Number.isInteger(draft.endCost) || draft.endCost < 1 || draft.endCost > maxEnd) errors.push(`${draft.kind === "hold" ? "Hold" : "Strike"} END must be 1-${maxEnd}.`);

  if (draft.kind === "hold") {
    const breakRating = draft.breakRating ?? 0;
    if (!Number.isInteger(breakRating) || breakRating < 1 || breakRating > 8) errors.push("Hold BRK must be 1-8.");
    if (draft.damageDice > 3) errors.push("Legal Hold base damage cannot exceed 3D6+2.");
    if (draft.illegal) {
      if (draft.minAttribute !== 0) errors.push("Illegal Holds have no minimum TEC.");
      if (draft.damageDice > 2 || (draft.damageDice === 2 && draft.damageFlat > 0)) errors.push("Illegal Hold base damage cannot exceed 2D6.");
      if (breakRating > 4) errors.push("Illegal Hold BRK cannot exceed 4.");
      if (draft.submission) errors.push("Illegal Holds cannot be Submission Holds.");
    } else {
      const mustBeSubmission = breakRating >= 5;
      if (Boolean(draft.submission) !== mustBeSubmission) errors.push("A legal Hold with BRK 5-8 must be a Submission Hold; BRK 1-4 must not be.");
      if (draft.submission && (draft.damageDice < 2 || (draft.damageDice === 2 && draft.damageFlat < 1))) errors.push("Submission Hold base damage must be at least 2D6+1.");
    }
    if (draft.whipEligible || draft.finisher || draft.throwsOut) errors.push("Strike-only flags cannot be applied to a Hold.");
  } else {
    if (draft.breakRating !== undefined || draft.submission) errors.push("Hold-only flags cannot be applied to a Strike.");
    if (draft.damageDice > 7 || (draft.damageDice === 7 && draft.damageFlat > 0)) errors.push("Strike base damage cannot exceed 7D6.");
    const mustBeFinisher = draft.damageDice >= 5;
    if (Boolean(draft.finisher) !== mustBeFinisher) errors.push("A Strike dealing 5D6 or more must be a finisher; lower damage must not be.");
    if (draft.finisher && draft.whipEligible) errors.push("A finisher cannot receive Irish Whip momentum.");
    if (draft.illegal) {
      if (draft.damageDice > 2 || (draft.damageDice === 2 && draft.damageFlat > 2)) errors.push("Illegal Strike base damage cannot exceed 2D6+2.");
      if (draft.finisher) errors.push("An illegal Strike cannot reach finisher damage.");
      if (draft.usesDamageBonus && draft.whipEligible) errors.push("An illegal Strike may use DAM BONUS or Irish Whip, not both.");
    }
  }

  if (!errors.length) {
    const move = draftToManeuver(draft);
    if (maneuverConstructionCost(move) <= 0) errors.push("Construction cost must be at least 1 point per level.");
  }
  return errors;
}

function draftToManeuver(draft: ManeuverDraft): ManeuverDefinition {
  const base: ManeuverDefinition = {
    id: draft.id.startsWith("custom-") ? draft.id : `custom-${draft.id}`,
    name: draft.name.trim(),
    kind: draft.kind,
    minAttribute: draft.minAttribute,
    damage: { dice: draft.damageDice, sides: 6, flat: draft.damageFlat },
    endCost: draft.endCost,
    listedCost: 0,
    usesDamageBonus: draft.usesDamageBonus,
    illegal: Boolean(draft.illegal),
    custom: true,
  };
  if (draft.kind === "hold") {
    base.breakRating = draft.breakRating;
    base.submission = Boolean(draft.submission);
  } else {
    base.whipEligible = Boolean(draft.whipEligible);
    base.finisher = Boolean(draft.finisher);
    base.throwsOut = Boolean(draft.throwsOut);
  }
  base.listedCost = maneuverConstructionCost(base);
  return base;
}

export function buildCustomManeuver(draft: ManeuverDraft): ManeuverDefinition {
  const errors = validateManeuverDraft(draft);
  if (errors.length) throw new Error(errors.join("\n"));
  return Object.freeze(draftToManeuver(draft));
}

export const M4_DATA_HASH = fnv1a32({
  version: M4_DATA_PACK_VERSION,
  heightWeight: HEIGHT_WEIGHT_BANDS,
  ageModifiers: AGE_MODIFIER_BANDS,
  ageCaps: AGE_CAPS,
  attributeCosts: ATTRIBUTE_ADVANCEMENT_COSTS,
  titleFame: TITLE_FAME,
  titleWp: TITLE_WP_BONUS,
  federation: FEDERATION_BANDS,
  championships: CHAMPIONSHIP_BANDS,
  debut: DEBUT_RESULT_BANDS,
  specialSkills: SPECIAL_SKILLS,
  egotist: EGOTIST_BASE,
  rollModifier: ROLL_MODIFIER,
  damageDrawback: DAMAGE_DRAWBACK_BASE,
  damageDrawbackRoll: DAMAGE_DRAWBACK_ROLL,
  stupidMoves: STUPID_MOVES_BASE,
});
