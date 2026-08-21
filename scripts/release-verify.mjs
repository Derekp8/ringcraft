import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const startedAt = new Date().toISOString();
const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const compliance = JSON.parse(await readFile(resolve("docs/manual-compliance/registry.json"), "utf8"));
const testFiles = (await readdir(resolve("tests"))).filter((name) => name.endsWith(".test.ts"));

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function runGate(name, command, args) {
  const started = Date.now();
  console.log(`\n=== release gate: ${name} ===`);
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  return {
    name,
    command: [command, ...args].join(" "),
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status ?? 1,
    durationMs: Date.now() - started,
  };
}

const gates = [
  ["manual-compliance", process.execPath, ["scripts/verify-manual-compliance.mjs"]],
  ["typecheck", npm, ["run", "typecheck"]],
  ["unit-integration", npm, ["run", "test"]],
  ["production-build", npm, ["run", "build"]],
  ["playable-e2e-smoke", npm, ["exec", "--", "vitest", "run", "tests/m14-playable-readiness.test.ts", "tests/m14-manual-mode.test.ts", "tests/randomized-play-fair-ai.test.ts", "tests/save-determinism.test.ts"]],
  ["fixture-replay-verification", npm, ["run", "fixtures:verify"]],
  ["manifest-pins", process.execPath, ["scripts/check-manifest-pins.mjs"]],
  ["visual-qa", npm, ["run", "visual:qa"]],
  ["cleanroom-build", process.execPath, ["scripts/build-m9-handoff.mjs"]],
  ["cleanroom-verify", process.execPath, ["scripts/verify-m9-handoff.mjs"]],
];

const results = [];
for (const gate of gates) {
  const result = runGate(...gate);
  results.push(result);
  if (result.status === "failed") break;
}

const failed = results.find((gate) => gate.status === "failed");
const report = {
  schema: "ringcraft-release-verification-v1",
  startedAt,
  completedAt: new Date().toISOString(),
  gitCommit: capture("git", ["rev-parse", "HEAD"]),
  packageVersion: packageJson.version,
  nodeVersion: process.version,
  npmVersion: capture(npm, ["--version"]),
  automatedStatus: failed ? "failed" : "passed",
  gates: results,
  counts: {
    discoveredTestFiles: testFiles.length,
    complianceRecords: compliance.records?.length ?? 0,
    playableSmokeScenarios: 4,
  },
  deterministicIdentities: {
    note: "This verifier does not regenerate or rewrite deterministic pins. Fixture/replay identities remain authoritative in their committed fixtures and HANDOFF-MANIFEST.json unless an intentional reviewed behavior change versions them.",
  },
  unresolvedExternalGates: [
    "independent second-human rules transcription/adjudication sign-off",
    "human screen-reader/accessibility certification",
    "human playtest acceptance",
    "historical source material absent from repository history",
    "rights/commercial review outside private scope",
  ],
  releaseAssessment: failed
    ? "PLAYABLE BUT NOT RELEASE-CANDIDATE READY"
    : "RELEASE-CANDIDATE READY PENDING HUMAN/EXTERNAL QA",
};

await mkdir(resolve("output/readiness"), { recursive: true });
await writeFile(resolve("output/readiness/release-verification.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`\nrelease-verification: ${report.automatedStatus}`);
console.log("release-verification report: output/readiness/release-verification.json");
console.log(`release assessment: ${report.releaseAssessment}`);
process.exit(failed ? 1 : 0);
