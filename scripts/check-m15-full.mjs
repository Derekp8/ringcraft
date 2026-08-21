import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const gates = [
  ["manual-compliance", process.execPath, ["scripts/verify-manual-compliance.mjs"]],
  ["canonical-check", npm, ["run", "check"]],
  ["m15-ai-quality", npm, ["exec", "--", "vitest", "run", "tests/m15-ai-quality.test.ts"]],
  ["ai-quality-report", process.execPath, ["scripts/run-typescript-module.mjs", "scripts/generate-m15-ai-quality.ts"]],
  ["browser-e2e", process.execPath, ["scripts/browser-e2e.mjs"]],
  ["fixture-replay-verification", npm, ["run", "fixtures:verify"]],
  ["manifest-pins", process.execPath, ["scripts/check-manifest-pins.mjs"]],
  ["visual-qa", npm, ["run", "visual:qa"]],
  ["cleanroom-build", process.execPath, ["scripts/build-m9-handoff.mjs"]],
  ["cleanroom-verify", process.execPath, ["scripts/verify-m9-handoff.mjs"]],
];

const results = [];
for (const [name, command, args] of gates) {
  const started = Date.now();
  console.log(`\n=== M15 full gate: ${name} ===`);
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  results.push({ name, command: [command, ...args].join(" "), status: result.status === 0 ? "passed" : "failed", exitCode: result.status ?? 1, durationMs: Date.now() - started });
  if (result.status !== 0) break;
}

await mkdir(resolve("output/readiness"), { recursive: true });
await writeFile(resolve("output/readiness/m15-full-verification.json"), `${JSON.stringify({ schema: "ringcraft-m15-full-verification-v1", completedAt: new Date().toISOString(), results }, null, 2)}\n`, "utf8");
const failed = results.find((entry) => entry.status === "failed");
console.log(`\nM15 full verification: ${failed ? "failed" : "passed"}`);
process.exit(failed ? 1 : 0);
