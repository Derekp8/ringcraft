import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createBrotliDecompress } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { chromium } from "playwright-core";
import tarFs from "tar-fs";
import { createServer } from "vite";

const ROOT = new URL("../", import.meta.url);
const BASE_URL = "http://127.0.0.1:4174";
const outputDirectory = new URL("../output/readiness/", import.meta.url);
const runtimeDirectory = new URL("../output/readiness/browser-runtime/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });
await mkdir(runtimeDirectory, { recursive: true });
process.env.TMPDIR = fileURLToPath(runtimeDirectory);
process.env.LD_LIBRARY_PATH = [fileURLToPath(new URL("al2023/lib/", runtimeDirectory)), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");

async function portableChromiumPath() {
  const executable = fileURLToPath(new URL("chromium", runtimeDirectory));
  const packageBin = new URL("../node_modules/@sparticuz/chromium/bin/", import.meta.url);
  await pipeline(createReadStream(fileURLToPath(new URL("chromium.br", packageBin))), createBrotliDecompress(), createWriteStream(executable, { mode: 0o700 }));
  await chmod(executable, 0o700);
  for (const [archive, destination] of [["fonts.tar.br", new URL("fonts/", runtimeDirectory)], ["swiftshader.tar.br", runtimeDirectory], ["al2023.tar.br", new URL("al2023/", runtimeDirectory)]]) {
    await mkdir(destination, { recursive: true });
    await pipeline(createReadStream(fileURLToPath(new URL(archive, packageBin))), createBrotliDecompress(), tarFs.extract(fileURLToPath(destination), { chown: false }));
  }
  return executable;
}

async function systemBrowserPath() {
  for (const candidate of ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
    try { await access(candidate); return candidate; } catch { /* next */ }
  }
  return null;
}

async function launchBrowser() {
  const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];
  try {
    return await chromium.launch({ headless: true, executablePath: await portableChromiumPath(), args });
  } catch (error) {
    const fallback = await systemBrowserPath();
    if (!fallback) throw error;
    return chromium.launch({ headless: true, executablePath: fallback, args });
  }
}

async function newPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", timezoneId: "UTC" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  const startupTour = page.locator(".tour-overlay[role=dialog]");
  if (await startupTour.count()) {
    await startupTour.locator('button[aria-label="Skip the tour and remember that choice"]').click();
    await startupTour.waitFor({ state: "detached" });
  }
  return { context, page, errors };
}

async function clickActionsUntilResult(page, maximum = 600) {
  let decisions = 0;
  while (decisions < maximum) {
    if (await page.getByText("MATCH COMPLETE", { exact: true }).count()) return decisions;
    const action = page.locator("button.action:visible").first();
    if (!(await action.count())) throw new Error(`No visible playable action at browser decision ${decisions}.`);
    await action.click();
    decisions += 1;
  }
  throw new Error(`Browser match did not reach an official result within ${maximum} player decisions.`);
}

async function exhibitionSingles(page) {
  const advanced = page.getByRole("group", { name: "Advanced exhibition options" });
  await page.getByText("Advanced / replay / developer options").click();
  const beforeSeed = await page.getByText(/Current seed:/).textContent();
  await page.getByRole("button", { name: "Start match" }).click();
  const afterSeed = await page.getByText(/Current seed:/).textContent();
  if (beforeSeed === afterSeed) throw new Error("Normal Exhibition start did not demonstrate a fresh seed boundary.");
  if (!(await page.locator(".wrestler-card:visible").count() === 2)) throw new Error("Singles board did not expose two wrestler cards.");
  const decisions = await clickActionsUntilResult(page);
  if (!(await page.getByText(/Replay verified/i).count())) throw new Error("Singles replay verification indicator missing.");
  return { decisions, beforeSeed, afterSeed, advancedVisible: await advanced.count() };
}

async function exhibitionTag(page) {
  await page.getByLabel("Mode").selectOption("tag");
  await page.getByRole("button", { name: "Start match" }).click();
  if (!(await page.locator(".wrestler-card:visible").count() === 4)) throw new Error("Tag board did not expose four wrestler cards.");
  const partnerLabels = await page.locator(".wrestler-card__eyebrow:visible").allTextContents();
  if (!partnerLabels.some((text) => text.includes("APRON"))) throw new Error("Tag board did not expose an outside partner state.");
  let sawTagChoice = false;
  let decisions = 0;
  while (decisions < 600 && !(await page.getByText("MATCH COMPLETE", { exact: true }).count())) {
    const tag = page.locator("button.action:visible").filter({ hasText: /^Tag/ }).first();
    const action = (await tag.count()) ? tag : page.locator("button.action:visible").first();
    if (!(await action.count())) throw new Error(`No visible tag action at decision ${decisions}.`);
    if (await tag.count()) sawTagChoice = true;
    await action.click();
    decisions += 1;
  }
  if (!(await page.getByText("MATCH COMPLETE", { exact: true }).count())) throw new Error("Tag browser match did not finish.");
  if (!sawTagChoice) throw new Error("Tag journey never exposed a legal Tag interaction.");
  return { decisions, sawTagChoice };
}

async function startDeterministicCareer(page) {
  await page.getByRole("button", { name: "Career" }).click();
  const strict = page.getByLabel("Strict Manual Mode");
  if (!(await strict.isChecked())) throw new Error("Strict Manual Mode is not the default Career profile.");
  for (const label of ["Post-match injury checks", "Enable contracts and finance extension", "Enable feuds and booking extension"]) {
    if (!(await page.getByLabel(label).isDisabled())) throw new Error(`${label} remained enabled under Strict Manual Mode.`);
  }
  await page.getByText("Developer / deterministic options").click();
  await page.getByRole("button", { name: "Start generated league with manual seed" }).click();
  if (!(await page.getByRole("heading", { name: "Rules compatibility" }).count())) throw new Error("Career dashboard omitted rules compatibility presentation.");
  if (!(await page.getByText("Strict Manual compatible", { exact: true }).count())) throw new Error("Strict Manual campaign was not labeled compatible.");
}

async function scheduleAndOpenCareerMatch(page) {
  let guard = 0;
  while (!(await page.getByRole("button", { name: "Accept and schedule" }).count()) && guard < 90) {
    const advance = page.getByRole("button", { name: "Advance one day" });
    if (!(await advance.count()) || await advance.isDisabled()) break;
    await advance.click();
    guard += 1;
  }
  const accept = page.getByRole("button", { name: "Accept and schedule" });
  if (!(await accept.count())) throw new Error("Career did not expose a schedulable match offer.");
  await accept.click();
  guard = 0;
  while (!(await page.getByRole("button", { name: "Play due match" }).count()) && guard < 90) {
    const advance = page.getByRole("button", { name: "Advance one day" });
    if (!(await advance.count()) || await advance.isDisabled()) break;
    await advance.click();
    guard += 1;
  }
  const play = page.getByRole("button", { name: "Play due match" });
  if (!(await play.count())) throw new Error("Scheduled Career match never became due.");
  await play.click();
  if (!(await page.getByRole("heading", { name: "Career match in progress" }).count())) throw new Error("Career match surface did not open.");
}

async function finishCareerMatch(page) {
  const decisions = await clickActionsUntilResult(page, 800);
  await page.getByRole("button", { name: "Commit official result" }).click();
  const latest = page.getByText("Latest official result").locator("..");
  const text = await latest.textContent();
  const match = text?.match(/replay (c14n-fnv1a64-v1:[0-9a-f]{16})/);
  if (!match) throw new Error(`Career dashboard did not expose the committed replay identity: ${text}`);
  return { decisions, replayHash: match[1] };
}

async function careerPath(browser, recover) {
  const { context, page, errors } = await newPage(browser);
  try {
    await startDeterministicCareer(page);
    await page.getByLabel("New save name").fill(recover ? "M15 Recovery" : "M15 Reference");
    await page.getByRole("button", { name: "Save current campaign" }).click();
    if (!(await page.getByText(/Saved .* as/).count())) throw new Error("Named Career save was not acknowledged.");
    await scheduleAndOpenCareerMatch(page);
    if (recover) {
      for (let index = 0; index < 4; index += 1) {
        const action = page.locator("button.action:visible").first();
        if (!(await action.count())) throw new Error(`Recovery path stalled before checkpoint ${index}.`);
        await action.click();
      }
      const before = await page.locator(".career-match footer span").first().textContent();
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Career" }).click();
      if (!(await page.getByRole("heading", { name: "Career match in progress" }).count())) throw new Error("Reload did not restore the in-progress Career match.");
      const after = await page.locator(".career-match footer span").first().textContent();
      if (before !== after) throw new Error(`Browser recovery changed campaign identity: ${before} != ${after}`);
    }
    const result = await finishCareerMatch(page);
    if (errors.length) throw new Error(`Browser console/page errors: ${errors.join(" | ")}`);
    return result;
  } finally {
    await context.close();
  }
}

const server = await createServer({ root: fileURLToPath(ROOT), server: { host: "127.0.0.1", port: 4174, strictPort: true } });
await server.listen();
const browser = await launchBrowser();
const started = Date.now();
const report = { schema: "ringcraft-browser-e2e-v1", scenarios: [], durationMs: 0 };
try {
  {
    const { context, page, errors } = await newPage(browser);
    try {
      report.scenarios.push({ name: "exhibition-singles", status: "passed", ...(await exhibitionSingles(page)) });
      if (errors.length) throw new Error(errors.join(" | "));
    } finally { await context.close(); }
  }
  {
    const { context, page, errors } = await newPage(browser);
    try {
      report.scenarios.push({ name: "exhibition-tag", status: "passed", ...(await exhibitionTag(page)) });
      if (errors.length) throw new Error(errors.join(" | "));
    } finally { await context.close(); }
  }
  const reference = await careerPath(browser, false);
  report.scenarios.push({ name: "career-first-match-save", status: "passed", ...reference });
  const recovered = await careerPath(browser, true);
  if (reference.replayHash !== recovered.replayHash) throw new Error(`Recovered Career result ${recovered.replayHash} diverged from uninterrupted reference ${reference.replayHash}.`);
  report.scenarios.push({ name: "career-mid-match-recovery", status: "passed", ...recovered, referenceReplayHash: reference.replayHash });
  report.durationMs = Date.now() - started;
  await writeFile(new URL("browser-e2e.json", outputDirectory), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`browser-e2e: ${report.scenarios.length} scenarios passed in ${report.durationMs}ms`);
} catch (error) {
  report.durationMs = Date.now() - started;
  report.error = String(error);
  await writeFile(new URL("browser-e2e.json", outputDirectory), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  throw error;
} finally {
  await browser.close();
  await server.close();
}
