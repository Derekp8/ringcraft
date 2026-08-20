import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMatch, fnv1a32, hashMatchState } from "../src/core/index.ts";
import { M11_REPLAY_SCHEMA, replayVarietyFixture, runVarietyMatchHeadless, varietyMatchSetup } from "./m11-match-variety.ts";
import type { VarietyReplayFixture } from "./m11-match-variety.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

const names = ["cage-replay.json", "ladder-replay.json"];
const summary: Array<Record<string, unknown>> = [];

for (const name of names) {
  const raw = await readFile(join(projectRoot, "fixtures", "m11", name), "utf8");
  const fixture: VarietyReplayFixture = JSON.parse(raw);
  if (fixture.schemaVersion !== M11_REPLAY_SCHEMA) throw new Error(`${name}: unsupported schema.`);

  // 1. Replay the recorded config + player input log (AI re-derived).
  const replayed = replayVarietyFixture(fixture);
  if (!replayed.result) throw new Error(`${name}: replay did not reach a result.`);
  if (hashMatchState(replayed) !== fixture.expectedFinalMatchHash) {
    throw new Error(`${name}: replay hash diverged.\n  pinned: ${fixture.expectedFinalMatchHash}\n  actual: ${hashMatchState(replayed)}`);
  }
  if (replayed.result.method !== fixture.expectedWinMethod) throw new Error(`${name}: replay method diverged (${replayed.result.method}).`);
  if (replayed.result.winnerId !== fixture.expectedWinnerId) throw new Error(`${name}: replay winner diverged.`);

  // 2. Re-derive the whole match headlessly under the standard policy (the
  // corpus-style pin) and require the same terminal hash.
  const derived = runVarietyMatchHeadless(varietyMatchSetup(fixture.variety, fixture.seed, fixture.matchConfig.scriptedRolls ?? []));
  if (!derived.result) throw new Error(`${name}: full re-derivation did not reach a result.`);
  if (hashMatchState(derived) !== fixture.expectedFinalMatchHash) {
    throw new Error(`${name}: full re-derivation hash diverged.\n  pinned: ${fixture.expectedFinalMatchHash}\n  actual: ${hashMatchState(derived)}`);
  }

  // 3. Default-identity contract: a standard match from the same roster/seed
  // must serialize without any ladder or variety key.
  const standard = createMatch({ ...fixture.matchConfig, variety: undefined, scriptedRolls: undefined });
  const serialized = JSON.stringify(standard);
  if (serialized.includes('"ladder"') || serialized.includes('"variety"')) {
    throw new Error(`${name}: standard match serialization leaked M11 fields (default identity broken).`);
  }

  summary.push({
    file: name,
    variety: fixture.variety,
    seed: fixture.seed,
    winMethod: fixture.expectedWinMethod,
    winnerId: fixture.expectedWinnerId,
    inputs: fixture.inputLog.length,
    fixtureSha256: createHash("sha256").update(raw).digest("hex"),
    fixtureFnv1a32: fnv1a32(raw),
    finalMatchHash: fixture.expectedFinalMatchHash,
  });
}

console.log(JSON.stringify({ schema: M11_REPLAY_SCHEMA, fixtures: summary, status: "verified" }, null, 2));
