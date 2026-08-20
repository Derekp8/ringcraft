import { campaignEntrantLabel, hashCampaignState } from "../core";
import type { CampaignState } from "../core";
import type { CareerDossierData } from "./campaign-presentation";

export const PLAYTEST_REPORT_VERSION = "asw91-playtest-report-v1" as const;
export const PLAYTEST_FRICTION_TAGS = [
  "unclear-next-step",
  "blocked-action",
  "match-pacing",
  "save-recovery",
  "accessibility",
  "visual-clarity",
  "other",
] as const;

export type PlaytestFrictionTag = (typeof PLAYTEST_FRICTION_TAGS)[number];

export interface PlaytestNotes {
  campaignId: string;
  goal: string;
  tags: PlaytestFrictionTag[];
  notes: string;
}

export interface PlaytestReport {
  reportVersion: typeof PLAYTEST_REPORT_VERSION;
  campaignId: string;
  campaignName: string;
  currentDate: string;
  campaignHash: string;
  entrant: string;
  dossier: CareerDossierData;
  latestMatch: {
    matchId: string;
    date: string;
    summary: string;
    method: string;
    finalMatchHash: string;
  } | null;
  recentEvents: Array<{
    id: string;
    date: string;
    type: string;
    summary: string;
    detail: string[];
    postStateHash: string;
  }>;
  notes: PlaytestNotes;
}

export function normalizePlaytestNotes(
  source: Partial<PlaytestNotes> | null | undefined,
  campaignId: string,
): PlaytestNotes {
  const tags: PlaytestFrictionTag[] = [];
  for (const tag of Array.isArray(source?.tags) ? source.tags : []) {
    if (PLAYTEST_FRICTION_TAGS.includes(tag as PlaytestFrictionTag) && !tags.includes(tag as PlaytestFrictionTag)) {
      tags.push(tag as PlaytestFrictionTag);
    }
  }
  return {
    campaignId,
    goal: typeof source?.goal === "string" ? source.goal.trim() : "",
    tags,
    notes: typeof source?.notes === "string" ? source.notes.trim() : "",
  };
}

export function buildPlaytestReport(
  campaign: CampaignState,
  dossier: CareerDossierData,
  sourceNotes: Partial<PlaytestNotes> | null | undefined,
): PlaytestReport {
  const latestMatch = [...campaign.schedule]
    .reverse()
    .find((row) => row.status === "completed" && row.result);
  const latestResult = latestMatch?.result;
  return {
    reportVersion: PLAYTEST_REPORT_VERSION,
    campaignId: campaign.campaignId,
    campaignName: campaign.name,
    currentDate: campaign.currentDate,
    campaignHash: hashCampaignState(campaign),
    entrant: campaignEntrantLabel(campaign, campaign.playerDivision, campaign.playerEntrantId),
    dossier,
    latestMatch: latestMatch && latestResult
      ? {
          matchId: latestMatch.id,
          date: latestMatch.date,
          summary: latestResult.summary,
          method: latestResult.method,
          finalMatchHash: latestResult.finalMatchHash,
        }
      : null,
    recentEvents: campaign.events.slice(-12).map((event) => ({
      id: event.id,
      date: event.date,
      type: event.type,
      summary: event.summary,
      detail: [...event.detail],
      postStateHash: event.postStateHash,
    })),
    notes: normalizePlaytestNotes(sourceNotes, campaign.campaignId),
  };
}

export function serializePlaytestReport(report: PlaytestReport): string {
  return JSON.stringify(report, null, 2);
}
