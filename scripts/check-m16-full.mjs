import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const basePath = process.env.RINGCRAFT_BASE_PATH || "/ringcraft/";
const gates = [
  ["typecheck", npm, ["run", "typecheck"]],
  ["compliance", process.execPath, ["scripts/verify-manual-compliance.mjs"]],
  ["unit-integration", npm, ["run", "test"]],
  ["deterministic-fixtures", npm, ["run", "fixtures:verify"]],
  ["ai-quality", npm, ["run", "ai:quality"]],
  ["browser-a-h", npm, ["run", "e2e"]],
  ["production-build", npm, ["run", "build", "--", `--base=${basePath}`]],
  ["pwa-static", process.execPath, ["scripts/verify-pwa.mjs", "--root=dist", `--base=${basePath}`]],
  ["pwa-browser", process.execPath, ["scripts/pwa-e2e.mjs"]],
  ["manifest-pins", process.execPath, ["scripts/check-manifest-pins.mjs"]],
  ["visual-qa", npm, ["run", "visual:qa"]],
  ["cleanroom-build", process.execPath, ["scripts/build-m9-handoff.mjs"]],
  ["cleanroom-verify", process.execPath, ["scripts/verify-m9-handoff.mjs"]],
];

const results = [];
for (const [name, command, args] of gates) {
  const started = Date.now();
  console.log(`\n=== M16 full gate: ${name} ===`);
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  results.push({ name, command: [command, ...args].join(" "), status: result.status === 0 ? "passed" : "failed", exitCode: result.status ?? 1, durationMs: Date.now() - started });
  if (result.status !== 0) break;
}
await mkdir(resolve("output/readiness"), { recursive: true });
await writeFile(resolve("output/readiness/m16-full-verification.json"), `${JSON.stringify({ schema: "ringcraft-m16-full-verification-v1", basePath, completedAt: new Date().toISOString(), results }, null, 2)}\n`, "utf8");
const failed = results.find((row) => row.status === "failed");
console.log(`M16 full verification: ${failed ? "failed" : "passed"}`);
process.exit(failed ? 1 : 0);
