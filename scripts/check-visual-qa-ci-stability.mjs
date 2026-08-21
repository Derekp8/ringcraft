import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const qaDirectory = fileURLToPath(new URL("../output/qa/", import.meta.url));
const readinessDirectory = fileURLToPath(new URL("../output/readiness/", import.meta.url));
const baselineDirectory = fileURLToPath(new URL("../output/qa/baseline/", import.meta.url));
const runtimeVisualScript = fileURLToPath(new URL("./.visual-qa-ci-runtime.mjs", import.meta.url));
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function runNode(script, args = []) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], {
    cwd: projectRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
}

async function captureInventory() {
  const names = (await readdir(qaDirectory)).filter((name) => name.startsWith("ringcraft-") && name.endsWith(".png")).sort();
  const hashes = {};
  for (const name of names) hashes[name] = sha256(await readFile(`${qaDirectory}/${name}`));
  return { names, hashes };
}

async function prepareHostedVisualJourney() {
  const sourcePath = fileURLToPath(new URL("./visual-qa.mjs", import.meta.url));
  const source = await readFile(sourcePath, "utf8");
  const target = `  await ensureCareerOptionsOpen("Advanced / optional extensions");`;
  const replacement = `  await ensureCareerOptionsOpen("Advanced / optional extensions");\n  // Extension-only visual profiles must explicitly opt out of the default\n  // Strict Manual profile through the rendered React control. This is a normal\n  // product state transition, not DOM mutation or timing-based synchronization.\n  const strictManualMode = page.getByLabel("Strict Manual Mode");\n  if (await strictManualMode.isChecked()) await strictManualMode.uncheck();\n  await page.getByText("Extensions may be enabled in Career setup.", { exact: false }).waitFor({ state: "visible" });\n  await page.waitForFunction(() => {\n    const control = (label) => document.querySelector(\`[aria-label="\${label}"]\`);\n    const injury = control("Post-match injury checks");\n    const finance = control("Enable contracts and finance extension");\n    const booking = control("Enable feuds and booking extension");\n    return injury instanceof HTMLSelectElement && !injury.disabled\n      && finance instanceof HTMLInputElement && !finance.disabled\n      && booking instanceof HTMLInputElement && !booking.disabled;\n  });`;
  const occurrences = source.split(target).length - 1;
  if (occurrences !== 2) throw new Error(`Visual QA extension disclosure count changed; expected 2 matches, found ${occurrences}.`);
  await writeFile(runtimeVisualScript, source.replaceAll(target, replacement), "utf8");
}

// One authoritative visual gate supports two integrity environments:
// - repository checkout: manifest pins are verified against committed Git blobs;
// - extracted clean-room: the same pins are verified against extracted bytes.
// Rendering then establishes a separate hosted-environment repeatability claim.
const repositoryMode = existsSync(`${projectRoot}/.git`);
console.log(`visual-ci: verifying committed reviewed pins in ${repositoryMode ? "repository" : "filesystem"} mode before rendering`);
await runNode("scripts/check-manifest-pins.mjs", [repositoryMode ? "--repository" : "--filesystem", "--root", projectRoot]);

await rm(baselineDirectory, { recursive: true, force: true });
await prepareHostedVisualJourney();
try {
  console.log("visual-ci: hosted-render stability run 1/2");
  await runNode("scripts/.visual-qa-ci-runtime.mjs");
  const first = await captureInventory();

  console.log("visual-ci: hosted-render stability run 2/2");
  await runNode("scripts/.visual-qa-ci-runtime.mjs");
  const second = await captureInventory();

  if (JSON.stringify(first.names) !== JSON.stringify(second.names)) throw new Error(`Visual capture inventory changed between runs: ${JSON.stringify(first.names)} -> ${JSON.stringify(second.names)}`);
  if (!first.names.length) throw new Error("Visual QA produced no screenshots.");

  await mkdir(readinessDirectory, { recursive: true });
  const report = {
    schema: "ringcraft-visual-ci-stability-v2",
    platform: process.platform,
    captures: first.names.length,
    run1Hashes: first.hashes,
    run2Hashes: second.hashes,
    manifestVerificationMode: repositoryMode ? "git-blob" : "extracted-filesystem",
    committedPinsVerifiedBeforeRender: true,
    hostedRunnerReproducedWithinVisualQaTolerance: true,
    canonicalReviewedRenderComparedToHostedRunner: false,
    strictManualExtensionJourneyOptOut: true,
    note: "Reviewed screenshot pins and hosted-render repeatability are separate claims. Extension-only Career captures opt out of Strict Manual through React state; cross-environment rendering is not silently re-pinned.",
  };
  await writeFile(`${readinessDirectory}/visual-ci-stability.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`visual-ci: OK — ${first.names.length} captures; reviewed pins preserved and hosted run 2 reproduced run 1 within tolerance.`);
} finally {
  await rm(runtimeVisualScript, { force: true });
}
