import { mkdir, writeFile } from "node:fs/promises";
import {
  beginScheduledMatch,
  createCampaign,
  createCreationSession,
  finalizeCreationSession,
  hashCampaignState,
  resolveScheduledMatchHeadless,
  rollCreationHistory,
  rollCreationStature,
  scheduleCampaignMatch,
  serializeCampaign,
  setCreationIdentity,
  setCreationSide,
  autoAllocateCreationPoints,
  advanceCampaignDays,
  suggestPlayerMatch,
} from "../src/core/index.ts";
import type { WrestlerCareerRecord } from "../src/core/index.ts";

function makeRecord(seed: number, index: number): WrestlerCareerRecord {
  let session = createCreationSession(seed);
  session = setCreationIdentity(session, { name: `Freebuff Fixture ${index}`, epithet: `Seed ${seed}`, affiliation: "M5 Deterministic Fixture" });
  session = setCreationSide(session, index % 2 ? "rulebreaker" : "fan-favorite");
  session = rollCreationStature(session);
  session = rollCreationHistory(session);
  session = autoAllocateCreationPoints(session);
  return finalizeCreationSession(session).finalized!;
}

const roster = Array.from({ length: 8 }, (_, index) => makeRecord(9100 + index, index + 1));
const teams = Array.from({ length: 4 }, (_, index) => ({
  id: `freebuff-fixture-team-${index + 1}`,
  name: `Freebuff Fixture Team ${index + 1}`,
  memberIds: [roster[index * 2].id, roster[index * 2 + 1].id] as [string, string],
  side: roster[index * 2].side,
}));

let completed = createCampaign({
  name: "Freebuff M5 Example Career",
  seed: 51991,
  startDate: "1991-01-01",
  roster,
  teams,
  playerEntrantId: roster[3].id,
  playerDivision: "singles",
  vacancyMethod: "tournament",
});
const firstRequest = suggestPlayerMatch(completed);
completed = scheduleCampaignMatch(completed, { ...firstRequest, timeLimitMinutes: 2, playerControlled: false });
completed = resolveScheduledMatchHeadless(completed, completed.schedule.at(-1)!.id);

const completedMatch = completed.schedule.at(-1)!;
const replay = {
  schemaVersion: "asw91-campaign-match-replay-v1",
  campaignSchemaVersion: completed.schemaVersion,
  campaignId: completed.campaignId,
  matchId: completedMatch.id,
  matchConfig: completedMatch.replayConfig,
  inputLog: completedMatch.replayInputs,
  expectedFinalMatchHash: completedMatch.result!.finalMatchHash,
  expectedCampaignHashAfterCommit: hashCampaignState(completed),
};

let recovery = advanceCampaignDays(completed, 1);
recovery = scheduleCampaignMatch(recovery, { ...suggestPlayerMatch(recovery), date: recovery.currentDate, timeLimitMinutes: 2, playerControlled: true });
recovery = beginScheduledMatch(recovery, recovery.schedule.at(-1)!.id);

const fixtureDirectory = new URL("../fixtures/m5/", import.meta.url);
await mkdir(fixtureDirectory, { recursive: true });
await Promise.all([
  writeFile(new URL("example-career-save.json", fixtureDirectory), serializeCampaign(completed)),
  writeFile(new URL("example-in-progress-save.json", fixtureDirectory), serializeCampaign(recovery)),
  writeFile(new URL("example-match-replay.json", fixtureDirectory), `${JSON.stringify(replay, null, 2)}\n`),
]);

console.log(JSON.stringify({
  completedCampaignHash: hashCampaignState(completed),
  completedMatchHash: completedMatch.result!.finalMatchHash,
  recoveryCampaignHash: hashCampaignState(recovery),
  fixtureFiles: ["example-career-save.json", "example-in-progress-save.json", "example-match-replay.json"],
}, null, 2));
