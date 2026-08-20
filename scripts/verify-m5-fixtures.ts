import { readFile } from "node:fs/promises";
import {
  advanceUntilPlayerDecision,
  checkpointScheduledMatch,
  chooseDeterministicPolicyAction,
  commitScheduledMatchResult,
  hashCampaignState,
  hashMatchState,
  importCampaignJson,
  replayFromInputLog,
  replayScheduledCampaignMatch,
  submitPlayerIntent,
  validateCampaignState,
} from "../src/core/index.ts";

const fixtureDirectory = new URL("../fixtures/m5/", import.meta.url);
const completed = importCampaignJson(await readFile(new URL("example-career-save.json", fixtureDirectory), "utf8")).state;
const recovery = importCampaignJson(await readFile(new URL("example-in-progress-save.json", fixtureDirectory), "utf8")).state;
const replay = JSON.parse(await readFile(new URL("example-match-replay.json", fixtureDirectory), "utf8"));

if (replay.schemaVersion !== "asw91-campaign-match-replay-v1") throw new Error("Example replay schema is unsupported.");
if (hashCampaignState(completed) !== replay.expectedCampaignHashAfterCommit) throw new Error("Completed fixture campaign hash diverged.");
if (validateCampaignState(completed).length || validateCampaignState(recovery).length) throw new Error("A campaign fixture is structurally invalid.");
const replayed = replayScheduledCampaignMatch(completed, replay.matchId);
if (hashMatchState(replayed) !== replay.expectedFinalMatchHash) throw new Error("Example match replay diverged.");
if (!recovery.activeMatch || !recovery.activeMatchId) throw new Error("Recovery fixture does not contain an active match.");
if (hashMatchState(replayFromInputLog(recovery.activeMatch)) !== hashMatchState(recovery.activeMatch)) throw new Error("Recovery fixture checkpoint does not replay.");

let resumedMatch = recovery.activeMatch;
let inputs = 0;
while (!resumedMatch.result) {
  resumedMatch = advanceUntilPlayerDecision(resumedMatch);
  if (resumedMatch.result) break;
  if (!resumedMatch.decision) throw new Error("Recovery continuation stalled.");
  resumedMatch = submitPlayerIntent(resumedMatch, chooseDeterministicPolicyAction(resumedMatch, resumedMatch.decision).intent);
  inputs += 1;
  if (inputs > 20_000) throw new Error("Recovery continuation exceeded its deterministic guard.");
}
let continued = checkpointScheduledMatch(recovery, resumedMatch);
continued = commitScheduledMatchResult(continued);
if (continued.schedule.find((row) => row.id === recovery.activeMatchId)?.status !== "completed") throw new Error("Recovery fixture did not continue to an official result.");

console.log(JSON.stringify({
  completedCampaignHash: hashCampaignState(completed),
  replayMatchHash: hashMatchState(replayed),
  recoveredFinalCampaignHash: hashCampaignState(continued),
  recoveryInputsApplied: inputs,
  status: "verified",
}, null, 2));
