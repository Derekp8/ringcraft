import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  M10_CAPTURED_POLICY,
  M10_RUTHLESS_CAMPAIGN_SCHEMA,
  RUTHLESS_CAMPAIGN_DERIVATION,
  buildRuthlessCampaignEvidence,
} from "./m10-ruthless-campaign";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const fixturePath = join(projectRoot, "fixtures", "m10", "ruthless-campaign-v1.json");

const fixture = {
  schema: M10_RUTHLESS_CAMPAIGN_SCHEMA,
  capturedPolicy: M10_CAPTURED_POLICY,
  derivation: RUTHLESS_CAMPAIGN_DERIVATION,
  evidence: buildRuthlessCampaignEvidence(RUTHLESS_CAMPAIGN_DERIVATION),
};

await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", "utf8");
console.log(`Wrote ${fixturePath}`);
console.log(JSON.stringify(fixture.evidence, null, 2));
