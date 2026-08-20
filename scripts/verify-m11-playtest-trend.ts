import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLAYTEST_TREND_SCHEMA } from "./m11-playtest-trend";
import type { PlaytestTrendReport } from "./m11-playtest-trend";
import { verifyPlaytestTrendReport } from "./m11-playtest-trend-io";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const raw = await readFile(join(projectRoot, "fixtures", "m11", "playtest-trend-report-v1.json"), "utf8");
const report = JSON.parse(raw) as PlaytestTrendReport;
if (report.schema !== PLAYTEST_TREND_SCHEMA) throw new Error("M11 playtest trend report schema is unsupported.");

const result = await verifyPlaytestTrendReport(report);
if (!result.ok) throw new Error(`M11 playtest trend report verification failed:\n${result.errors.join("\n")}`);

const matchCount = report.seasons.reduce((sum, season) => sum + season.batches.reduce((total, batch) => total + batch.matches.length, 0), 0);
console.log(JSON.stringify({
  schema: report.schema,
  reportHash: report.reportHash,
  policy: report.policy,
  seasons: report.seasons.length,
  matchesReplayed: matchCount,
  trend: report.trend,
  fixtureSha256: createHash("sha256").update(raw).digest("hex"),
  status: "verified",
}, null, 2));
