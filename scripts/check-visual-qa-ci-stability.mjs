import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const qaDirectory = fileURLToPath(new URL("../output/qa/", import.meta.url));
const readinessDirectory = fileURLToPath(new URL("../output/readiness/", import.meta.url));
const baselineDirectory = fileURLToPath(new URL("../output/qa/baseline/", import.meta.url));
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function runNode(script) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [script], {
    cwd: projectRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
}

async function captureInventory() {
  const names = (await readdir(qaDirectory))
    .filter((name) => name.startsWith("ringcraft-") && name.endsWith(".png"))
    .sort();
  const hashes = {};
  for (const name of names) hashes[name] = sha256(await readFile(`${qaDirectory}/${name}`));
  return { names, hashes };
}

// Evidence boundary:
// 1. The committed reviewed screenshots are immutable evidence and their exact
//    SHA-256 values are verified before any CI render overwrites output/qa.
// 2. Hosted-Linux rendering is a separate reproducibility claim. The visual QA
//    harness establishes a baseline on run 1 and rejects run-2 drift beyond its
//    documented AA tolerance. We do not pretend a different OS/font rasterizer
//    is the same reviewed rendering environment, and we do not re-pin evidence
//    merely to make CI green.
console.log("visual-ci: verifying committed reviewed pins before rendering");
await runNode("scripts/check-manifest-pins.mjs");

await rm(baselineDirectory, { recursive: true, force: true });
console.log("visual-ci: hosted-Linux stability run 1/2");
await runNode("scripts/visual-qa.mjs");
const first = await captureInventory();

console.log("visual-ci: hosted-Linux stability run 2/2");
await runNode("scripts/visual-qa.mjs");
const second = await captureInventory();

if (JSON.stringify(first.names) !== JSON.stringify(second.names)) {
  throw new Error(`Visual capture inventory changed between runs: ${JSON.stringify(first.names)} -> ${JSON.stringify(second.names)}`);
}
if (!first.names.length) throw new Error("Visual QA produced no screenshots.");

await mkdir(readinessDirectory, { recursive: true });
const report = {
  schema: "ringcraft-visual-ci-stability-v1",
  platform: process.platform,
  captures: first.names.length,
  run1Hashes: first.hashes,
  run2Hashes: second.hashes,
  committedPinsVerifiedBeforeRender: true,
  hostedRunnerReproducedWithinVisualQaTolerance: true,
  canonicalReviewedRenderComparedToHostedRunner: false,
  note: "Committed screenshot SHA-256 pins and hosted-runner visual reproducibility are separate claims. Cross-environment layout differences are not silently re-pinned.",
};
await writeFile(`${readinessDirectory}/visual-ci-stability.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`visual-ci: OK — ${first.names.length} captures; reviewed pins preserved and hosted-Linux run 2 reproduced run 1 within the visual-QA tolerance.`);
