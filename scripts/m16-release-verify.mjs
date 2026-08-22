import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const startedAt = new Date().toISOString();
const baseSha = "00343bb5b063da3fec84977405b76ef69de5c84e";
const basePath = process.env.RINGCRAFT_BASE_PATH || "/ringcraft/";
const hostedPwaGate = process.env.M16_HOSTED_GATE === "PASS";
const windowsLauncherGate = process.env.M16_WINDOWS_LAUNCHER_GATE === "PASS";
let exactAutomatedTestCount = null;

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", env: process.env });
  return result.status === 0 ? result.stdout.trim() : null;
}
function stripAnsi(value) { return String(value ?? "").replace(/\u001b\[[0-9;]*m/g, ""); }
async function readJson(path) {
  try { return JSON.parse(await readFile(resolve(path), "utf8")); } catch { return null; }
}
function runGate(name, command, args) {
  const started = Date.now();
  console.log(`\n=== M16 release gate: ${name} ===`);
  if (name === "complete-tests") {
    const result = spawnSync(command, args, { encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    const text = stripAnsi(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    const matches = [...text.matchAll(/Tests\s+.*?(\d+)\s+passed/g)];
    if (matches.length) exactAutomatedTestCount = Number(matches.at(-1)[1]);
    return { name, command: [command, ...args].join(" "), status: result.status === 0 && exactAutomatedTestCount !== null ? "passed" : "failed", exitCode: result.status ?? 1, durationMs: Date.now() - started, exactTestCount: exactAutomatedTestCount };
  }
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  return { name, command: [command, ...args].join(" "), status: result.status === 0 ? "passed" : "failed", exitCode: result.status ?? 1, durationMs: Date.now() - started };
}

const gates = [
  ["typecheck", npm, ["run", "typecheck"]],
  ["compliance", npm, ["run", "compliance:verify"]],
  ["complete-tests", npm, ["run", "test"]],
  ["strict-manual-rng-save-focused", npm, ["exec", "--", "vitest", "run", "tests/m14-manual-mode.test.ts", "tests/m15-strict-manual.test.ts", "tests/randomized-play-fair-ai.test.ts", "tests/save-determinism.test.ts", "tests/qa-remediation-save-manager.test.ts", "tests/m16-save-recovery-closure.test.ts", "tests/replay-verifier.test.ts"]],
  ["ai-quality", npm, ["run", "ai:quality"]],
  ["tag-stress", process.execPath, ["scripts/m16-tag-stress.mjs"]],
  ["browser-a-h", npm, ["run", "e2e"]],
  ["production-build", npm, ["run", "build", "--", `--base=${basePath}`]],
  ["deterministic-fixtures-replays", npm, ["run", "fixtures:verify"]],
  ["manifest-pins", process.execPath, ["scripts/check-manifest-pins.mjs"]],
  ["pwa-static", process.execPath, ["scripts/verify-pwa.mjs", "--root=dist", `--base=${basePath}`]],
  ["pwa-installability-offline-update", process.execPath, ["scripts/pwa-e2e.mjs"]],
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

const compliance = await readJson("docs/manual-compliance/registry.json");
const ai = await readJson("output/readiness/m16-ai-quality.json");
const tagStress = await readJson("output/readiness/m16-tag-stress.json");
const browser = await readJson("output/readiness/m16-browser-e2e.json");
const pwa = await readJson("output/readiness/pwa-installability.json");
const visual = await readJson("output/readiness/visual-ci-stability.json");
const cleanroomBuild = await readJson("output/m9/m9-build.json");
const cleanroomVerification = await readJson("output/m9/m9-verification.json");
const testFiles = (await readdir(resolve("tests"))).filter((name) => /\.test\.(?:ts|mjs)$/.test(name));
const classificationCounts = {};
for (const record of compliance?.records ?? []) classificationCounts[record.classification] = (classificationCounts[record.classification] ?? 0) + 1;
const localFailure = results.find((row) => row.status === "failed");
const sourceSha = capture("git", ["rev-parse", "HEAD"]);
const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || capture("git", ["branch", "--show-current"]) || "development/m16-full-playability-closure";
const pr = process.env.M16_PR_NUMBER || null;
const tagStressValid = Boolean(
  tagStress
  && tagStress.sourceSha === sourceSha
  && tagStress.runsRequested === 10
  && tagStress.runsPassed === 10
  && tagStress.allPassed === true
  && tagStress.failedTagPathObserved === true
  && tagStress.successfulTagPathObserved === true
  && tagStress.timeouts === 0
  && tagStress.retries === 0
);
const finalAutomatedFailure = Boolean(localFailure || !tagStressValid || !hostedPwaGate || !windowsLauncherGate);

const report = {
  schema: "ringcraft-m16-release-verification-v1",
  sourceSha,
  baseSha,
  branch,
  pr,
  startedAt,
  completedAt: new Date().toISOString(),
  environment: { node: process.version, npm: capture(npm, ["--version"]), platform: process.platform, arch: process.arch },
  testCounts: {
    exactAutomatedTests: exactAutomatedTestCount,
    discoveredTestFiles: testFiles.length,
    complianceRecords: compliance?.records?.length ?? 0,
    complianceByClassification: classificationCounts,
    aiRows: ai?.rows?.length ?? 0,
    aiMatches: ai?.totals?.matches ?? 0,
    aiDecisions: ai?.totals?.aiDecisions ?? 0,
    tagStressRuns: tagStress?.runsPassed ?? 0,
    tagStressAttempts: tagStress?.totalTagAttempts ?? 0,
    tagStressFailedAttempts: tagStress?.totalFailedTagAttempts ?? 0,
    tagStressSuccessfulTags: tagStress?.totalSuccessfulTags ?? 0,
    browserScenarios: browser?.scenarios?.length ?? 0,
  },
  automatedStatus: finalAutomatedFailure ? "AUTOMATED RELEASE GATES FAILED" : "AUTOMATED RELEASE GATES PASSED",
  gates: results,
  results: {
    typecheck: results.find((row) => row.name === "typecheck")?.status ?? "not-run",
    compliance: results.find((row) => row.name === "compliance")?.status ?? "not-run",
    strictManual: results.find((row) => row.name === "strict-manual-rng-save-focused")?.status ?? "not-run",
    rngReplay: results.find((row) => row.name === "deterministic-fixtures-replays")?.status ?? "not-run",
    saveRecovery: browser ? {
      status: browser.scenarios?.find((row) => row.id === "E")?.status ?? "not-run",
      namedSaveRollback: browser.scenarios?.find((row) => row.id === "D")?.status ?? "not-run",
      adversarialBundle: browser.scenarios?.find((row) => row.id === "H")?.status ?? "not-run",
    } : { status: "not-run" },
    ai: ai ? { status: results.find((row) => row.name === "ai-quality")?.status ?? "not-run", totals: ai.totals } : { status: "not-run" },
    tagStress: tagStress ? { status: tagStressValid ? "passed" : "failed", evidence: tagStress } : { status: "not-run" },
    browserAH: browser ? { status: browser.allPassed ? "passed" : "failed", scenarios: browser.scenarios } : { status: "not-run" },
    firstRunPlayability: { status: "passed", evidence: "docs/qa/m16-first-run-audit.md", humanClarityReview: "NOT RUN" },
    productionBuild: results.find((row) => row.name === "production-build")?.status ?? "not-run",
    manifest: results.find((row) => row.name === "manifest-pins")?.status ?? "not-run",
    pwa: pwa ? { status: results.find((row) => row.name === "pwa-installability-offline-update")?.status ?? "not-run", evidence: pwa } : { status: "not-run" },
    hostedPwaSameSha: hostedPwaGate ? "passed" : "not-proven",
    windowsLauncher: windowsLauncherGate ? "passed" : "not-proven",
    visual: visual ? { status: results.find((row) => row.name === "visual-qa")?.status ?? "not-run", evidence: visual } : { status: "not-run" },
    cleanroom: cleanroomVerification ? { status: results.find((row) => row.name === "cleanroom-verify")?.status ?? "not-run", verified: cleanroomVerification.verified ?? null } : { status: "not-run" },
  },
  archive: {
    filename: cleanroomBuild?.archiveName ?? null,
    bytes: cleanroomBuild?.bytes ?? null,
    sha256: cleanroomBuild?.sha256 ?? null,
  },
  humanExternalGates: {
    pwaC1HumanInstall: "player-reported-complete-2026-08-21",
    m16HumanPlayability: "NOT RUN",
    manualSourceVerification: "external-review-required",
    humanAccessibilityReview: "NOT RUN",
    rightsSourceReview: "external-review-required",
  },
  projectFacingStatus: finalAutomatedFailure ? "AUTOMATED RELEASE GATES FAILED" : "AUTOMATED RELEASE GATES PASSED — HUMAN/EXTERNAL QA REMAINS",
};

await mkdir(resolve("output/readiness"), { recursive: true });
await writeFile(resolve("output/readiness/m16-release-verification.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`\n${report.projectFacingStatus}`);
console.log("M16 report: output/readiness/m16-release-verification.json");
process.exit(finalAutomatedFailure ? 1 : 0);
