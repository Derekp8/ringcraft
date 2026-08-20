import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { advanceUntilPlayerDecision, createMatch, exportReplayDocument, submitPlayerIntent, WRESTLERS } from "../src/core/index.ts";
import type { Intent, MatchState } from "../src/core/types.ts";
import { buildTitleShotChainFixture } from "./m13-title-shot-chain.ts";
import { buildFeudHeatChainFixture } from "./m13-feud-heat-chain.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const outputDirectory = join(projectRoot, "fixtures", "replays");

/** The DecisionPanel's default filters (prepared moves only, charm-0 variants) — the visual gate's click order. */
function intentCharm(intent: Intent): number | null {
  if (intent.type === "attack" || intent.type === "irish-whip") return intent.attackCharm;
  if (["recover", "tag", "distract-referee", "pin-interference"].includes(intent.type)) return (intent as { charm: number }).charm;
  return null;
}
function firstVisibleAction(cursor: MatchState) {
  const decision = cursor.decision!;
  const raw = decision.actions;
  const hasCharmVariants = decision.kind !== "damage-charm" && raw.some((action) => (intentCharm(action.intent) ?? 0) > 0);
  for (const action of raw) {
    const actionCharm = intentCharm(action.intent);
    if (hasCharmVariants && actionCharm !== null && actionCharm !== 0) continue;
    if (action.label.includes("(untrained)")) continue;
    return action;
  }
  return raw[0];
}

const fixtureWrestler = (id: keyof typeof WRESTLERS, teamId: "player" | "ai") => ({
  ...structuredClone(WRESTLERS[id]),
  id,
  teamId,
  sourceRecordId: WRESTLERS[id].id,
});

function playToResult(match: MatchState): MatchState {
  let cursor = match;
  let guard = 0;
  while (!cursor.result && guard < 8000) {
    cursor = advanceUntilPlayerDecision(cursor);
    if (cursor.result) break;
    const action = firstVisibleAction(cursor);
    cursor = submitPlayerIntent(cursor, action.intent);
    guard += 1;
  }
  if (!cursor.result) throw new Error("match did not reach a result");
  return cursor;
}

const scenarios = [
  {
    name: "ruthless-seed-1991-v2",
    match: createMatch({
      seed: 1991,
      aiDifficulty: "ruthless",
      roster: { "player-a": fixtureWrestler("player-a", "player"), "ai-a": fixtureWrestler("ai-a", "ai") },
      teamMembers: { player: ["player-a"], ai: ["ai-a"] },
    }),
  },
  {
    name: "tag-seed-1991-v2",
    match: createMatch({
      seed: 1991,
      mode: "tag",
      aiDifficulty: "standard",
      roster: {
        "player-a": fixtureWrestler("player-a", "player"),
        "player-b": fixtureWrestler("player-b", "player"),
        "ai-a": fixtureWrestler("ai-a", "ai"),
        "ai-b": fixtureWrestler("ai-b", "ai"),
      },
      teamMembers: { player: ["player-a", "player-b"], ai: ["ai-a", "ai-b"] },
    }),
  },
];

await mkdir(outputDirectory, { recursive: true });
for (const scenario of scenarios) {
  const final = playToResult(scenario.match);
  const document = exportReplayDocument(final);
  const path = join(outputDirectory, `${scenario.name}.json`);
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`wrote ${path} (${final.inputLog.length} inputs, state ${document.expectedStateHash})`);
}

// The respond-title-shot event chain fixture: the campaign-level replay corpus
// companion. Derived from the same canonical spec the verifier re-derives, so
// the pinned offer id, roll line, event details, and campaign-hash chain links
// are the engine's own output.
const chainFixture = buildTitleShotChainFixture();
const chainPath = join(outputDirectory, "title-shot-chain-v1.json");
await writeFile(chainPath, `${JSON.stringify(chainFixture, null, 2)}\n`);
console.log(`wrote ${chainPath} (offer ${chainFixture.evidence.offer.id}, fixtureHash ${chainFixture.fixtureHash})`);

// The feud-heat event chain fixture: start-feud → a committed feud match → a
// cold month's monthly decay, derived from the same canonical spec the
// verifier re-derives. Pins the feud identity, the heat movement, the
// matched-month-never-cools invariant, and the campaign-hash chain links.
const feudChainFixture = buildFeudHeatChainFixture();
const feudChainPath = join(outputDirectory, "feud-heat-chain-v1.json");
await writeFile(feudChainPath, `${JSON.stringify(feudChainFixture, null, 2)}\n`);
console.log(`wrote ${feudChainPath} (feud ${feudChainFixture.evidence.feud.id}, fixtureHash ${feudChainFixture.fixtureHash})`);
