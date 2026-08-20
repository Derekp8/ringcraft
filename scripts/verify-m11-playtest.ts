import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLAYTEST_BALANCE_SCHEMA } from "./m11-playtest-batch.ts";
import { verifyPlaytestBalanceReport } from "./m11-playtest-io.ts";
import type { PlaytestBalanceReport } from "./m11-playtest-batch.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const raw = await readFile(join(projectRoot, "fixtures", "m11", "playtest-balance-report-v1.json"), "utf8");
const report = JSON.parse(raw) as PlaytestBalanceReport;
if (report.schema !== PLAYTEST_BALANCE_SCHEMA) throw new Error("M11 playtest balance report schema is unsupported.");

const result = await verifyPlaytestBalanceReport(report);
if (!result.ok) throw new Error(`M11 playtest balance report verification failed:\n${result.errors.join("\n")}`);

const matchCount = report.batches.reduce((sum, batch) => sum + batch.matches.length, 0);
// Per-difficulty AI win shares, re-derived from the pinned batches by
// `verifyPlaytestBalanceReport`. Exposed as a dedicated machine-readable field
// so the clean-room manifest check can pin each value numerically and assert
// the strict novice < standard < veteran < ruthless ladder ordering on the
// re-derived numbers, independently of tests/m10-ai.test.ts.
const ladderWinShares = report.analytics.winShare.byDifficulty;
console.log(JSON.stringify({
  schema: report.schema,
  reportHash: report.reportHash,
  policy: report.policy,
  matchesReplayed: matchCount,
  replaySamples: result.replaySamples,
  ladderWinShares,
  analytics: report.analytics,
  fixtureSha256: createHash("sha256").update(raw).digest("hex"),
  status: "verified",
}, null, 2));
