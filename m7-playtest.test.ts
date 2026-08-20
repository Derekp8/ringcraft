import { describe, expect, it } from "vitest";
import completedFixture from "../fixtures/m5/example-career-save.json";
import {
  buildPlaytestReport,
  normalizePlaytestNotes,
  serializePlaytestReport,
} from "../src/ui/playtest-presentation";
import { loadCompletedM5Fixture, loadInProgressM5Fixture } from "../src/ui/playtest-fixtures";
import { buildCareerDossier } from "../src/ui/campaign-presentation";
import { hashCampaignState } from "../src/core";
import type { PlaytestNotes } from "../src/ui/playtest-presentation";

const completedJson = JSON.stringify(completedFixture);

describe("M7 playtest readiness", () => {
  it("normalizes notes to the current campaign and removes invalid duplicates", () => {
    const notes = normalizePlaytestNotes(
      {
        campaignId: "old-campaign",
        goal: "  Find the next booking  ",
        tags: ["blocked-action", "blocked-action", "not-a-tag", "save-recovery"],
        notes: "  The recovery path was clear.  ",
      } as unknown as PlaytestNotes,
      "campaign-current",
    );
    expect(notes).toEqual({
      campaignId: "campaign-current",
      goal: "Find the next booking",
      tags: ["blocked-action", "save-recovery"],
      notes: "The recovery path was clear.",
    });
  });

  it("creates an empty campaign-bound draft from missing notes", () => {
    expect(normalizePlaytestNotes(null, "campaign-current")).toEqual({
      campaignId: "campaign-current",
      goal: "",
      tags: [],
      notes: "",
    });
  });

  it("derives a bounded deterministic report from the completed fixture", () => {
    const campaign = loadCompletedM5Fixture();
    const notes = normalizePlaytestNotes(
      { campaignId: campaign.campaignId, goal: "Review the first result", tags: ["visual-clarity"], notes: "The report is useful." },
      campaign.campaignId,
    );
    const report = buildPlaytestReport(campaign, buildCareerDossier(campaign), notes);
    expect(report.reportVersion).toBe("asw91-playtest-report-v1");
    expect(report.campaignId).toBe(campaign.campaignId);
    expect(report.currentDate).toBe("1991-01-01");
    expect(report.campaignHash).toBe(hashCampaignState(campaign));
    expect(report.dossier.record).toEqual({ wins: 0, draws: 0, losses: 1, matches: 1 });
    expect(report.latestMatch).toMatchObject({
      matchId: "match-49bdb9f5",
      summary: "Freebuff Fixture 2 wins by pin.",
      method: "pin",
      finalMatchHash: "c14n-fnv1a64-v1:b5cc3ccccd2e25ee",
    });
    expect(report.recentEvents).toHaveLength(5);
    expect(report.notes).toEqual(notes);
  });

  it("serializes identical reports identically", () => {
    const campaign = loadCompletedM5Fixture();
    const notes = normalizePlaytestNotes(undefined, campaign.campaignId);
    const dossier = buildCareerDossier(campaign);
    expect(serializePlaytestReport(buildPlaytestReport(campaign, dossier, notes))).toBe(
      serializePlaytestReport(buildPlaytestReport(campaign, dossier, notes)),
    );
  });

  it("does not mutate campaign state while deriving a report", () => {
    const campaign = loadCompletedM5Fixture();
    const before = hashCampaignState(campaign);
    const dossier = buildCareerDossier(campaign);
    buildPlaytestReport(campaign, dossier, normalizePlaytestNotes(undefined, campaign.campaignId));
    expect(hashCampaignState(campaign)).toBe(before);
  });

  it("loads the completed fixture through campaign validation", () => {
    const campaign = loadCompletedM5Fixture();
    expect(campaign.campaignId).toBe("campaign-4b340d10");
    expect(campaign.activeMatchId).toBeNull();
    expect(campaign.matchHistory).toEqual(["match-49bdb9f5"]);
  });

  it("loads the in-progress fixture with its recoverable active match", () => {
    const campaign = loadInProgressM5Fixture();
    expect(campaign.campaignId).toBe("campaign-4b340d10");
    expect(campaign.activeMatchId).toBe("match-7fc510aa");
    expect(campaign.activeMatch).not.toBeNull();
  });

  it("fixture loaders return independent campaign objects", () => {
    const first = loadCompletedM5Fixture();
    const second = loadCompletedM5Fixture();
    first.events[0].summary = "test-only mutation";
    expect(second.events[0].summary).not.toBe("test-only mutation");
    expect(JSON.stringify(first.events.slice(1))).toBe(JSON.stringify(JSON.parse(completedJson).events.slice(1)));
  });
});
