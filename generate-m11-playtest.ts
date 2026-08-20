import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlaytestBalanceReport } from "./m11-playtest-io";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const fixturePath = join(projectRoot, "fixtures", "m11", "playtest-balance-report-v1.json");
const detailPath = join(projectRoot, "output", "playtest", "playtest-balance-report-v1.detail.json");

const report = await buildPlaytestBalanceReport();
await mkdir(join(projectRoot, "output", "playtest"), { recursive: true });
await writeFile(fixturePath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(detailPath, `${JSON.stringify(report, null, 2)}\n`);

const batches = report.batches.map((batch) => ({
  label: batch.label,
  variety: batch.variety,
  difficulty: batch.difficulty,
  matches: batch.matches.length,
}));
console.log(JSON.stringify({ schema: report.schema, reportHash: report.reportHash, batches, analytics: report.analytics }, null, 2));
