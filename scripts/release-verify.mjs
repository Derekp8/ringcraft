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

async function readJsonIfPresent(path) {
  try { return JSON.parse(await readFile(resolve(path), "utf8")); }
  catch { return null; }
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
  ["focused-playability", npm, ["exec", "--", "vitest", "run", "tests/m14-manual-mode.test.ts", "tests/m15-strict-manual.test.ts", "tests/m14-playable-readiness.test.ts", "tests/randomized-play-fair-ai.test.ts", "tests/save-determinism.test.ts"]],
  ["unit-integration", npm, ["run", "test"]],
  ["ai-decision-quality", npm, ["exec", "--", "vitest", "run", "tests/m15-ai-quality.test.ts"]],
  ["ai-quality-report", process.execPath, ["scripts/run-typescript-module.mjs", "scripts/generate-m15-ai-quality.ts"]],
  ["production-build", npm, ["run", "build"]],
  ["fixture-replay-verification", npm, ["run", "fixtures:verify"]],
  ["manifest-pins", process.execPath, ["scripts/check-manifest-pins.mjs"]],
  ["browser-e2e", process.execPath, ["scripts/browser-e2e.mjs"]],
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
const classificationCounts = {};
for (const record of compliance.records ?? []) classificationCounts[record.classification] = (classificationCounts[record.classification] ?? 0) + 1;
const aiQuality = await readJsonIfPresent("output/readiness/ai-decision-quality.json");
const browserE2e = await readJsonIfPresent("output/readiness/browser-e2e.json");
const cleanroomBuild = await readJsonIfPresent("output/m9/m9-build.json");
const cleanroomVerification = await readJsonIfPresent("output/m9/m9-verification.json");
const report = {
  schema: "ringcraft-release-verification-v2",
  startedAt,
  completedAt: new Date().toISOString(),
  gitCommit: capture("git", ["rev-parse", "HEAD"]),
  packageVersion: packageJson.version,
  nodeVersion: process.version,
  npmVersion: capture(npm, ["--version"]),
  automatedStatus: failed ? "failed" : "passed",
  automatedReleaseGateStatement: failed ? "AUTOMATED RELEASE GATES NOT YET PASSED" : "AUTOMATED RELEASE GATES PASSED",
  fullReleaseApproval: false,
  gates: results,
  counts: {
    discoveredTestFiles: testFiles.length,
    complianceRecords: compliance.records?.length ?? 0,
    complianceByClassification: classificationCounts,
    corePlayableSmokeScenarios: 5,
    browserE2eScenarios: browserE2e?.scenarios?.length ?? 0,
    aiQualityRows: aiQuality?.rows?.length ?? 0,
    aiQualityMatches: aiQuality?.totals?.matches ?? 0,
    aiQualityDecisions: aiQuality?.totals?.aiDecisions ?? 0,
  },
  deterministicIdentities: {
    aiPolicyVersion: aiQuality?.aiPolicyVersion ?? null,
    note: "Release verification never regenerates deterministic pins to obtain a pass. Fixture/replay/rules/data identities remain authoritative in committed evidence and HANDOFF-MANIFEST.json unless an intentional reviewed behavior change versions them.",
  },
  artifacts: {
    aiDecisionQuality: aiQuality ? "output/readiness/ai-decision-quality.json" : null,
    browserE2e: browserE2e ? "output/readiness/browser-e2e.json" : null,
    cleanroomArchiveName: cleanroomBuild?.archiveName ?? null,
    cleanroomArchiveBytes: cleanroomBuild?.bytes ?? null,
    cleanroomArchiveSha256: cleanroomBuild?.sha256 ?? null,
    cleanroomVerified: cleanroomVerification?.verified ?? null,
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
    : "AUTOMATED RELEASE-CANDIDATE GATES PASSED — HUMAN/EXTERNAL QA PENDING",
};

await mkdir(resolve("output/readiness"), { recursive: true });
await writeFile(resolve("output/readiness/release-verification.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`\nrelease-verification: ${report.automatedStatus}`);
console.log("release-verification report: output/readiness/release-verification.json");
console.log(report.automatedReleaseGateStatement);
console.log(`full release approval: ${report.fullReleaseApproval ? "yes" : "no — human/external gates remain"}`);
console.log(`release assessment: ${report.releaseAssessment}`);
process.exit(failed ? 1 : 0);
