import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashMatchState } from "../src/core";
import { M11_REPLAY_SCHEMA, runVarietyMatchHeadless, varietyMatchSetup } from "./m11-match-variety";
import type { VarietyReplayFixture } from "./m11-match-variety";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const fixtureDirectory = join(projectRoot, "fixtures", "m11");

/**
 * Fixtures are fully canonical matches (no scripted rolls): the generator
 * searches seeds deterministically for the first cage match that ends by
 * escape and the first ladder match that ends by retrieval, then pins the
 * config, input log, winner, and final hash. The seeded search keeps the
 * fixture stable across regenerations and exercises the softening requirement
 * (the win condition becomes legal only after the opponent is beaten).
 */
const SEED_SEARCH_LIMIT = 2000;

function build(variety: "cage" | "ladder", expectedWinMethod: "escape" | "retrieval"): VarietyReplayFixture {
  for (let seed = 1; seed <= SEED_SEARCH_LIMIT; seed += 1) {
    const state = runVarietyMatchHeadless(varietyMatchSetup(variety, seed));
    if (!state.result) continue;
    if (state.result.method !== expectedWinMethod) continue;
    return {
      schemaVersion: M11_REPLAY_SCHEMA,
      label: `${variety}-${expectedWinMethod}-seed-${seed}`,
      variety,
      seed,
      matchConfig: state.config,
      inputLog: [...state.inputLog],
      expectedWinMethod: state.result.method,
      expectedWinnerId: state.result.winnerId!,
      expectedFinalMatchHash: hashMatchState(state),
    };
  }
  throw new Error(`No seed under ${SEED_SEARCH_LIMIT} produced a ${expectedWinMethod} win for variety ${variety}.`);
}

const fixtures: VarietyReplayFixture[] = [
  build("cage", "escape"),
  build("ladder", "retrieval"),
];

await mkdir(fixtureDirectory, { recursive: true });
for (const fixture of fixtures) {
  const name = fixture.variety === "cage" ? "cage-replay.json" : "ladder-replay.json";
  await writeFile(join(fixtureDirectory, name), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${join(fixtureDirectory, name)} (${fixture.label}, ${fixture.expectedWinMethod}, ${fixture.expectedFinalMatchHash})`);
}
