import { SPECIAL_SKILLS } from "./career-rules";
import { baseAv, baseDv } from "./derived";
import { MANEUVERS } from "./rules";
import type { Attributes, DrawbackDefinition, SkillLevels, TeamId, WrestlerDefinition } from "./types";

export interface OfficialRosterSource {
  publication: "All Star Wrestling";
  editionYear: 1991;
  pdfPage: number;
  profileName: string;
}

export interface OfficialWrestlerProfile {
  id: string;
  name: string;
  epithet: string;
  birthdate: string;
  hometown: string;
  affiliation: string;
  favoriteManeuver: string;
  titles: readonly string[];
  side: WrestlerDefinition["side"];
  heightInches: number;
  weight: number;
  fame: number;
  careerWp: number;
  attributes: Attributes;
  baseAttributes: Attributes;
  attributeWp: Partial<Record<keyof Attributes, number>>;
  maneuverLevels: Readonly<Record<string, number>>;
  skills: SkillLevels;
  drawbacks: readonly DrawbackDefinition[];
  printedAv: number;
  printedDv: number;
  tagTeam?: { name: string; partnerId: string };
  source: OfficialRosterSource;
}

const skills = (patch: Partial<SkillLevels>): SkillLevels => ({
  breakHold: 0,
  distractReferee: 0,
  dodge: 0,
  escapePin: 0,
  illegalPin: 0,
  irishWhip: 0,
  pinInterference: 0,
  tagTeam: 0,
  charm: 0,
  ...patch,
});

const source = (pdfPage: number, profileName: string): OfficialRosterSource => ({
  publication: "All Star Wrestling",
  editionYear: 1991,
  pdfPage,
  profileName,
});

/**
 * The 14 pre-generated wrestler profiles printed in the 1991 core rulebook,
 * PDF pages 78-91. These are source profiles, not fabricated digital
 * creation sessions: the printed sheets do not contain the complete roll-by-
 * roll creation history required by WrestlerCareerRecord.
 */
export const OFFICIAL_WRESTLER_PROFILES: readonly OfficialWrestlerProfile[] = [
  {
    id: "steve-gordon", name: "Steve Gordon", epithet: "Thunderbolt", birthdate: "January 6, 1966", hometown: "Los Angeles, CA", affiliation: "None",
    favoriteManeuver: '"The T-Bolt" Superplex', titles: ["EWL Tag (w/Boris Alexandrov), 1986", "AAW TV Champion, 1988", "ASWF World Heavyweight, 1990-91 & 1991-"],
    side: "fan-favorite", heightInches: 76, weight: 256, fame: 11, careerWp: 633,
    attributes: { pow: 71, agi: 59, qui: 51, tec: 61, end: 51 }, baseAttributes: { pow: 68, agi: 57, qui: 48, tec: 58, end: 39 },
    attributeWp: { pow: 45, agi: 24, qui: 30, tec: 42, end: 108 },
    skills: skills({ irishWhip: 4, breakHold: 2, escapePin: 1, tagTeam: 1, charm: 2 }),
    drawbacks: [{ type: "egotist", damageThreshold: 25, rollThreshold: 9, awardedPoints: 15 }],
    maneuverLevels: { headlock: 2, hammerlock: 3, "body-slam": 2, "drop-kick": 6, punch: 3, "flying-bodypress": 3, suplex: 8, superplex: 1 },
    printedAv: 23, printedDv: 13, source: source(78, '"Thunderbolt" Steve Gordon'),
  },
  {
    id: "tom-landers", name: "Tom Landers", epithet: "The Natural", birthdate: "May 22, 1960", hometown: "Philadelphia, PA", affiliation: "None",
    favoriteManeuver: "The Scorpion Leglock", titles: ["EWL Tag (w/Sir William Scott), 1983", "SSW Southern Heavyweight, 1986", "SSW Tag (w/Terry MacCloud), 1987", "JWA TV, 1988", "ASWF World TV, 1990-91", "ASWF International, 1991 (twice)"],
    side: "rulebreaker", heightInches: 76, weight: 246, fame: 12, careerWp: 586,
    attributes: { pow: 41, agi: 61, qui: 45, tec: 85, end: 58 }, baseAttributes: { pow: 41, agi: 60, qui: 41, tec: 81, end: 49 },
    attributeWp: { agi: 12, qui: 40, tec: 56, end: 81 },
    skills: skills({ irishWhip: 4, breakHold: 5, escapePin: 2, illegalPin: 2 }), drawbacks: [],
    maneuverLevels: { leglock: 4, "boston-crab-single-leg": 2, "scorpion-leglock": 1, "airplane-spin": 3, "body-slam": 2, "forearm-smash": 2, "hip-toss": 4, "kick-reverse": 3, suplex: 6 },
    printedAv: 23, printedDv: 13, source: source(79, '"The Natural" Tom Landers'),
  },
  {
    id: "wildlord", name: "Wildlord", epithet: "", birthdate: "November 4, 1965", hometown: "Chicago, IL", affiliation: "None",
    favoriteManeuver: '"The Wild One" Rack', titles: ["JWA TV Champion, 1988", "ASWF World Tag (w/Tom King), 1990", "ASWF World TV, 1991-"],
    side: "fan-favorite", heightInches: 77, weight: 275, fame: 7, careerWp: 459,
    attributes: { pow: 96, agi: 51, qui: 57, tec: 41, end: 51 }, baseAttributes: { pow: 92, agi: 51, qui: 57, tec: 41, end: 42 },
    attributeWp: { pow: 60, end: 81 }, skills: skills({ irishWhip: 4, tagTeam: 1, breakHold: 2, distractReferee: 1 }),
    drawbacks: [{ type: "stupid-moves", intervalMinutes: 2, rollThreshold: 9, awardedPoints: 20 }],
    maneuverLevels: { "arm-bar": 5, headlock: 3, "the-rack": 1, "body-slam": 5, punch: 3, shoulderblock: 2, "clothesline-charging": 2 },
    printedAv: 22, printedDv: 13, source: source(80, "Wildlord"),
  },
  {
    id: "tom-king", name: "Tom King", epithet: "Royal", birthdate: "February 8, 1952", hometown: "Seattle, WA", affiliation: "None",
    favoriteManeuver: "Figure-Four Leglock", titles: ["ACW Tag (w/Mike Watson), 1977", "ACW TV, 1979-80", "TWC Heavyweight, 1982 & 1984", "ACW Heavyweight, 1985-86", "AAW Tag (w/Headhunter II), 1986", "ASWF World Heavyweight, 1988-89, 1989-90, & 1991", "ASWF World Tag (w/Wildlord), 1990"],
    side: "rulebreaker", heightInches: 76, weight: 262, fame: 25, careerWp: 750,
    attributes: { pow: 41, agi: 51, qui: 31, tec: 94, end: 64 }, baseAttributes: { pow: 41, agi: 51, qui: 31, tec: 90, end: 50 },
    attributeWp: { tec: 56, end: 126 }, skills: skills({ breakHold: 5, illegalPin: 2, escapePin: 5, tagTeam: 1, distractReferee: 1 }), drawbacks: [],
    maneuverLevels: { "abdominal-stretch": 5, hammerlock: 6, "boston-crab-single-leg": 4, "figure-four-leglock": 2, suplex: 8, "body-slam": 5, "chop-to-throat": 5, "eye-gouge": 8, "atomic-drop": 5, piledriver: 2 },
    printedAv: 23, printedDv: 12, source: source(81, '"Royal" Tom King'),
  },
  {
    id: "john-atlas", name: "John Atlas", epithet: "", birthdate: "April 5, 1962", hometown: "Chicago, IL", affiliation: "None",
    favoriteManeuver: "Powerslam", titles: ["SSW Tennessee, 1983", "EWL Heavyweight, 1985", "SPW Hawaiian Tag (w/Richard Proudstar), 1987", "ASWF International, 1990-91"],
    side: "fan-favorite", heightInches: 76, weight: 270, fame: 7, careerWp: 622,
    attributes: { pow: 91, agi: 51, qui: 44, tec: 51, end: 51 }, baseAttributes: { pow: 91, agi: 51, qui: 41, tec: 47, end: 42 },
    attributeWp: { qui: 30, tec: 56, end: 81 }, skills: skills({ irishWhip: 5, charm: 3, breakHold: 3, escapePin: 3 }), drawbacks: [],
    maneuverLevels: { headlock: 4, "bear-hug": 1, "body-slam": 6, suplex: 5, "drop-kick": 2, "chop-to-chest": 3, clothesline: 2, "hip-toss": 3, powerslam: 2 },
    printedAv: 23, printedDv: 12, source: source(82, "John Atlas"),
  },
  {
    id: "big-bubba-blackstone", name: "Big Bubba Blackstone", epithet: "", birthdate: "July 12, 1962", hometown: "Parts Unknown", affiliation: "None",
    favoriteManeuver: "Heart Punch", titles: ["SPW Hawaiian Tag (w/Maui Marauder), 1989"],
    side: "rulebreaker", heightInches: 78, weight: 305, fame: 1, careerWp: 369,
    attributes: { pow: 81, agi: 51, qui: 36, tec: 61, end: 43 }, baseAttributes: { pow: 81, agi: 51, qui: 31, tec: 61, end: 38 },
    attributeWp: { qui: 50, end: 45 }, skills: skills({ breakHold: 2 }), drawbacks: [{ type: "glass-jaw", damageThreshold: 25, rollThreshold: 9, awardedPoints: 20 }],
    maneuverLevels: { headlock: 2, "the-rack": 1, clothesline: 2, "body-slam": 5, suplex: 8, "shoulder-to-steel-pole": 2, "suplex-belly-to-back": 4, "heart-punch": 1 },
    printedAv: 22, printedDv: 12, source: source(83, "Big Bubba Blackstone"),
  },
  {
    id: "boris-alexandrov", name: "Boris Alexandrov", epithet: "", birthdate: "March 3, 1962", hometown: "Moscow, Russia", affiliation: "None",
    favoriteManeuver: "Charging Clothesline", titles: ["SPW Hawaiian Heavyweight, 1983", "EWL Tag (w/Steve Gordon), 1986", "TWC Tag (w/Gibson Williams), 1987"],
    side: "fan-favorite", heightInches: 75, weight: 266, fame: 4, careerWp: 431,
    attributes: { pow: 81, agi: 51, qui: 37, tec: 61, end: 45 }, baseAttributes: { pow: 75, agi: 51, qui: 31, tec: 61, end: 40 },
    attributeWp: { pow: 90, qui: 60, end: 45 }, skills: skills({ breakHold: 1, irishWhip: 3 }), drawbacks: [{ type: "egotist", damageThreshold: 20, rollThreshold: 12, awardedPoints: 25 }],
    maneuverLevels: { "arm-bar": 5, headlock: 2, "clothesline-charging": 1, "body-slam": 5, "hip-toss": 2, punch: 4, suplex: 4 },
    printedAv: 22, printedDv: 12, source: source(84, "Boris Alexandrov"),
  },
  {
    id: "big-scott-britt", name: "Britt", epithet: "Big Scott", birthdate: "October 12, 1964", hometown: "New Orleans, LA", affiliation: "None",
    favoriteManeuver: "Piledriver", titles: ["TWC Tag (w/Bill Ruby), 1986", "AAW Tag (w/Ben Peters), 1988"],
    side: "rulebreaker", heightInches: 76, weight: 276, fame: 2, careerWp: 210,
    attributes: { pow: 81, agi: 51, qui: 45, tec: 31, end: 49 }, baseAttributes: { pow: 81, agi: 51, qui: 45, tec: 31, end: 49 }, attributeWp: {},
    skills: skills({ breakHold: 3, escapePin: 1 }), drawbacks: [{ type: "egotist", damageThreshold: 20, rollThreshold: 9, awardedPoints: 20 }, { type: "old-injury", damageThreshold: 25, rollThreshold: 9, awardedPoints: 20 }],
    maneuverLevels: { "bear-hug": 1, headlock: 3, choke: 2, "forearm-smash": 3, "body-slam": 2, suplex: 5, piledriver: 1, "eye-gouge": 7 },
    printedAv: 21, printedDv: 10, source: source(85, '"Big Scott" Britt'),
  },
  {
    id: "greg-bryant", name: "Greg Bryant", epithet: "Gorgeous", birthdate: "December 10, 1959", hometown: "Ft. Lauderdale, FL", affiliation: "The Black Knights",
    favoriteManeuver: '"The Spinebuster" Atomic Drop', titles: ["AAW TV, 1984", "JWA International, 1986-87", "AWW World Heavyweight, 1987", "ASWF World Tag (w/Ned Eisner), 1988-89", "ASWF World Tag (w/Gibson Williams), 1991-"],
    side: "rulebreaker", heightInches: 74, weight: 232, fame: 14, careerWp: 538,
    attributes: { pow: 41, agi: 51, qui: 61, tec: 71, end: 51 }, baseAttributes: { pow: 41, agi: 51, qui: 56, tec: 71, end: 43 }, attributeWp: { qui: 50, end: 72 },
    skills: skills({ irishWhip: 3, tagTeam: 2, distractReferee: 3, escapePin: 3, breakHold: 3, pinInterference: 1, illegalPin: 2 }), drawbacks: [{ type: "egotist", damageThreshold: 25, rollThreshold: 12, awardedPoints: 10 }],
    maneuverLevels: { choke: 3, "abdominal-stretch": 4, punch: 3, "body-slam": 3, "drop-kick": 5, "karate-kick": 1, "atomic-drop": 2 },
    printedAv: 23, printedDv: 13, tagTeam: { name: "The Black Knights", partnerId: "gibson-williams" }, source: source(86, '"Gorgeous" Greg Bryant'),
  },
  {
    id: "gibson-williams", name: "Gibson Williams", epithet: "", birthdate: "December 6, 1958", hometown: "New York, NY", affiliation: "The Black Knights",
    favoriteManeuver: "High Cross Bodyblock", titles: ["AWC New Zealand Tag (w/Jim Ruby), 1983", "IAW Heavyweight, 1986", "TWC Tag (w/Boris Alexandrov), 1987", "ASWF World Tag (w/Greg Bryant), 1991-"],
    side: "rulebreaker", heightInches: 73, weight: 238, fame: 7, careerWp: 488,
    attributes: { pow: 32, agi: 51, qui: 52, tec: 91, end: 46 }, baseAttributes: { pow: 31, agi: 51, qui: 51, tec: 91, end: 39 }, attributeWp: { pow: 15, qui: 10, end: 63 },
    skills: skills({ irishWhip: 6, tagTeam: 2, distractReferee: 1, escapePin: 2, breakHold: 2, pinInterference: 1 }), drawbacks: [],
    maneuverLevels: { hammerlock: 4, leglock: 3, "boston-crab": 1, "double-axe-handle": 2, suplex: 6, "drop-kick": 5, "drop-kick-off-ropes": 1, "high-cross-bodyblock": 2 },
    printedAv: 24, printedDv: 13, tagTeam: { name: "The Black Knights", partnerId: "greg-bryant" }, source: source(87, "Gibson Williams"),
  },
  {
    id: "keith-austin", name: "Keith Austin", epithet: "", birthdate: "July 24, 1966", hometown: "Phoenix, AZ", affiliation: "Rock & Roll Rebels",
    favoriteManeuver: "Double Flying Clothesline", titles: ["AAW Tag (w/Lou Lopez), 1987", "SSW Southern Tag (w/Johnny Parker), 1989", "ASWF American Tag (w/Johnny Parker), 1991 (twice)"],
    side: "fan-favorite", heightInches: 71, weight: 220, fame: 4, careerWp: 307,
    attributes: { pow: 31, agi: 71, qui: 61, tec: 71, end: 47 }, baseAttributes: { pow: 31, agi: 71, qui: 61, tec: 71, end: 41 }, attributeWp: { end: 54 },
    skills: skills({ irishWhip: 2, tagTeam: 1, dodge: 5, breakHold: 1 }), drawbacks: [],
    maneuverLevels: { hammerlock: 4, "leg-scissors": 2, "scorpion-leglock": 1, "hip-toss": 5, "drop-kick": 3, "russian-leg-sweep": 4, "suplex-headscissor": 1, "clothesline-flying": 1 },
    printedAv: 24, printedDv: 14, tagTeam: { name: "Rock & Roll Rebels", partnerId: "johnny-parker" }, source: source(88, "Keith Austin"),
  },
  {
    id: "johnny-parker", name: "Johnny Parker", epithet: "", birthdate: "November 12, 1964", hometown: "Orlando, FL", affiliation: "Rock & Roll Rebels",
    favoriteManeuver: "Double Flying Clothesline", titles: ["AWW World TV, 1987", "SSW Southern Tag (w/Keith Austin), 1989", "ASWF American Tag (w/Keith Austin), 1991 (twice)"],
    side: "fan-favorite", heightInches: 73, weight: 225, fame: 5, careerWp: 364,
    attributes: { pow: 31, agi: 71, qui: 61, tec: 61, end: 47 }, baseAttributes: { pow: 31, agi: 71, qui: 61, tec: 61, end: 39 }, attributeWp: { end: 72 },
    skills: skills({ irishWhip: 3, tagTeam: 1, dodge: 4, breakHold: 2 }), drawbacks: [{ type: "egotist", damageThreshold: 20, rollThreshold: 12, awardedPoints: 15 }],
    maneuverLevels: { "arm-bar": 3, "abdominal-stretch": 1, sleeper: 1, "drop-kick": 5, "hip-toss": 6, "flying-bodypress": 2, "kick-reverse": 1, "clothesline-flying": 1 },
    printedAv: 23, printedDv: 14, tagTeam: { name: "Rock & Roll Rebels", partnerId: "keith-austin" }, source: source(89, "Johnny Parker"),
  },
  {
    id: "maniac", name: "Maniac", epithet: "", birthdate: "July 29, 1960", hometown: "Chicago, IL", affiliation: "Maximum Force",
    favoriteManeuver: "Bearhug Suplex", titles: ["AAW Tag (w/Renegade), 1986-87", "ASWF World Tag (w/Renegade), 1990 & 1991", "JWA Tag (w/Renegade), 1991-"],
    side: "fan-favorite", heightInches: 77, weight: 302, fame: 8, careerWp: 489,
    attributes: { pow: 100, agi: 51, qui: 26, tec: 44, end: 63 }, baseAttributes: { pow: 100, agi: 51, qui: 21, tec: 41, end: 58 }, attributeWp: { qui: 50, tec: 42, end: 45 },
    skills: skills({ tagTeam: 1, distractReferee: 1, escapePin: 2, breakHold: 3, charm: 1 }), drawbacks: [{ type: "egotist", damageThreshold: 25, rollThreshold: 9, awardedPoints: 15 }],
    maneuverLevels: { "neck-vise": 2, "bear-hug": 1, "body-slam": 4, "forearm-smash": 8, "throw-out-of-ring": 3, "drop-kick": 2, "press-and-slam": 2, "suplex-bearhug": 1 },
    printedAv: 21, printedDv: 11, tagTeam: { name: "Maximum Force", partnerId: "renegade" }, source: source(90, "Maniac"),
  },
  {
    id: "renegade", name: "Renegade", epithet: "", birthdate: "September 11, 1962", hometown: "New York, NY", affiliation: "Maximum Force",
    favoriteManeuver: '"Maximum" Splash from the Top Rope', titles: ["SSW Southern Heavyweight, 1984", "AAW Tag (w/Maniac), 1986-87", "ASWF World Tag (w/Maniac), 1990 & 1991", "JWA Tag (w/Maniac), 1991-"],
    side: "fan-favorite", heightInches: 76, weight: 260, fame: 10, careerWp: 534,
    attributes: { pow: 81, agi: 51, qui: 38, tec: 51, end: 54 }, baseAttributes: { pow: 77, agi: 51, qui: 34, tec: 51, end: 51 }, attributeWp: { pow: 60, qui: 40, end: 27 },
    skills: skills({ tagTeam: 2, breakHold: 2, escapePin: 1, irishWhip: 4, charm: 1 }), drawbacks: [],
    maneuverLevels: { headlock: 2, "body-slam": 6, "drop-kick": 5, punch: 3, suplex: 5, "turnbuckle-smash": 3, "flying-bodypress": 2, "press-and-slam": 1, "splash-from-top-rope": 1 },
    printedAv: 21, printedDv: 11, tagTeam: { name: "Maximum Force", partnerId: "maniac" }, source: source(91, "Renegade"),
  },
] as const;

export const OFFICIAL_ROSTER_BY_ID: Readonly<Record<string, OfficialWrestlerProfile>> = Object.freeze(
  Object.fromEntries(OFFICIAL_WRESTLER_PROFILES.map((profile) => [profile.id, profile])),
);

export const OFFICIAL_TAG_TEAMS = [
  { name: "The Black Knights", memberIds: ["greg-bryant", "gibson-williams"] },
  { name: "Rock & Roll Rebels", memberIds: ["keith-austin", "johnny-parker"] },
  { name: "Maximum Force", memberIds: ["maniac", "renegade"] },
] as const;


export function officialDisplayName(profile: OfficialWrestlerProfile): string {
  if (!profile.epithet) return profile.name;
  return `"${profile.epithet}" ${profile.name}`;
}

export function officialProfileToDefinition(profile: OfficialWrestlerProfile, id: string, teamId: TeamId): WrestlerDefinition {
  return {
    id,
    teamId,
    name: profile.name,
    epithet: profile.epithet,
    side: profile.side,
    weight: profile.weight,
    heightInches: profile.heightInches,
    attributes: structuredClone(profile.attributes),
    maneuverLevels: structuredClone(profile.maneuverLevels),
    skills: structuredClone(profile.skills),
    drawbacks: structuredClone(profile.drawbacks) as DrawbackDefinition[],
    fame: profile.fame,
    careerWp: profile.careerWp,
    sourceRecordId: `official:${profile.id}`,
  };
}

export interface OfficialRosterAudit {
  errors: string[];
  sourceAmbiguities: string[];
}

export function auditOfficialRoster(): OfficialRosterAudit {
  const errors: string[] = [];
  const sourceAmbiguities: string[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const profile of OFFICIAL_WRESTLER_PROFILES) {
    const label = officialDisplayName(profile);
    if (ids.has(profile.id)) errors.push(`${label}: duplicate official roster id ${profile.id}.`);
    ids.add(profile.id);
    const normalizedName = label.toLowerCase();
    if (names.has(normalizedName)) errors.push(`${label}: duplicate official display identity.`);
    names.add(normalizedName);
    for (const [key, value] of Object.entries(profile.attributes)) {
      if (!Number.isInteger(value) || value < 1 || value > 100) errors.push(`${label}: ${key.toUpperCase()} ${value} is outside 1-100.`);
    }
    if (!Number.isInteger(profile.weight) || profile.weight <= 0) errors.push(`${label}: invalid weight ${profile.weight}.`);
    if (!Number.isInteger(profile.heightInches) || profile.heightInches <= 0) errors.push(`${label}: invalid height ${profile.heightInches}.`);
    if (!Number.isInteger(profile.fame) || profile.fame < 0) errors.push(`${label}: invalid Fame ${profile.fame}.`);
    if (profile.skills.charm > Math.floor(profile.fame / 2)) errors.push(`${label}: Charm ${profile.skills.charm} exceeds Fame cap ${Math.floor(profile.fame / 2)}.`);
    for (const [skill, level] of Object.entries(profile.skills)) {
      if (!Number.isInteger(level) || level < 0) errors.push(`${label}: ${skill} has invalid level ${level}.`);
    }
    for (const [moveId, level] of Object.entries(profile.maneuverLevels)) {
      const move = MANEUVERS[moveId];
      if (!move) { errors.push(`${label}: unknown maneuver ${moveId}.`); continue; }
      if (!Number.isInteger(level) || level < 1) errors.push(`${label}: ${moveId} has invalid level ${level}.`);
      if (profile.side === "fan-favorite" && move.illegal) errors.push(`${label}: fan favorite has illegal maneuver ${moveId}.`);
      const attribute = move.kind === "hold" ? profile.attributes.tec : profile.attributes.pow;
      if (attribute < move.minAttribute) errors.push(`${label}: ${move.name} requires ${move.kind === "hold" ? "TEC" : "POW"} ${move.minAttribute}; has ${attribute}.`);
    }
    if (profile.side === "fan-favorite" && profile.skills.illegalPin > 0) errors.push(`${label}: fan favorite has Illegal Pin skill.`);
    const attributeWp = Object.values(profile.attributeWp).reduce((total, value) => total + (value ?? 0), 0);
    const maneuverWp = Object.entries(profile.maneuverLevels).reduce((total, [moveId, level]) => total + (MANEUVERS[moveId]?.listedCost ?? 0) * level, 0);
    const skillWp = (Object.keys(profile.skills) as Array<keyof SkillLevels>).reduce((total, skill) => total + SPECIAL_SKILLS[skill].cost * profile.skills[skill], 0);
    const reconstructedWp = attributeWp + maneuverWp + skillWp;
    if (reconstructedWp !== profile.careerWp) {
      sourceAmbiguities.push(`${label}: maneuver-chart reconstruction yields WP ${reconstructedWp}, while the printed profile reports TOTAL WP ${profile.careerWp}. Preserve the printed profile total; do not infer a chart correction.`);
    }
    if (baseAv(profile.attributes) !== profile.printedAv) errors.push(`${label}: derived AV ${baseAv(profile.attributes)} does not match printed AV ${profile.printedAv}.`);
    if (baseDv(profile.attributes) !== profile.printedDv) errors.push(`${label}: derived DV ${baseDv(profile.attributes)} does not match printed DV ${profile.printedDv}.`);
    if (profile.source.publication !== "All Star Wrestling" || profile.source.editionYear !== 1991 || profile.source.pdfPage < 78 || profile.source.pdfPage > 91) errors.push(`${label}: incomplete/invalid source provenance.`);
  }
  for (const profile of OFFICIAL_WRESTLER_PROFILES) {
    if (!profile.tagTeam) continue;
    const partner = OFFICIAL_ROSTER_BY_ID[profile.tagTeam.partnerId];
    if (!partner) errors.push(`${officialDisplayName(profile)}: missing tag partner ${profile.tagTeam.partnerId}.`);
    else if (partner.tagTeam?.partnerId !== profile.id || partner.tagTeam.name !== profile.tagTeam.name) errors.push(`${officialDisplayName(profile)}: tag-team linkage is not reciprocal.`);
  }
  const teamMemberIds = new Set<string>();
  for (const team of OFFICIAL_TAG_TEAMS) {
    for (const memberId of team.memberIds) {
      if (teamMemberIds.has(memberId)) errors.push(`${team.name}: ${memberId} appears on more than one official team.`);
      teamMemberIds.add(memberId);
      const member = OFFICIAL_ROSTER_BY_ID[memberId];
      if (!member) errors.push(`${team.name}: missing member ${memberId}.`);
      else if (member.tagTeam?.name !== team.name || !(team.memberIds as readonly string[]).includes(member.tagTeam.partnerId)) errors.push(`${team.name}: ${officialDisplayName(member)} source linkage does not match the canonical team.`);
    }
  }
  return { errors, sourceAmbiguities };
}

export function validateOfficialRoster(): string[] {
  return auditOfficialRoster().errors;
}
