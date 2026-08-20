import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlaytestTrendReport } from "./m11-playtest-trend-io";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const fixturePath = join(projectRoot, "fixtures", "m11", "playtest-trend-report-v1.json");
const detailPath = join(projectRoot, "output", "playtest", "playtest-trend-report-v1.detail.json");

const report = await buildPlaytestTrendReport();
await mkdir(join(projectRoot, "output", "playtest"), { recursive: true });
await writeFile(fixturePath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(detailPath, `${JSON.stringify(report, null, 2)}\n`);

const seasonCounts = report.seasons.map((season) => season.batches.reduce((sum, batch) => sum + batch.matches.length, 0));
console.log(JSON.stringify({ schema: report.schema, reportHash: report.reportHash, seasons: report.seasons.length, matchesPerSeason: seasonCounts, trend: report.trend }, null, 2));
