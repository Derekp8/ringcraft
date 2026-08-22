import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildAiDecisionQualityReport } from "./m15-ai-quality";

const base = buildAiDecisionQualityReport();
const report = {
  schema: "ringcraft-m16-ai-quality-v1",
  generatedAt: new Date().toISOString(),
  sourceCorpusSchema: base.schema,
  aiPolicyVersion: base.aiPolicyVersion,
  corpus: base.generatedFrom,
  modes: ["singles", "tag"],
  difficulties: ["novice", "standard", "veteran", "ruthless"],
  rows: base.rows,
  totals: base.totals,
  invariants: {
    illegalChoices: base.totals.illegalChoices,
    stalledOrNoActionStates: base.totals.stalled,
    replayDivergences: base.totals.replayDivergences,
    difficultyChangesRulesOrDice: false,
    difficultyBoundaryEvidence: [
      "tests/randomized-play-fair-ai.test.ts",
      "tests/m15-ai-quality.test.ts",
    ],
  },
};

await mkdir(resolve("output/readiness"), { recursive: true });
await writeFile(resolve("output/readiness/m16-ai-quality.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`m16-ai-quality: ${report.totals.matches} completed matches, ${report.totals.aiDecisions} AI decisions, ${report.totals.illegalChoices} illegal choices, ${report.totals.stalled} stalls, ${report.totals.replayDivergences} replay divergences`);
if (report.totals.illegalChoices || report.totals.stalled || report.totals.replayDivergences) process.exitCode = 1;
