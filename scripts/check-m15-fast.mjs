import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const gates = [
  ["manual-compliance", process.execPath, ["scripts/verify-manual-compliance.mjs"]],
  ["typecheck", npm, ["run", "typecheck"]],
  ["focused-readiness", npm, ["exec", "--", "vitest", "run", "tests/m14-manual-mode.test.ts", "tests/m15-strict-manual.test.ts", "tests/m14-playable-readiness.test.ts", "tests/randomized-play-fair-ai.test.ts", "tests/save-determinism.test.ts", "tests/replay-verifier.test.ts"]],
  ["production-build", npm, ["run", "build"]],
  ["manifest-pins", process.execPath, ["scripts/check-manifest-pins.mjs"]],
];

const results = [];
for (const [name, command, args] of gates) {
  const started = Date.now();
  console.log(`\n=== M15 fast gate: ${name} ===`);
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  results.push({ name, command: [command, ...args].join(" "), status: result.status === 0 ? "passed" : "failed", exitCode: result.status ?? 1, durationMs: Date.now() - started });
  if (result.status !== 0) break;
}

await mkdir(resolve("output/readiness"), { recursive: true });
await writeFile(resolve("output/readiness/m15-fast-verification.json"), `${JSON.stringify({ schema: "ringcraft-m15-fast-verification-v1", completedAt: new Date().toISOString(), results }, null, 2)}\n`, "utf8");
const failed = results.find((entry) => entry.status === "failed");
console.log(`\nM15 fast verification: ${failed ? "failed" : "passed"}`);
process.exit(failed ? 1 : 0);
