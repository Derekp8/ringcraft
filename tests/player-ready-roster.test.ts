import { describe, expect, it } from "vitest";
import {
  auditOfficialRoster,
  baseAv,
  baseDv,
  createMatch,
  MANEUVERS,
  OFFICIAL_ROSTER_BY_ID,
  OFFICIAL_TAG_TEAMS,
  OFFICIAL_WRESTLER_PROFILES,
  officialDisplayName,
  officialProfileToDefinition,
  setupRandomIndex,
} from "../src/core";

describe("1991 printed source roster", () => {
  it("contains exactly the fourteen profiles printed on PDF pages 78-91", () => {
    expect(OFFICIAL_WRESTLER_PROFILES).toHaveLength(14);
    expect(OFFICIAL_WRESTLER_PROFILES.map((profile) => profile.source.pdfPage)).toEqual(
      Array.from({ length: 14 }, (_, index) => 78 + index),
    );
    expect(new Set(OFFICIAL_WRESTLER_PROFILES.map((profile) => profile.id)).size).toBe(14);
    expect(new Set(OFFICIAL_WRESTLER_PROFILES.map(officialDisplayName)).size).toBe(14);
  });

  it("validates every machine-checkable source field and preserves known source ambiguities", () => {
    const audit = auditOfficialRoster();
    expect(audit.errors).toEqual([]);
    expect(audit.sourceAmbiguities).toHaveLength(3);
    expect(audit.sourceAmbiguities.join("\n")).toContain('"The Natural" Tom Landers');
    expect(audit.sourceAmbiguities.join("\n")).toContain("Gibson Williams");
    expect(audit.sourceAmbiguities.join("\n")).toContain("Keith Austin");
  });

  it("reproduces every printed AV/DV and resolves every maneuver", () => {
    for (const profile of OFFICIAL_WRESTLER_PROFILES) {
      expect(baseAv(profile.attributes), `${officialDisplayName(profile)} AV`).toBe(profile.printedAv);
      expect(baseDv(profile.attributes), `${officialDisplayName(profile)} DV`).toBe(profile.printedDv);
      for (const [maneuverId, level] of Object.entries(profile.maneuverLevels)) {
        const move = MANEUVERS[maneuverId];
        expect(move, `${officialDisplayName(profile)} ${maneuverId}`).toBeDefined();
        expect(level).toBeGreaterThan(0);
        const attribute = move!.kind === "hold" ? profile.attributes.tec : profile.attributes.pow;
        expect(attribute, `${officialDisplayName(profile)} ${maneuverId} minimum ${move!.kind === "hold" ? "TEC" : "POW"}`).toBeGreaterThanOrEqual(move!.minAttribute);
      }
    }
  });

  it("uses TEC for Hold minimums and POW for Strike minimums", () => {
    const britt = OFFICIAL_ROSTER_BY_ID["big-scott-britt"]!;
    const piledriver = MANEUVERS.piledriver;
    expect(piledriver.kind).toBe("strike");
    expect(britt.attributes.tec).toBeLessThan(piledriver.minAttribute);
    expect(britt.attributes.pow).toBeGreaterThanOrEqual(piledriver.minAttribute);
    expect(officialDisplayName(britt)).toBe('"Big Scott" Britt');
  });

  it("maps independent setup entropy to opponent indexes without using match RNG", () => {
    expect(setupRandomIndex(0, 14)).toBe(0);
    expect(setupRandomIndex(0xffffffff, 14)).toBe(13);
    expect(() => setupRandomIndex(1, 0)).toThrow(/non-empty candidate list/i);
  });

  it("keeps the three printed tag-team pairings reciprocal", () => {
    expect(OFFICIAL_TAG_TEAMS.map((team) => team.name)).toEqual(["The Black Knights", "Rock & Roll Rebels", "Maximum Force"]);
    const pairs = OFFICIAL_WRESTLER_PROFILES.filter((profile) => profile.tagTeam);
    expect(pairs).toHaveLength(6);
    for (const profile of pairs) {
      const partner = OFFICIAL_ROSTER_BY_ID[profile.tagTeam!.partnerId];
      expect(partner).toBeDefined();
      expect(partner.tagTeam?.partnerId).toBe(profile.id);
      expect(partner.tagTeam?.name).toBe(profile.tagTeam?.name);
    }
  });

  it("can initialize a source-roster singles match without using fixture wrestlers", () => {
    const playerProfile = OFFICIAL_ROSTER_BY_ID["steve-gordon"]!;
    const opponentProfile = OFFICIAL_ROSTER_BY_ID["tom-landers"]!;
    const roster = {
      player: officialProfileToDefinition(playerProfile, "player", "player"),
      ai: officialProfileToDefinition(opponentProfile, "ai", "ai"),
    };
    const state = createMatch({
      seed: 1991,
      mode: "singles",
      roster,
      teamMembers: { player: ["player"], ai: ["ai"] },
      aiDifficulty: "standard",
    });
    expect(state.roster.player.sourceRecordId).toBe("official:steve-gordon");
    expect(state.roster.ai.sourceRecordId).toBe("official:tom-landers");
    expect(state.result).toBeNull();
  });
});
