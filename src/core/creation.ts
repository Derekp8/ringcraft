import {
  AGE_MODIFIER_BANDS,
  BASE_CREATION_SKILL_POINTS,
  CHAMPIONSHIP_BANDS,
  DEBUT_RESULT_BANDS,
  FEDERATION_BANDS,
  HEIGHT_WEIGHT_BANDS,
  LIGHT_HEAVYWEIGHT_LIMIT,
  M4_DATA_PACK_VERSION,
  SPECIAL_SKILLS,
  WRESTLER_SCHEMA_VERSION,
  drawbackAward,
  emptySkillLevels,
  specialSkillCap,
  withDrawbackAward,
} from "./career-rules";
import { baseAv, baseDv, body, damageBonus, movesPerMinute, recoveryModifier, startingDamage } from "./derived";
import { canonicalHash64, fnv1a32 } from "./hash";
import { createRng, rollRngDie } from "./prng";
import { MANEUVERS, RULESET_VERSION } from "./rules";
import type {
  Attributes,
  CareerHistory,
  CreationEvent,
  CreationSession,
  DieRoll,
  DrawbackDefinition,
  ManeuverDefinition,
  PreviousExperienceRoll,
  Side,
  SkillLevels,
  TeamId,
  WrestlerCareerRecord,
  WrestlerDefinition,
} from "./types";

function sessionHash(session: CreationSession): string {
  const { events: _events, ...state } = session;
  return canonicalHash64(state);
}

function transact(
  source: CreationSession,
  type: string,
  summary: string,
  apply: (draft: CreationSession, dice: DieRoll[], detail: string[]) => void,
  input: Record<string, unknown> = {},
): CreationSession {
  if (source.finalized) throw new Error("The creation session is finalized and immutable.");
  const draft = structuredClone(source);
  const preStateHash = sessionHash(draft);
  const dice: DieRoll[] = [];
  const detail: string[] = [];
  apply(draft, dice, detail);
  const postStateHash = sessionHash(draft);
  const event: CreationEvent = {
    sequence: draft.events.length + 1,
    type,
    input: structuredClone(input),
    summary,
    detail,
    dice,
    preStateHash,
    postStateHash,
  };
  draft.events.push(event);
  return draft;
}

function balancedAttributes(total: number): Attributes {
  const base = Math.floor(total / 5);
  const remainder = total - base * 5;
  const values = Array.from({ length: 5 }, (_, index) => base + (index < remainder ? 1 : 0));
  return { pow: values[0], agi: values[1], qui: values[2], tec: values[3], end: values[4] };
}

export function createCreationSession(seed = 1991, scriptedPhysicalRolls: number[] = []): CreationSession {
  const initial: CreationSession = {
    schemaVersion: "asw91-creation-session-v1",
    rulesetVersion: RULESET_VERSION,
    seed,
    rng: createRng(seed, scriptedPhysicalRolls),
    name: "New Challenger",
    epithet: "",
    affiliation: "Independent",
    side: "fan-favorite",
    physicalPointTotal: 0,
    attributes: { pow: 1, agi: 1, qui: 1, tec: 1, end: 1 },
    heightInches: null,
    weight: null,
    history: null,
    maneuverLevels: {},
    customManeuvers: {},
    skills: emptySkillLevels(),
    drawbacks: [],
    events: [],
    finalized: null,
  };
  return transact(initial, "physical-points", "Generated the physical-attribute pool.", (draft, dice, detail) => {
    let total = 200;
    for (let index = 0; index < 10; index += 1) total += rollRngDie(draft.rng, 10, `physical points ${index + 1}/10`, dice);
    draft.physicalPointTotal = total;
    draft.attributes = balancedAttributes(total);
    detail.push(`10D10 + 200 = ${total}.`, `Initial even distribution: ${Object.values(draft.attributes).join(" / ")}.`);
  }, { seed, scriptedPhysicalRolls: [...scriptedPhysicalRolls] });
}

export function setCreationIdentity(
  source: CreationSession,
  patch: Partial<Pick<CreationSession, "name" | "epithet" | "affiliation">>,
): CreationSession {
  return transact(source, "identity", "Updated wrestler identity.", (draft, _dice, detail) => {
    if (patch.name !== undefined) draft.name = patch.name;
    if (patch.epithet !== undefined) draft.epithet = patch.epithet;
    if (patch.affiliation !== undefined) draft.affiliation = patch.affiliation;
    detail.push(`Name: ${draft.name || "(blank)"}.`, `Affiliation: ${draft.affiliation || "(blank)"}.`);
  }, { patch: structuredClone(patch) });
}

export function setCreationAttributes(source: CreationSession, attributes: Attributes): CreationSession {
  return transact(source, "attributes", "Updated physical-attribute allocation.", (draft, _dice, detail) => {
    draft.attributes = { ...attributes };
    draft.history = null;
    draft.maneuverLevels = {};
    draft.skills = emptySkillLevels();
    draft.drawbacks = [];
    detail.push(
      `POW ${attributes.pow}, AGI ${attributes.agi}, QUI ${attributes.qui}, TEC ${attributes.tec}, END ${attributes.end}.`,
      "History and purchases were cleared because their legality or cost depends on attributes.",
    );
  }, { attributes: structuredClone(attributes) });
}

export function setCreationSide(source: CreationSession, side: Side): CreationSession {
  return transact(source, "side", `Selected ${side}.`, (draft, _dice, detail) => {
    draft.side = side;
    draft.maneuverLevels = {};
    draft.skills = emptySkillLevels();
    detail.push("Purchases were cleared so no side-locked level can survive the change.");
  }, { side });
}

export function rollCreationStature(source: CreationSession): CreationSession {
  return transact(source, "stature-roll", "Rolled height and weight.", (draft, dice, detail) => {
    const percentile = rollRngDie(draft.rng, 100, "height/weight percentile", dice);
    const band = HEIGHT_WEIGHT_BANDS.find((row) => percentile >= row.min && percentile <= row.max);
    if (!band) throw new Error(`No height/weight band for ${percentile}.`);
    const addedHeight = rollRngDie(draft.rng, 6, "height inches", dice);
    let weight = band.weightBase;
    for (let index = 0; index < band.weightDice; index += 1) weight += rollRngDie(draft.rng, band.weightSides, `weight ${index + 1}/${band.weightDice}`, dice);
    draft.heightInches = band.baseHeightInches + addedHeight;
    draft.weight = weight;
    detail.push(
      `Percentile ${percentile}: base height ${band.baseHeightInches} in + D6 ${addedHeight} = ${draft.heightInches} in.`,
      `Weight ${band.weightBase} + ${band.weightDice}D${band.weightSides} = ${weight} lb.`,
    );
  });
}

export function setCreationStature(source: CreationSession, heightInches: number, weight: number): CreationSession {
  return transact(source, "stature-manual", "Set height and weight manually.", (draft, _dice, detail) => {
    draft.heightInches = heightInches;
    draft.weight = weight;
    detail.push(`Height ${heightInches} in; weight ${weight} lb.`);
  }, { heightInches, weight });
}

function debutResult(total: number): CareerHistory["debutResult"] {
  const row = DEBUT_RESULT_BANDS.find((band) => total >= band.min && total <= band.max);
  if (!row) throw new Error(`No debut-result row for ${total}.`);
  return row.result;
}

export function rollCreationHistory(source: CreationSession): CreationSession {
  return transact(source, "history-roll", "Rolled debut age and debut result.", (draft, dice, detail) => {
    const agePercentile = rollRngDie(draft.rng, 100, "debut age percentile", dice);
    const ageBand = AGE_MODIFIER_BANDS.find((row) => agePercentile >= row.min && agePercentile <= row.max);
    if (!ageBand) throw new Error(`No age band for ${agePercentile}.`);
    let debutAge = 22;
    if (ageBand.direction !== 0) debutAge += ageBand.direction * rollRngDie(draft.rng, 6, "debut age modifier", dice);
    const rawDebutRoll = rollRngDie(draft.rng, 100, "debut match percentile", dice);
    const av = baseAv(draft.attributes);
    const total = rawDebutRoll + av;
    draft.history = {
      debutAge,
      currentAge: debutAge,
      previousExperience: [],
      debutRoll: rawDebutRoll,
      debutTotal: total,
      debutResult: debutResult(total),
      priorTitles: [],
    };
    detail.push(
      `Debut age: 22 ${ageBand.direction < 0 ? "-" : ageBand.direction > 0 ? "+" : "+"} modifier = ${debutAge}.`,
      `Debut result: D100 ${rawDebutRoll} + AV ${av} = ${total} (${draft.history.debutResult}).`,
    );
  });
}

function resolveTitle(circuitId: string, rawRoll: number, av: number): NonNullable<PreviousExperienceRoll["title"]> {
  const total = rawRoll + av;
  const row = CHAMPIONSHIP_BANDS[circuitId]?.find((candidate) => total >= candidate.min && total <= candidate.max);
  if (!row) throw new Error(`No championship row for ${circuitId} total ${total}.`);
  const { min: _min, max: _max, ...titleRow } = row;
  return { ...titleRow, circuitId };
}

export function addPreviousExperience(source: CreationSession): CreationSession {
  if (!source.history) throw new Error("Roll debut history before adding previous experience.");
  if (source.weight === null) throw new Error("Set height and weight before adding previous experience.");
  return transact(source, "previous-experience", "Resolved one two-year previous-experience period.", (draft, dice, detail) => {
    const history = draft.history!;
    const federationRoll = rollRngDie(draft.rng, 100, "previous federation percentile", dice);
    const federation = FEDERATION_BANDS.find((row) => federationRoll >= row.min && federationRoll <= row.max);
    if (!federation) throw new Error(`No federation row for ${federationRoll}.`);
    const experience: PreviousExperienceRoll = {
      federationRoll,
      circuitId: federation.id,
      circuitLabel: federation.label,
      rerolls: [],
    };
    history.currentAge += 2;
    if (federation.id) {
      let raw = rollRngDie(draft.rng, 100, "previous championship percentile", dice);
      const firstRaw = raw;
      let selected = resolveTitle(federation.id, raw, baseAv(draft.attributes));
      let guard = 0;
      while (selected.lightHeavyweight && draft.weight! > LIGHT_HEAVYWEIGHT_LIMIT) {
        raw = rollRngDie(draft.rng, 100, "ineligible light-heavyweight reroll", dice);
        experience.rerolls.push(raw);
        selected = resolveTitle(federation.id, raw, baseAv(draft.attributes));
        guard += 1;
        if (guard > 1000) throw new Error("Light-heavyweight reroll safety cap exceeded.");
      }
      experience.championshipRoll = firstRaw;
      experience.championshipTotal = raw + baseAv(draft.attributes);
      experience.title = selected;
      history.priorTitles.push(selected);
      detail.push(`${federationRoll}: ${federation.label}; championship total ${experience.championshipTotal}: ${selected.label}.`);
      if (experience.rerolls.length) detail.push(`Ineligible light-heavyweight rerolls: ${experience.rerolls.join(", ")}.`);
    } else {
      detail.push(`${federationRoll}: no prior circuit or title.`);
    }
    history.previousExperience.push(experience);
    detail.push(`Every roll adds two years; current age is ${history.currentAge}.`);
  });
}

export function setCreationDrawback(source: CreationSession, drawback: DrawbackDefinition | null): CreationSession {
  return transact(source, "drawback", drawback ? `Selected ${drawback.type}.` : "Removed a drawback.", (draft, _dice, detail) => {
    const type = drawback?.type;
    if (type) {
      const awarded = withDrawbackAward(drawback, draft.attributes.pow);
      draft.drawbacks = [...draft.drawbacks.filter((row) => row.type !== type), awarded];
      detail.push(`Award: ${drawbackAward(awarded, draft.attributes.pow)} creation points from base POW ${draft.attributes.pow}.`);
    } else {
      detail.push("No type was supplied; selections were unchanged.");
    }
  }, { action: "set", drawback: drawback ? structuredClone(drawback) : null });
}

export function removeCreationDrawback(source: CreationSession, type: DrawbackDefinition["type"]): CreationSession {
  return transact(source, "drawback", `Removed ${type}.`, (draft, _dice, detail) => {
    draft.drawbacks = draft.drawbacks.filter((row) => row.type !== type);
    detail.push("Creation budget was recalculated.");
  }, { action: "remove", drawbackType: type });
}

export function setCreationManeuverLevel(source: CreationSession, maneuverId: string, level: number): CreationSession {
  return transact(source, "maneuver-purchase", `Set ${maneuverId} to level ${level}.`, (draft, _dice, detail) => {
    if (level <= 0) delete draft.maneuverLevels[maneuverId];
    else draft.maneuverLevels[maneuverId] = level;
    detail.push(`Purchased level is ${Math.max(0, level)}.`);
  }, { maneuverId, level });
}

export function setCreationSkillLevel(source: CreationSession, skill: keyof SkillLevels, level: number): CreationSession {
  return transact(source, "skill-purchase", `Set ${SPECIAL_SKILLS[skill].label} to level ${level}.`, (draft, _dice, detail) => {
    draft.skills[skill] = Math.max(0, level);
    detail.push(`${SPECIAL_SKILLS[skill].cost} points per level; cap ${specialSkillCap(skill, draft.attributes.tec, creationFame(draft))}.`);
  }, { skill, level });
}

export function addCreationCustomManeuver(source: CreationSession, move: ManeuverDefinition): CreationSession {
  if (!move.custom) throw new Error("Only a validated custom maneuver may be added.");
  if (MANEUVERS[move.id]) throw new Error(`Custom maneuver ID conflicts with source catalog: ${move.id}.`);
  return transact(source, "custom-maneuver", `Added custom maneuver ${move.name}.`, (draft, _dice, detail) => {
    draft.customManeuvers[move.id] = structuredClone(move);
    detail.push(`Cost equation resolves to ${move.listedCost} points per level.`);
  }, { move: structuredClone(move) });
}

export function creationFame(session: CreationSession): number {
  return session.history?.priorTitles.reduce((total, titleRow) => total + titleRow.fame, 0) ?? 0;
}

export function creationPointSummary(session: CreationSession): {
  available: number;
  spent: number;
  remaining: number;
  priorTitlePoints: number;
  drawbackPoints: number;
} {
  const fame = creationFame(session);
  const priorTitlePoints = fame * 10;
  const drawbackPoints = session.drawbacks.reduce((total, drawback) => total + drawbackAward(drawback, session.attributes.pow), 0);
  const catalog = { ...MANEUVERS, ...session.customManeuvers };
  const maneuverSpend = Object.entries(session.maneuverLevels).reduce((total, [id, level]) => total + (catalog[id]?.listedCost ?? 0) * level, 0);
  const skillSpend = (Object.keys(session.skills) as Array<keyof SkillLevels>).reduce((total, id) => total + SPECIAL_SKILLS[id].cost * session.skills[id], 0);
  const available = BASE_CREATION_SKILL_POINTS + priorTitlePoints + drawbackPoints;
  const spent = maneuverSpend + skillSpend;
  return { available, spent, remaining: available - spent, priorTitlePoints, drawbackPoints };
}

function sourceMoveEligible(session: CreationSession, move: ManeuverDefinition): boolean {
  if (move.illegal && session.side !== "rulebreaker") return false;
  const attribute = move.kind === "hold" ? session.attributes.tec : session.attributes.pow;
  return attribute >= move.minAttribute;
}

export function autoAllocateCreationPoints(source: CreationSession): CreationSession {
  return transact(source, "auto-purchase", "Built a legal exact-spend starter package.", (draft, _dice, detail) => {
    draft.maneuverLevels = {};
    draft.skills = emptySkillLevels();
    const target = creationPointSummary(draft).available;
    type Token = { key: string; cost: number; kind: "move" | "skill"; id: string };
    const tokens: Token[] = [];
    for (const move of Object.values({ ...MANEUVERS, ...draft.customManeuvers })) {
      if (sourceMoveEligible(draft, move) && move.listedCost > 0 && move.listedCost <= target) tokens.push({ key: `move:${move.id}`, cost: move.listedCost, kind: "move", id: move.id });
    }
    for (const skill of Object.values(SPECIAL_SKILLS)) {
      if (skill.side && skill.side !== draft.side) continue;
      const cap = specialSkillCap(skill.id, draft.attributes.tec, creationFame(draft));
      for (let level = 1; level <= cap; level += 1) tokens.push({ key: `skill:${skill.id}:${level}`, cost: skill.cost, kind: "skill", id: skill.id });
    }
    tokens.sort((left, right) => right.cost - left.cost || left.key.localeCompare(right.key));
    const best: Array<Token[] | undefined> = Array(target + 1).fill(undefined);
    best[0] = [];
    for (const token of tokens) {
      for (let sum = target; sum >= token.cost; sum -= 1) {
        const previous = best[sum - token.cost];
        if (!previous) continue;
        const candidate = [...previous, token];
        if (!best[sum] || candidate.length < best[sum]!.length) best[sum] = candidate;
      }
    }
    const selected = best[target];
    if (!selected) throw new Error(`No exact legal purchase package found for ${target} points.`);
    for (const token of selected) {
      if (token.kind === "move") draft.maneuverLevels[token.id] = 1;
      else draft.skills[token.id as keyof SkillLevels] += 1;
    }
    detail.push(
      `Spent ${target} of ${target} points exactly.`,
      `${Object.keys(draft.maneuverLevels).length} distinct maneuvers; ${Object.values(draft.skills).reduce((a, b) => a + b, 0)} special-skill levels.`,
    );
  });
}

export function creationDerivedPreview(session: CreationSession): Record<string, number | string | boolean> {
  if (session.weight === null) return {};
  const definition = sessionToDefinition(session, "preview", "player");
  const bonus = damageBonus(definition);
  return {
    av: baseAv(session.attributes),
    dv: baseDv(session.attributes),
    body: body(definition),
    damagePoints: startingDamage(definition),
    endurance: session.attributes.end,
    recovery: `1D6 + ${recoveryModifier(definition)}`,
    damageBonus: bonus.dice ? `${bonus.dice}D${bonus.sides}${bonus.flat ? `+${bonus.flat}` : ""}` : `${bonus.flat}`,
    movesPerMinute: movesPerMinute(definition),
    lightHeavyweightEligible: session.weight <= LIGHT_HEAVYWEIGHT_LIMIT,
  };
}

function maneuverCatalog(session: CreationSession): Record<string, ManeuverDefinition> {
  return { ...MANEUVERS, ...session.customManeuvers };
}

export function validateCreationSession(session: CreationSession): string[] {
  const errors: string[] = [];
  const attributes = Object.entries(session.attributes) as Array<[keyof Attributes, number]>;
  const total = attributes.reduce((sum, [, value]) => sum + value, 0);
  if (total !== session.physicalPointTotal) errors.push(`attributes: assigned ${total}; generated pool is ${session.physicalPointTotal}.`);
  for (const [key, value] of attributes) if (!Number.isInteger(value) || value < 1 || value > 100) errors.push(`attributes.${key}: must be a whole number from 1 to 100.`);
  if (!session.name.trim()) errors.push("identity.name: required.");
  if (!session.affiliation.trim()) errors.push("identity.affiliation: required.");
  if (session.heightInches === null || !Number.isInteger(session.heightInches) || session.heightInches < 65 || session.heightInches > 88) errors.push("physical.heightInches: must be 65-88, the source chart's possible range.");
  if (session.weight === null || !Number.isInteger(session.weight) || session.weight < 193 || session.weight > 495) errors.push("physical.weight: must be 193-495, the source chart's possible range.");
  if (!session.history) errors.push("history: debut age and result have not been rolled.");
  if (session.history) {
    if (session.history.currentAge !== session.history.debutAge + session.history.previousExperience.length * 2) errors.push("history.currentAge: every previous-experience roll must add exactly two years.");
    const expectedDebutTotal = session.history.debutRoll + baseAv(session.attributes);
    if (session.history.debutTotal !== expectedDebutTotal) errors.push(`history.debutTotal: expected D100 ${session.history.debutRoll} + AV ${baseAv(session.attributes)} = ${expectedDebutTotal}.`);
    const fame = session.history.priorTitles.reduce((sum, row) => sum + row.fame, 0);
    if (fame !== creationFame(session)) errors.push("history.fame: prior-title sum mismatch.");
    if ((session.weight ?? 0) > LIGHT_HEAVYWEIGHT_LIMIT && session.history.priorTitles.some((row) => row.lightHeavyweight)) errors.push("history.priorTitles: a wrestler over 235 lb cannot retain a light-heavyweight result.");
  }

  const drawbackTypes = session.drawbacks.map((row) => row.type);
  if (new Set(drawbackTypes).size !== drawbackTypes.length) errors.push("drawbacks: each type may be selected only once.");
  for (const drawback of session.drawbacks) {
    const expected = drawbackAward(drawback, session.attributes.pow);
    if (drawback.awardedPoints !== undefined && drawback.awardedPoints !== expected) errors.push(`drawbacks.${drawback.type}: awarded points ${drawback.awardedPoints} should be ${expected}.`);
  }

  const catalog = maneuverCatalog(session);
  const distinct = Object.values(session.maneuverLevels).filter((level) => level > 0).length;
  const breadthCap = Math.min(8, distinct);
  for (const [id, level] of Object.entries(session.maneuverLevels)) {
    const move = catalog[id];
    if (!move) { errors.push(`maneuvers.${id}: unknown definition.`); continue; }
    if (!Number.isInteger(level) || level < 1) errors.push(`maneuvers.${id}: purchased level must be a positive whole number.`);
    if (level > breadthCap) errors.push(`maneuvers.${id}: level ${level} exceeds breadth cap ${breadthCap}.`);
    if (move.illegal && session.side !== "rulebreaker") errors.push(`maneuvers.${id}: only a Rulebreaker may buy illegal maneuver levels.`);
    const attribute = move.kind === "hold" ? session.attributes.tec : session.attributes.pow;
    if (attribute < move.minAttribute) errors.push(`maneuvers.${id}: requires ${move.kind === "hold" ? "TEC" : "POW"} ${move.minAttribute}; has ${attribute}.`);
    if (move.listedCost < 1) errors.push(`maneuvers.${id}: invalid non-positive cost.`);
  }
  for (const [id, level] of Object.entries(session.skills) as Array<[keyof SkillLevels, number]>) {
    const definition = SPECIAL_SKILLS[id];
    if (!Number.isInteger(level) || level < 0) errors.push(`skills.${id}: level must be a non-negative whole number.`);
    if (level > specialSkillCap(id, session.attributes.tec, creationFame(session))) errors.push(`skills.${id}: level ${level} exceeds cap ${specialSkillCap(id, session.attributes.tec, creationFame(session))}.`);
    if (level > 0 && definition.side && definition.side !== session.side) errors.push(`skills.${id}: ${definition.label} purchase is locked to ${definition.side}.`);
  }
  const points = creationPointSummary(session);
  if (points.remaining !== 0) errors.push(`creationPoints: ${points.remaining > 0 ? `${points.remaining} remain unspent` : `${-points.remaining} overspent`}.`);
  return errors;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "wrestler";
}

export function finalizeCreationSession(source: CreationSession): CreationSession {
  const errors = validateCreationSession(source);
  if (errors.length) throw new Error(`Creation validation failed:\n${errors.join("\n")}`);
  return transact(source, "finalize", "Finalized a legal wrestler record.", (draft, _dice, detail) => {
    const points = creationPointSummary(draft);
    const history = structuredClone(draft.history!);
    const fame = creationFame(draft);
    const stableId = `${slug(draft.name)}-${fnv1a32({ seed: draft.seed, name: draft.name, attributes: draft.attributes, history, maneuvers: draft.maneuverLevels, skills: draft.skills })}`;
    const record: WrestlerCareerRecord = {
      schemaVersion: WRESTLER_SCHEMA_VERSION,
      rulesetVersion: RULESET_VERSION,
      id: stableId,
      name: draft.name.trim(),
      epithet: draft.epithet.trim(),
      side: draft.side,
      affiliation: draft.affiliation.trim(),
      heightInches: draft.heightInches!,
      weight: draft.weight!,
      attributes: structuredClone(draft.attributes),
      maneuverLevels: structuredClone(draft.maneuverLevels),
      customManeuvers: structuredClone(draft.customManeuvers),
      skills: structuredClone(draft.skills),
      drawbacks: draft.drawbacks.map((row) => withDrawbackAward(row, draft.attributes.pow)),
      history,
      fame,
      careerWp: 0,
      creation: {
        seed: draft.seed,
        physicalPointTotal: draft.physicalPointTotal,
        baseAttributes: structuredClone(draft.attributes),
        baseSkillPoints: BASE_CREATION_SKILL_POINTS,
        priorTitlePoints: points.priorTitlePoints,
        drawbackPoints: points.drawbackPoints,
        spentSkillPoints: points.spent,
      },
    };
    draft.finalized = record;
    detail.push(
      `Record ${record.id}; schema ${record.schemaVersion}; Rules Data Pack ${M4_DATA_PACK_VERSION}.`,
      `All ${points.available} creation points were spent; Fame ${fame}; career WP begins at 0.`,
    );
  });
}

export function sessionToDefinition(session: CreationSession, id: string, teamId: TeamId): WrestlerDefinition {
  return {
    id,
    teamId,
    name: session.name,
    epithet: session.epithet,
    side: session.side,
    weight: session.weight ?? 193,
    heightInches: session.heightInches ?? 65,
    attributes: structuredClone(session.attributes),
    maneuverLevels: structuredClone(session.maneuverLevels),
    customManeuvers: structuredClone(session.customManeuvers),
    skills: structuredClone(session.skills),
    drawbacks: structuredClone(session.drawbacks),
    fame: creationFame(session),
    age: session.history?.currentAge,
    careerWp: 0,
  };
}

export function careerRecordToDefinition(record: WrestlerCareerRecord, id: string, teamId: TeamId): WrestlerDefinition {
  return {
    id,
    teamId,
    name: record.name,
    epithet: record.epithet,
    side: record.side,
    weight: record.weight,
    heightInches: record.heightInches,
    attributes: structuredClone(record.attributes),
    maneuverLevels: structuredClone(record.maneuverLevels),
    customManeuvers: structuredClone(record.customManeuvers),
    skills: structuredClone(record.skills),
    drawbacks: structuredClone(record.drawbacks),
    fame: record.fame,
    age: record.history.currentAge,
    careerWp: record.careerWp,
    sourceRecordId: record.id,
  };
}

export function replayCreationSession(source: CreationSession): CreationSession {
  const first = source.events[0];
  const initialScript = Array.isArray(first?.input.scriptedPhysicalRolls)
    ? first.input.scriptedPhysicalRolls.filter((value): value is number => typeof value === "number")
    : [];
  let replay = createCreationSession(source.seed, initialScript);
  for (const event of source.events.slice(1)) {
    const input = event.input;
    if (event.type === "identity") replay = setCreationIdentity(replay, (input.patch ?? {}) as Partial<Pick<CreationSession, "name" | "epithet" | "affiliation">>);
    else if (event.type === "attributes") replay = setCreationAttributes(replay, structuredClone(input.attributes as Attributes));
    else if (event.type === "side") replay = setCreationSide(replay, input.side as Side);
    else if (event.type === "stature-roll") replay = rollCreationStature(replay);
    else if (event.type === "stature-manual") replay = setCreationStature(replay, Number(input.heightInches), Number(input.weight));
    else if (event.type === "history-roll") replay = rollCreationHistory(replay);
    else if (event.type === "previous-experience") replay = addPreviousExperience(replay);
    else if (event.type === "drawback" && input.action === "set") replay = setCreationDrawback(replay, input.drawback as DrawbackDefinition | null);
    else if (event.type === "drawback" && input.action === "remove") replay = removeCreationDrawback(replay, input.drawbackType as DrawbackDefinition["type"]);
    else if (event.type === "maneuver-purchase") replay = setCreationManeuverLevel(replay, String(input.maneuverId), Number(input.level));
    else if (event.type === "skill-purchase") replay = setCreationSkillLevel(replay, input.skill as keyof SkillLevels, Number(input.level));
    else if (event.type === "custom-maneuver") replay = addCreationCustomManeuver(replay, structuredClone(input.move as ManeuverDefinition));
    else if (event.type === "auto-purchase") replay = autoAllocateCreationPoints(replay);
    else if (event.type === "finalize") replay = finalizeCreationSession(replay);
    else throw new Error(`Unsupported creation replay event ${event.type}.`);
  }
  return replay;
}
