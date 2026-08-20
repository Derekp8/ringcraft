import {
  AGE_CAPS,
  ATTRIBUTE_ADVANCEMENT_COSTS,
  SPECIAL_SKILLS,
  TITLE_FAME,
  TITLE_WP_BONUS,
  allDrawbackOptions,
  drawbackAward,
  specialSkillCap,
  withDrawbackAward,
} from "./career-rules";
import { baseAv, baseDv, body, recoveryModifier, startingDamage } from "./derived";
import { canonicalHash64 } from "./hash";
import { MANEUVERS } from "./rules";
import { validateWrestlerRecord } from "./serialization";
import type {
  Attributes,
  DrawbackDefinition,
  MatchWpAward,
  MatchWpInput,
  ProgressionEvent,
  ProgressionIntent,
  ProgressionState,
  SkillLevels,
  WrestlerCareerRecord,
} from "./types";

function comparisonWp(value: number | number[]): number {
  if (Array.isArray(value)) {
    if (!value.length) throw new Error("A tag WP comparison needs at least one team member.");
    return value.reduce((total, row) => total + row, 0) / value.length;
  }
  return value;
}

export function calculateMatchWp(input: MatchWpInput): MatchWpAward {
  const ownComparisonWp = comparisonWp(input.ownWp);
  const opponentComparisonWp = comparisonWp(input.opponentWp);
  const difference = opponentComparisonWp - ownComparisonWp;
  const relation = difference >= 50 ? "stronger" : difference <= -50 ? "weaker" : "even";
  const terms: string[] = [];
  let amount = 0;

  if (input.result === "draw" || input.method === "time-limit-draw") {
    amount = 3;
    terms.push("draw +3");
  } else if (input.result === "win") {
    amount = 5;
    terms.push("win +5");
    if (relation === "weaker") { amount -= 1; terms.push("weaker opponent -1"); }
    if (relation === "stronger") { amount += 1; terms.push("stronger opponent +1"); }
    if (input.method === "disqualification") { amount -= 1; terms.push("win by DQ -1"); }
    if (input.method === "countout") { amount -= 1; terms.push("win by countout -1"); }
    if (input.titleWonOrRetained && (input.method === "pin" || input.method === "submission") && input.titleCategory) {
      const bonus = TITLE_WP_BONUS[input.titleCategory];
      amount += bonus;
      terms.push(`${input.titleCategory} +${bonus}`);
    }
  } else {
    amount = 2;
    terms.push("loss +2");
    if (relation === "weaker") { amount -= 1; terms.push("weaker opponent -1"); }
    if (input.method === "disqualification") {
      amount = 0;
      terms.push("loss by DQ forces 0");
    } else if (input.method === "countout") {
      amount -= 1;
      terms.push("loss by countout -1");
    }
  }
  amount = Math.max(0, amount);
  return { amount, ownComparisonWp, opponentComparisonWp, relation, formula: `${terms.join("; ")} = ${amount} WP` };
}

function progressionHash(state: ProgressionState): string {
  return canonicalHash64(state.record);
}

export function createProgressionState(record: WrestlerCareerRecord): ProgressionState {
  const errors = validateWrestlerRecord(record);
  if (errors.length) throw new Error(`Cannot begin progression with an invalid wrestler:\n${errors.join("\n")}`);
  return { schemaVersion: "asw91-progression-v1", initialRecord: structuredClone(record), record: structuredClone(record), events: [] };
}

function titleFameFor(category: NonNullable<MatchWpInput["titleCategory"]>): number {
  if (category === "world-heavyweight") return TITLE_FAME.worldHeavyweight;
  if (category === "world-tag") return TITLE_FAME.worldTag;
  if (category === "american-tag") return TITLE_FAME.tag;
  return TITLE_FAME.singles;
}

function requireWp(record: WrestlerCareerRecord, cost: number): void {
  if (record.careerWp < cost) throw new Error(`Requires ${cost} WP; only ${record.careerWp} is available.`);
}

function derivedLine(record: WrestlerCareerRecord): string {
  const definition = {
    id: record.id,
    teamId: "player" as const,
    name: record.name,
    epithet: record.epithet,
    side: record.side,
    weight: record.weight,
    attributes: record.attributes,
    maneuverLevels: record.maneuverLevels,
    skills: record.skills,
    drawbacks: record.drawbacks,
    fame: record.fame,
  };
  return `Derived: AV ${baseAv(record.attributes)}, DV ${baseDv(record.attributes)}, DAM PTS ${startingDamage(definition)}, BODY ${body(definition)}, REC 1D6+${recoveryModifier(definition)}.`;
}

function applyIntent(record: WrestlerCareerRecord, intent: ProgressionIntent, detail: string[]): string {
  if (intent.type === "award-match-wp") {
    const award = calculateMatchWp(intent.award);
    record.careerWp += award.amount;
    detail.push(award.formula, `WP ${record.careerWp - award.amount} + ${award.amount} = ${record.careerWp}.`);
    if (intent.award.titleWonOrRetained && intent.award.titleCategory) {
      const fame = titleFameFor(intent.award.titleCategory);
      record.fame += fame;
      detail.push(`Title Fame +${fame}; Fame is now ${record.fame}. No post-creation Fame-to-WP conversion occurred.`);
    }
    return `Awarded ${award.amount} WP.`;
  }

  if (intent.type === "increase-attribute") {
    const attribute = intent.attribute;
    const cost = ATTRIBUTE_ADVANCEMENT_COSTS[attribute];
    const capAge = AGE_CAPS[attribute];
    if (capAge !== null && record.history.currentAge >= capAge) throw new Error(`${attribute.toUpperCase()} cannot increase at age ${record.history.currentAge}; cap age is ${capAge}.`);
    if (record.attributes[attribute] >= 100) throw new Error(`${attribute.toUpperCase()} is already 100.`);
    requireWp(record, cost);
    const before = record.attributes[attribute];
    record.attributes[attribute] += 1;
    record.careerWp -= cost;
    detail.push(`${attribute.toUpperCase()} ${before} + 1 = ${record.attributes[attribute]}; cost ${cost} WP.`, derivedLine(record));
    return `Increased ${attribute.toUpperCase()} to ${record.attributes[attribute]}.`;
  }

  if (intent.type === "increase-skill") {
    const skill = SPECIAL_SKILLS[intent.skill];
    if (skill.side && skill.side !== record.side) throw new Error(`${skill.label} is restricted to ${skill.side}.`);
    const cap = specialSkillCap(intent.skill, record.attributes.tec, record.fame);
    if (record.skills[intent.skill] >= cap) throw new Error(`${skill.label} is at its current cap ${cap}.`);
    requireWp(record, skill.cost);
    record.skills[intent.skill] += 1;
    record.careerWp -= skill.cost;
    detail.push(`${skill.label} +1 for ${skill.cost} WP; level ${record.skills[intent.skill]} of cap ${cap}.`);
    return `Increased ${skill.label}.`;
  }

  if (intent.type === "increase-maneuver") {
    const move = record.customManeuvers[intent.maneuverId] ?? MANEUVERS[intent.maneuverId];
    if (!move) throw new Error(`Unknown maneuver ${intent.maneuverId}.`);
    if (move.illegal && record.side !== "rulebreaker") throw new Error("Only a Rulebreaker may buy an illegal maneuver level.");
    const attribute = move.kind === "hold" ? record.attributes.tec : record.attributes.pow;
    if (attribute < move.minAttribute) throw new Error(`${move.name} requires ${move.kind === "hold" ? "TEC" : "POW"} ${move.minAttribute}; has ${attribute}.`);
    const current = record.maneuverLevels[move.id] ?? 0;
    const distinct = Object.values(record.maneuverLevels).filter((level) => level > 0).length + (current === 0 ? 1 : 0);
    const cap = Math.min(8, distinct);
    if (current + 1 > cap) throw new Error(`${move.name} level ${current + 1} would exceed breadth cap ${cap}.`);
    requireWp(record, move.listedCost);
    record.maneuverLevels[move.id] = current + 1;
    record.careerWp -= move.listedCost;
    detail.push(`${move.name} level ${current} -> ${current + 1}; ${move.listedCost} WP; breadth cap ${cap}.`);
    return `Increased ${move.name}.`;
  }

  const index = record.drawbacks.findIndex((row) => row.type === intent.drawbackType);
  if (index < 0) throw new Error(`Drawback ${intent.drawbackType} is not present.`);
  const current = record.drawbacks[index];
  const creationPow = record.creation.baseAttributes.pow;
  const currentAward = drawbackAward(current, creationPow);
  const replacement = intent.replacement ? withDrawbackAward(intent.replacement, creationPow) : null;
  if (replacement && replacement.type !== current.type) throw new Error("A drawback reduction must keep the same type.");
  const replacementAward = replacement ? drawbackAward(replacement, creationPow) : 0;
  if (replacementAward >= currentAward) throw new Error(`Replacement must reduce the drawback below ${currentAward} points.`);
  const cost = currentAward - replacementAward;
  requireWp(record, cost);
  record.careerWp -= cost;
  if (replacement) record.drawbacks[index] = replacement;
  else record.drawbacks.splice(index, 1);
  detail.push(`${current.type}: ${currentAward} -> ${replacementAward} drawback points; cost ${cost} WP point-for-point.`);
  return replacement ? `Reduced ${current.type}.` : `Removed ${current.type}.`;
}

export function applyProgression(source: ProgressionState, intent: ProgressionIntent): ProgressionState {
  const draft = structuredClone(source);
  const preStateHash = progressionHash(draft);
  const detail: string[] = [];
  const summary = applyIntent(draft.record, intent, detail);
  if (draft.record.careerWp < 0) throw new Error("Progression transaction would make WP negative.");
  const validationErrors = validateWrestlerRecord(draft.record);
  if (validationErrors.length) throw new Error(`Progression transaction rejected:\n${validationErrors.join("\n")}`);
  const postStateHash = progressionHash(draft);
  const event: ProgressionEvent = {
    sequence: draft.events.length + 1,
    type: intent.type,
    intent: structuredClone(intent),
    summary,
    detail,
    preStateHash,
    postStateHash,
  };
  draft.events.push(event);
  return draft;
}

export function replayProgression(source: ProgressionState): ProgressionState {
  let replay = createProgressionState(source.initialRecord);
  for (const event of source.events) replay = applyProgression(replay, event.intent);
  return replay;
}

export function drawbackReductionOptions(record: WrestlerCareerRecord, type: DrawbackDefinition["type"]): Array<{ replacement: DrawbackDefinition | null; cost: number; label: string }> {
  const current = record.drawbacks.find((row) => row.type === type);
  if (!current) return [];
  const creationPow = record.creation.baseAttributes.pow;
  const currentAward = drawbackAward(current, creationPow);
  const options: Array<{ replacement: DrawbackDefinition | null; cost: number; label: string }> = allDrawbackOptions(type, creationPow)
    .filter((row) => drawbackAward(row, creationPow) < currentAward)
    .map((row) => ({ replacement: row, cost: currentAward - drawbackAward(row, creationPow), label: `${drawbackAward(row, creationPow)}-point ${type}` }));
  options.push({ replacement: null, cost: currentAward, label: `Remove ${type}` });
  return options;
}

export function canIncreaseAttribute(record: WrestlerCareerRecord, attribute: keyof Attributes): boolean {
  const age = AGE_CAPS[attribute];
  return record.attributes[attribute] < 100 && (age === null || record.history.currentAge < age) && record.careerWp >= ATTRIBUTE_ADVANCEMENT_COSTS[attribute];
}

export function canIncreaseSkill(record: WrestlerCareerRecord, skill: keyof SkillLevels): boolean {
  const definition = SPECIAL_SKILLS[skill];
  return (!definition.side || definition.side === record.side) && record.skills[skill] < specialSkillCap(skill, record.attributes.tec, record.fame) && record.careerWp >= definition.cost;
}
