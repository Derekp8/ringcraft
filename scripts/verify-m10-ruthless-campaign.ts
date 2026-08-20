import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { hashCampaignState, hashMatchState, replayScheduledCampaignMatch } from "../src/core/index.ts";
import { M10_RUTHLESS_CAMPAIGN_SCHEMA, deriveRuthlessCampaign } from "./m10-ruthless-campaign";
import type { RuthlessCampaignFixture } from "./m10-ruthless-campaign";

const fixtureUrl = new URL("../fixtures/m10/ruthless-campaign-v1.json", import.meta.url);
const raw = await readFile(fixtureUrl, "utf8");
const fixture: RuthlessCampaignFixture = JSON.parse(raw);
if (fixture.schema !== M10_RUTHLESS_CAMPAIGN_SCHEMA) throw new Error("M10 ruthless-campaign fixture schema is unsupported.");

// Re-derive the whole chain from the fixture's derivation spec and assert every
// pin: the committed-match hash, the final month-end hash, and the stored
// replay still reproducing the match's final-state hash (the campaign-level
// replay contract mirrored from tests/m10-ai.test.ts).
const { committed, final, matchFinalHash } = deriveRuthlessCampaign(fixture.derivation);

const committedCampaignHash = hashCampaignState(committed);
if (committedCampaignHash !== fixture.evidence.committedCampaignHash) {
  throw new Error(`Ruthless committed campaign hash diverged.\n  golden: ${fixture.evidence.committedCampaignHash}\n  actual: ${committedCampaignHash}`);
}

const finalCampaignHash = hashCampaignState(final);
if (finalCampaignHash !== fixture.evidence.finalCampaignHash) {
  throw new Error(`Ruthless final campaign hash diverged.\n  golden: ${fixture.evidence.finalCampaignHash}\n  actual: ${finalCampaignHash}`);
}

if (matchFinalHash !== fixture.evidence.matchFinalHash) {
  throw new Error(`Ruthless match final-state hash diverged.\n  golden: ${fixture.evidence.matchFinalHash}\n  actual: ${matchFinalHash}`);
}

const completed = committed.schedule.find((row) => row.status === "completed")!;
if (hashMatchState(replayScheduledCampaignMatch(committed, completed.id)) !== matchFinalHash) {
  throw new Error("Stored ruthless campaign replay diverged from its recorded final-state hash.");
}

console.log(JSON.stringify({
  schema: fixture.schema,
  capturedPolicy: fixture.capturedPolicy,
  fixtureSha256: createHash("sha256").update(raw).digest("hex"),
  committedCampaignHash,
  finalCampaignHash,
  matchFinalHash,
  status: "verified",
}, null, 2));
