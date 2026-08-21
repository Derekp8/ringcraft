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
const runtimeVisualScript = fileURLToPath(new URL("./.visual-qa-ci-runtime.mjs", import.meta.url));
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

async function prepareHostedVisualJourney() {
  const sourcePath = fileURLToPath(new URL("./visual-qa.mjs", import.meta.url));
  const source = await readFile(sourcePath, "utf8");
  const target = `  await ensureCareerOptionsOpen("Advanced / optional extensions");`;
  const replacement = `  await ensureCareerOptionsOpen("Advanced / optional extensions");\n  // Every visual profile that enters the extension-only Career controls must\n  // explicitly leave the default Strict Manual profile first. Keep this at the\n  // common disclosure boundary so injury/finance/booking and tag-feud captures\n  // exercise the same rendered product transition rather than special-casing\n  // individual controls. The wait is state-based, never an arbitrary sleep.\n  const strictManualMode = page.getByLabel("Strict Manual Mode");\n  if (await strictManualMode.isChecked()) await strictManualMode.uncheck();\n  await page.getByText("Extensions may be enabled in Career setup.", { exact: false }).waitFor({ state: "visible" });\n  await page.waitForFunction(() => {\n    const control = (label) => document.querySelector(\`[aria-label="\${label}"]\`);\n    const injury = control("Post-match injury checks");\n    const finance = control("Enable contracts and finance extension");\n    const booking = control("Enable feuds and booking extension");\n    return injury instanceof HTMLSelectElement && !injury.disabled\n      && finance instanceof HTMLInputElement && !finance.disabled\n      && booking instanceof HTMLInputElement && !booking.disabled;\n  });`;
  const occurrences = source.split(target).length - 1;
  if (occurrences !== 2) throw new Error(`Visual QA extension disclosure count changed; expected 2 matches, found ${occurrences}.`);
  await writeFile(runtimeVisualScript, source.replaceAll(target, replacement), "utf8");
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
await prepareHostedVisualJourney();
try {
  console.log("visual-ci: hosted-Linux stability run 1/2");
  await runNode("scripts/.visual-qa-ci-runtime.mjs");
  const first = await captureInventory();

  console.log("visual-ci: hosted-Linux stability run 2/2");
  await runNode("scripts/.visual-qa-ci-runtime.mjs");
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
    strictManualExtensionJourneyOptOut: true,
    note: "Committed screenshot SHA-256 pins and hosted-runner visual reproducibility are separate claims. Every extension-only Career capture explicitly opts out of Strict Manual Mode through the rendered React control; cross-environment layout differences are not silently re-pinned.",
  };
  await writeFile(`${readinessDirectory}/visual-ci-stability.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`visual-ci: OK — ${first.names.length} captures; reviewed pins preserved and hosted-Linux run 2 reproduced run 1 within the visual-QA tolerance.`);
} finally {
  await rm(runtimeVisualScript, { force: true });
}
