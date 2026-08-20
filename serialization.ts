import {
  LIGHT_HEAVYWEIGHT_LIMIT,
  SPECIAL_SKILLS,
  WRESTLER_SCHEMA_VERSION,
  drawbackAward,
  specialSkillCap,
} from "./career-rules";
import { baseAv } from "./derived";
import { MANEUVERS, RULESET_VERSION, maneuverConstructionCost } from "./rules";
import type { Attributes, DrawbackDefinition, ManeuverDefinition, SkillLevels, WrestlerCareerRecord } from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function whole(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function checkAttributes(value: unknown, path: string, errors: string[]): value is Attributes {
  if (!isObject(value)) { errors.push(`${path}: expected object.`); return false; }
  for (const key of ["pow", "agi", "qui", "tec", "end"] as const) if (!whole(value[key], 1, 100)) errors.push(`${path}.${key}: expected whole number 1-100.`);
  return true;
}

function checkSkills(value: unknown, path: string, errors: string[]): value is SkillLevels {
  if (!isObject(value)) { errors.push(`${path}: expected object.`); return false; }
  for (const key of Object.keys(SPECIAL_SKILLS) as Array<keyof SkillLevels>) if (!whole(value[key], 0, 100)) errors.push(`${path}.${key}: expected non-negative whole number.`);
  return true;
}

function checkManeuver(value: unknown, path: string, errors: string[]): value is ManeuverDefinition {
  if (!isObject(value)) { errors.push(`${path}: expected object.`); return false; }
  if (typeof value.id !== "string" || !value.id) errors.push(`${path}.id: required string.`);
  if (typeof value.name !== "string" || !value.name) errors.push(`${path}.name: required string.`);
  if (value.kind !== "hold" && value.kind !== "strike") errors.push(`${path}.kind: expected hold or strike.`);
  if (!isObject(value.damage) || !whole(value.damage.dice, 1, 7) || value.damage.sides !== 6 || !whole(value.damage.flat, -2, 2)) errors.push(`${path}.damage: expected valid D6 expression.`);
  if (!whole(value.minAttribute, 0, 100)) errors.push(`${path}.minAttribute: expected 0-100.`);
  if (!whole(value.endCost, 1, 10)) errors.push(`${path}.endCost: expected 1-10.`);
  if (!whole(value.listedCost, 1, 100)) errors.push(`${path}.listedCost: expected positive whole number.`);
  if (value.custom !== true) errors.push(`${path}.custom: custom records must be true.`);
  return true;
}

export function validateWrestlerRecord(value: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(value)) return ["record: expected JSON object."];
  if (value.schemaVersion !== WRESTLER_SCHEMA_VERSION) errors.push(`schemaVersion: unsupported ${String(value.schemaVersion)}; expected ${WRESTLER_SCHEMA_VERSION}.`);
  if (value.rulesetVersion !== RULESET_VERSION) errors.push(`rulesetVersion: incompatible ${String(value.rulesetVersion)}; expected ${RULESET_VERSION}.`);
  for (const key of ["id", "name", "affiliation"] as const) if (typeof value[key] !== "string" || !value[key]) errors.push(`${key}: required non-empty string.`);
  if (typeof value.epithet !== "string") errors.push("epithet: expected string.");
  if (value.side !== "fan-favorite" && value.side !== "rulebreaker") errors.push("side: expected fan-favorite or rulebreaker.");
  if (!whole(value.heightInches, 65, 88)) errors.push("heightInches: expected source-range whole number 65-88.");
  if (!whole(value.weight, 193, 495)) errors.push("weight: expected source-range whole number 193-495.");
  const attributesOk = checkAttributes(value.attributes, "attributes", errors);
  const skillsOk = checkSkills(value.skills, "skills", errors);
  if (!whole(value.fame, 0, 10000)) errors.push("fame: expected non-negative whole number.");
  if (!whole(value.careerWp, 0, 1_000_000_000)) errors.push("careerWp: expected non-negative whole number.");

  if (!isObject(value.customManeuvers)) errors.push("customManeuvers: expected object.");
  else for (const [id, move] of Object.entries(value.customManeuvers)) {
    if (checkManeuver(move, `customManeuvers.${id}`, errors)) {
      if (move.id !== id) errors.push(`customManeuvers.${id}.id: key mismatch.`);
      if (maneuverConstructionCost(move) !== move.listedCost) errors.push(`customManeuvers.${id}.listedCost: formula mismatch.`);
      if (MANEUVERS[id]) errors.push(`customManeuvers.${id}: conflicts with immutable source catalog.`);
    }
  }

  if (!isObject(value.maneuverLevels)) errors.push("maneuverLevels: expected object.");
  if (!Array.isArray(value.drawbacks)) errors.push("drawbacks: expected array.");
  if (!isObject(value.history)) errors.push("history: expected object.");
  if (!isObject(value.creation)) errors.push("creation: expected object.");

  if (isObject(value.history)) {
    const history = value.history;
    if (!whole(value.history.debutAge, 16, 100)) errors.push("history.debutAge: expected whole number.");
    if (!whole(value.history.currentAge, 16, 200)) errors.push("history.currentAge: expected whole number.");
    if (!Array.isArray(value.history.previousExperience)) errors.push("history.previousExperience: expected array.");
    if (!Array.isArray(value.history.priorTitles)) errors.push("history.priorTitles: expected array.");
    if (!whole(value.history.debutRoll, 1, 100)) errors.push("history.debutRoll: expected D100 result.");
    const creationAttributes = isObject(value.creation) && checkAttributes(value.creation.baseAttributes, "creation.baseAttributes", [])
      ? value.creation.baseAttributes as unknown as Attributes
      : attributesOk ? value.attributes as unknown as Attributes : undefined;
    if (creationAttributes && typeof history.debutRoll === "number" && whole(history.debutRoll, 1, 100) && typeof history.debutTotal === "number" && history.debutTotal !== history.debutRoll + baseAv(creationAttributes)) errors.push("history.debutTotal: must equal debut D100 + creation AV.");
    if (Array.isArray(history.previousExperience) && typeof history.debutAge === "number" && whole(history.debutAge, 16, 100) && typeof history.currentAge === "number" && history.currentAge !== history.debutAge + history.previousExperience.length * 2) errors.push("history.currentAge: every experience roll must add two years.");
    if (Array.isArray(value.history.priorTitles) && typeof value.weight === "number" && value.weight > LIGHT_HEAVYWEIGHT_LIMIT && value.history.priorTitles.some((title) => isObject(title) && title.lightHeavyweight === true)) errors.push("history.priorTitles: weight over 235 cannot retain light-heavyweight title.");
    if (Array.isArray(value.history.priorTitles) && typeof value.fame === "number") {
      const priorFame = value.history.priorTitles.reduce<number>((sum, row) => sum + (isObject(row) && typeof row.fame === "number" ? row.fame : 0), 0);
      if (value.fame < priorFame) errors.push("fame: cannot be below prior-title Fame.");
    }
  }

  if (isObject(value.creation)) {
    const creation = value.creation;
    if (!whole(value.creation.seed, -0x8000_0000, 0xffff_ffff)) errors.push("creation.seed: expected integer seed.");
    if (!whole(value.creation.physicalPointTotal, 210, 300)) errors.push("creation.physicalPointTotal: expected 10D10+200 range 210-300.");
    checkAttributes(creation.baseAttributes, "creation.baseAttributes", errors);
    for (const key of ["baseSkillPoints", "priorTitlePoints", "drawbackPoints", "spentSkillPoints"] as const) if (!whole(value.creation[key], 0, 10000)) errors.push(`creation.${key}: expected non-negative whole number.`);
    if (typeof value.creation.baseSkillPoints === "number" && typeof value.creation.priorTitlePoints === "number" && typeof value.creation.drawbackPoints === "number" && typeof value.creation.spentSkillPoints === "number" && value.creation.spentSkillPoints !== value.creation.baseSkillPoints + value.creation.priorTitlePoints + value.creation.drawbackPoints) errors.push("creation.spentSkillPoints: must equal the complete creation budget.");
    if (isObject(creation.baseAttributes) && typeof creation.physicalPointTotal === "number") {
      const sum = ["pow", "agi", "qui", "tec", "end"].reduce((total, key) => total + Number((creation.baseAttributes as Record<string, unknown>)[key]), 0);
      if (sum !== value.creation.physicalPointTotal) errors.push("creation.baseAttributes: total does not match generated physical pool.");
    }
  }

  if (isObject(value.maneuverLevels) && attributesOk) {
    const custom = isObject(value.customManeuvers) ? value.customManeuvers as Record<string, ManeuverDefinition> : {};
    const distinct = Object.values(value.maneuverLevels).filter((level) => typeof level === "number" && level > 0).length;
    const breadthCap = Math.min(8, distinct);
    for (const [id, level] of Object.entries(value.maneuverLevels)) {
      const move = custom[id] ?? MANEUVERS[id];
      if (!move) { errors.push(`maneuverLevels.${id}: unknown maneuver.`); continue; }
      if (!whole(level, 1, breadthCap)) errors.push(`maneuverLevels.${id}: expected level 1-${breadthCap}.`);
      if (move.illegal && value.side !== "rulebreaker") errors.push(`maneuverLevels.${id}: illegal purchase requires Rulebreaker side.`);
      const recordAttributes = value.attributes as unknown as Attributes;
      const attribute = move.kind === "hold" ? recordAttributes.tec : recordAttributes.pow;
      if (attribute < move.minAttribute) errors.push(`maneuverLevels.${id}: attribute prerequisite is not met.`);
    }
  }
  if (skillsOk && attributesOk && typeof value.fame === "number") for (const id of Object.keys(SPECIAL_SKILLS) as Array<keyof SkillLevels>) {
    const recordSkills = value.skills as unknown as SkillLevels;
    const recordAttributes = value.attributes as unknown as Attributes;
    const skill = SPECIAL_SKILLS[id];
    if (recordSkills[id] > specialSkillCap(id, recordAttributes.tec, value.fame)) errors.push(`skills.${id}: exceeds current cap.`);
    if (recordSkills[id] > 0 && skill.side && skill.side !== value.side) errors.push(`skills.${id}: side restriction is not met.`);
  }
  if (Array.isArray(value.drawbacks)) {
    const types: string[] = [];
    const creationPow = isObject(value.creation) && isObject(value.creation.baseAttributes) && typeof value.creation.baseAttributes.pow === "number" ? value.creation.baseAttributes.pow : attributesOk ? (value.attributes as unknown as Attributes).pow : 1;
    for (const [index, row] of value.drawbacks.entries()) {
      if (!isObject(row) || typeof row.type !== "string") { errors.push(`drawbacks.${index}: malformed.`); continue; }
      types.push(row.type);
      try {
        const expected = drawbackAward(row as DrawbackDefinition, creationPow);
        if (row.awardedPoints !== expected) errors.push(`drawbacks.${index}.awardedPoints: expected ${expected}.`);
      } catch {
        errors.push(`drawbacks.${index}: unsupported parameter combination.`);
      }
    }
    if (new Set(types).size !== types.length) errors.push("drawbacks: duplicate type.");
  }
  return errors;
}

export function serializeWrestler(record: WrestlerCareerRecord): string {
  const errors = validateWrestlerRecord(record);
  if (errors.length) throw new Error(`Cannot export invalid wrestler:\n${errors.join("\n")}`);
  return JSON.stringify(record, null, 2);
}

export function importWrestlerJson(json: string): WrestlerCareerRecord {
  let value: unknown;
  try { value = JSON.parse(json); }
  catch (error) { throw new Error(`Invalid JSON: ${String(error)}`); }
  const errors = validateWrestlerRecord(value);
  if (errors.length) throw new Error(`Wrestler import rejected:\n${errors.join("\n")}`);
  return structuredClone(value as unknown as WrestlerCareerRecord);
}

export function importReferenceRosterJson(json: string): WrestlerCareerRecord[] {
  let value: unknown;
  try { value = JSON.parse(json); }
  catch (error) { throw new Error(`Invalid reference-roster JSON: ${String(error)}`); }
  if (!isObject(value) || value.schemaVersion !== "asw91-reference-roster-v1" || !Array.isArray(value.wrestlers)) throw new Error("Reference roster must use schemaVersion asw91-reference-roster-v1 and a wrestlers array.");
  const records: WrestlerCareerRecord[] = [];
  const errors: string[] = [];
  for (const [index, candidate] of value.wrestlers.entries()) {
    const candidateErrors = validateWrestlerRecord(candidate);
    if (candidateErrors.length) errors.push(...candidateErrors.map((line) => `wrestlers.${index}.${line}`));
    else records.push(structuredClone(candidate as WrestlerCareerRecord));
  }
  if (errors.length) throw new Error(`Reference roster import rejected:\n${errors.join("\n")}`);
  return records;
}
