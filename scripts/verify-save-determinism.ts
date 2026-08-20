import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SAVE_DETERMINISM_SCHEMA, verifySaveDeterminismFixture } from "./save-determinism";
import type { SaveDeterminismFixture } from "./save-determinism";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const raw = await readFile(join(projectRoot, "fixtures", "saves", "save-determinism-v1.json"), "utf8");
const fixture = JSON.parse(raw) as SaveDeterminismFixture;
if (fixture.schema !== SAVE_DETERMINISM_SCHEMA) throw new Error("Save-determinism fixture schema is unsupported.");

const result = await verifySaveDeterminismFixture(fixture);
if (!result.ok) throw new Error(`Save-determinism fixture verification failed:\n${result.errors.join("\n")}`);

console.log(JSON.stringify({
  schema: fixture.schema,
  policy: fixture.policy,
  bundleMerge: {
    observationHash: result.bundleMergeHash,
    totals: fixture.bundleMerge.observation.applyTotals,
    finalSaves: fixture.bundleMerge.observation.finalSaves.length,
  },
  autosaveRing: {
    observationHash: result.autosaveRingHash,
    writes: fixture.autosaveRing.observation.writes.length,
    deleteAfter: fixture.autosaveRing.observation.delete.ringAfter.length,
    promotedName: fixture.autosaveRing.observation.promote.name,
    capPrunes: fixture.autosaveRing.observation.capPrunes.map((step) => ({ cap: step.cap, removed: step.removed })),
  },
  remoteSync: {
    observationHash: result.remoteSyncHash,
    steps: fixture.remoteSync.observation.steps.map((step) => ({ op: step.op, status: step.status, serverRevisionAfter: step.serverRevisionAfter, message: step.message })),
    syncMeta: fixture.remoteSync.observation.syncMeta,
    finalServerSaves: fixture.remoteSync.observation.finalServerSaves.length,
  },
  fixtureHash: result.fixtureHash,
  fixtureSha256: createHash("sha256").update(raw).digest("hex"),
  status: "verified",
}, null, 2));
