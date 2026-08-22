import { readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(new URL("./browser-e2e.mjs", import.meta.url));
const runtimePath = fileURLToPath(new URL("./.m16-tag-stress-runtime.mjs", import.meta.url));
const artifactPath = fileURLToPath(new URL("../output/readiness/m16-tag-stress.json", import.meta.url));
const runsRequested = 10;

const sourceShaResult = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (sourceShaResult.status !== 0) throw new Error(`Unable to identify Tag stress source SHA: ${sourceShaResult.stderr || sourceShaResult.stdout}`);
const sourceSha = sourceShaResult.stdout.trim();

const source = await readFile(sourcePath, "utf8");
const marker = 'const server = await createServer({ root: fileURLToPath(ROOT), server: { host: "127.0.0.1", port: 4174, strictPort: true } });';
const firstMarker = source.indexOf(marker);
if (firstMarker < 0) throw new Error("Tag stress could not locate the authoritative browser runner boundary.");
if (source.indexOf(marker, firstMarker + marker.length) >= 0) throw new Error("Tag stress found multiple authoritative browser runner boundaries.");

const stressMain = `${marker}
await server.listen();
const browser = await launchBrowser();
const started = Date.now();
const runsRequested = Number(process.env.M16_TAG_STRESS_RUNS || "10");
const report = {
  schema: "ringcraft-m16-tag-stress-v1",
  sourceSha: process.env.M16_TAG_STRESS_SOURCE_SHA || null,
  runsRequested,
  runsPassed: 0,
  allPassed: false,
  totalTagAttempts: 0,
  totalFailedTagAttempts: 0,
  totalSuccessfulTags: 0,
  failedTagPathObserved: false,
  successfulTagPathObserved: false,
  timeouts: 0,
  retries: 0,
  durationMs: 0,
  runs: [],
};
let failure = null;
try {
  for (let run = 1; run <= runsRequested; run += 1) {
    const runStarted = Date.now();
    const { context, page, errors } = await newPage(browser);
    try {
      const result = await exhibitionTag(page);
      if (errors.length) throw new Error(\`Browser console/page errors: \${errors.join(" | ")}\`);
      const successfulTags = result.tagAttempts - result.failedTagAttempts;
      if (successfulTags < 1) throw new Error(\`Tag stress run \${run} completed without a successful rendered Tag.\`);
      report.totalTagAttempts += result.tagAttempts;
      report.totalFailedTagAttempts += result.failedTagAttempts;
      report.totalSuccessfulTags += successfulTags;
      report.runsPassed += 1;
      report.runs.push({
        run,
        durationMs: Date.now() - runStarted,
        decisions: result.decisions,
        tagAttempts: result.tagAttempts,
        failedTagAttempts: result.failedTagAttempts,
        successfulTags,
        successfulTransition: result.actualTag,
        matchComplete: true,
        canonicalReplayVerified: true,
        browserErrors: 0,
        passed: true,
      });
    } catch (error) {
      const message = String(error);
      if (/timeout/i.test(message)) report.timeouts += 1;
      report.runs.push({
        run,
        durationMs: Date.now() - runStarted,
        browserErrors: errors.length,
        passed: false,
        error: message,
      });
      failure = error;
      break;
    } finally {
      await context.close();
    }
  }
  report.failedTagPathObserved = report.totalFailedTagAttempts > 0;
  report.successfulTagPathObserved = report.totalSuccessfulTags > 0;
  if (!failure && report.runsPassed !== runsRequested) failure = new Error(\`Tag stress completed only \${report.runsPassed}/\${runsRequested} runs.\`);
  if (!failure && !report.failedTagPathObserved) failure = new Error("Tag stress completed 10 runs without exercising a legitimate failed-Tag path.");
  if (!failure && !report.successfulTagPathObserved) failure = new Error("Tag stress did not exercise a successful Tag path.");
  if (!failure && report.timeouts !== 0) failure = new Error(\`Tag stress recorded \${report.timeouts} timeout(s).\`);
  if (!failure && report.retries !== 0) failure = new Error(\`Tag stress recorded \${report.retries} retry/retries.\`);
  report.allPassed = !failure;
} finally {
  report.durationMs = Date.now() - started;
  if (failure) report.error = String(failure);
  await writeFile(new URL("m16-tag-stress.json", outputDirectory), \`\${JSON.stringify(report, null, 2)}\\n\`, "utf8");
  await browser.close();
  await server.close();
}
if (failure) throw failure;
console.log(\`m16-tag-stress: \${report.runsPassed}/\${report.runsRequested} passed; \${report.totalTagAttempts} Tag attempts, \${report.totalFailedTagAttempts} failed attempts, \${report.totalSuccessfulTags} successful Tags.\`);
`;

const runtimeSource = `${source.slice(0, firstMarker)}${stressMain}`;
await writeFile(runtimePath, runtimeSource, "utf8");
let result;
try {
  result = spawnSync(process.execPath, [runtimePath], {
    stdio: "inherit",
    env: {
      ...process.env,
      M16_TAG_STRESS_RUNS: String(runsRequested),
      M16_TAG_STRESS_SOURCE_SHA: sourceSha,
    },
  });
} finally {
  await rm(runtimePath, { force: true });
}

if (result.status !== 0) process.exit(result.status ?? 1);
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
if (artifact.sourceSha !== sourceSha) throw new Error(`Tag stress artifact source SHA mismatch: ${artifact.sourceSha} != ${sourceSha}.`);
if (artifact.runsRequested !== runsRequested || artifact.runsPassed !== runsRequested || artifact.allPassed !== true) throw new Error(`Tag stress artifact did not prove ${runsRequested}/${runsRequested} consecutive passes.`);
if (!artifact.failedTagPathObserved || !artifact.successfulTagPathObserved) throw new Error("Tag stress artifact did not prove both failed-Tag and successful-Tag paths.");
if (artifact.timeouts !== 0 || artifact.retries !== 0) throw new Error("Tag stress artifact recorded a timeout or retry.");
