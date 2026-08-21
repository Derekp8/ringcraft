import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildAiDecisionQualityReport } from "./m15-ai-quality";

const report = buildAiDecisionQualityReport();
await mkdir(resolve("output/readiness"), { recursive: true });
await writeFile(resolve("output/readiness/ai-decision-quality.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`m15-ai-quality: ${report.totals.matches} completed matches, ${report.totals.aiDecisions} AI decisions, ${report.totals.illegalChoices} illegal choices, ${report.totals.replayDivergences} replay divergences`);
if (report.totals.illegalChoices || report.totals.stalled || report.totals.replayDivergences) process.exitCode = 1;
