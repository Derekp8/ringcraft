import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSaveDeterminismFixture } from "./save-determinism";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const fixtureDirectory = join(projectRoot, "fixtures", "saves");
const fixturePath = join(fixtureDirectory, "save-determinism-v1.json");

const fixture = await buildSaveDeterminismFixture(new Date().toISOString());
await mkdir(fixtureDirectory, { recursive: true });
await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);

console.log(JSON.stringify({
  schema: fixture.schema,
  policy: fixture.policy,
  campaigns: fixture.campaigns.map((campaign) => ({ key: campaign.key, campaignId: campaign.campaignId })),
  bundleMerge: {
    observationHash: fixture.bundleMerge.observationHash,
    totals: fixture.bundleMerge.observation.applyTotals,
    finalSaves: fixture.bundleMerge.observation.finalSaves.length,
  },
  autosaveRing: {
    observationHash: fixture.autosaveRing.observationHash,
    writes: fixture.autosaveRing.observation.writes.map((write) => ({ savedAt: write.savedAt, key: write.meta.key, pruned: write.pruned })),
    deleteAfter: fixture.autosaveRing.observation.delete.ringAfter.length,
    promotedName: fixture.autosaveRing.observation.promote.name,
    capPrunes: fixture.autosaveRing.observation.capPrunes.map((step) => ({ cap: step.cap, removed: step.removed })),
  },
  remoteSync: {
    observationHash: fixture.remoteSync.observationHash,
    steps: fixture.remoteSync.observation.steps.map((step) => ({ op: step.op, status: step.status, serverRevisionAfter: step.serverRevisionAfter, message: step.message })),
    syncMeta: fixture.remoteSync.observation.syncMeta,
    finalServerSaves: fixture.remoteSync.observation.finalServerSaves.length,
  },
  fixtureHash: fixture.fixtureHash,
}, null, 2));
