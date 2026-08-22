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
    try { await access(candidate); return candidate; } catch { /* try next */ }
  }
  return null;
}

async function launchBrowser() {
  const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];
  try { return await chromium.launch({ headless: true, executablePath: await portableChromiumPath(), args }); }
  catch (error) {
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

function extractHash(text, label) {
  const match = String(text ?? "").match(/c14n-fnv1a64-v1:[0-9a-f]{16}/);
  if (!match) throw new Error(`${label} did not expose a canonical state hash: ${text}`);
  return match[0];
}

function extractSeed(text) {
  const match = String(text ?? "").match(/Current seed:\s*(\d+)/);
  if (!match) throw new Error(`Could not parse Exhibition seed from ${text}`);
  return Number(match[1]);
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

async function exhibitionStateHash(page) {
  const details = page.locator("details.technical-details");
  if (!(await details.getAttribute("open"))) await details.locator("summary").click();
  return extractHash(await details.locator("footer span").first().textContent(), "Exhibition technical details");
}

async function dashboardCampaignHash(page) {
  return extractHash(await page.getByText(/Canonical round trip:/).textContent(), "Career dashboard");
}

async function careerMatchHash(page) {
  return extractHash(await page.locator(".career-match footer span").first().textContent(), "Career match footer");
}

async function careerDate(page) {
  const heading = page.getByRole("heading", { name: "Private Ringcraft Career" });
  const text = await heading.locator("..").locator("p").first().textContent();
  const match = String(text ?? "").match(/\d{4}-\d{2}-\d{2}/);
  if (!match) throw new Error(`Career dashboard date missing from: ${text}`);
  return match[0];
}

async function openExhibitionAdvanced(page) {
  const details = page.getByRole("group", { name: "Advanced exhibition options" });
  if (!(await details.getAttribute("open"))) await page.getByText("Advanced / replay / developer options").click();
}

async function exhibitionSingles(page) {
  await openExhibitionAdvanced(page);
  const seeds = [extractSeed(await page.getByText(/Current seed:/).textContent())];
  if (!(await page.locator("button.action:visible").count())) throw new Error("Initial normal Exhibition was not playable after fresh initialization.");
  for (let index = 0; index < 2; index += 1) {
    await page.getByRole("button", { name: "Start match" }).click();
    seeds.push(extractSeed(await page.getByText(/Current seed:/).textContent()));
  }
  if (seeds.every((seed) => seed === 1991)) throw new Error("Normal Exhibition remained on the historical fixed QA seed 1991.");
  if (new Set(seeds).size === 1) throw new Error(`Three normal Exhibition initializations reused one seed (${seeds[0]}); fresh entropy boundary was not demonstrated.`);
  if ((await page.locator(".wrestler-card:visible").count()) !== 2) throw new Error("Singles board did not expose two wrestler cards.");
  const decisions = await clickActionsUntilResult(page);
  if (!(await page.getByText(/Canonical replay state verified/i).count())) throw new Error("Singles canonical replay verification indicator missing.");
  return { decisions, seeds };
}

async function exhibitionTag(page) {
  await page.getByLabel("Mode").selectOption("tag");
  await page.getByRole("button", { name: "Start match" }).click();
  if ((await page.locator(".wrestler-card:visible").count()) !== 4) throw new Error("Tag board did not expose four wrestler cards.");
  const partnerLabels = await page.locator(".wrestler-card__eyebrow:visible").allTextContents();
  if (!partnerLabels.some((text) => text.includes("APRON"))) throw new Error("Tag board did not expose an outside partner state.");
  let actualTag = null;
  let tagAttempts = 0;
  let failedTagAttempts = 0;
  let decisions = 0;
  while (decisions < 600 && !(await page.getByText("MATCH COMPLETE", { exact: true }).count())) {
    const tag = page.locator("button.action:visible").filter({ hasText: /^Tag/ }).first();
    if (await tag.count()) {
      const legalWrestler = page.locator(".wrestler-card--player.wrestler-card--legal h2");
      const before = await legalWrestler.textContent();
      if (!before) throw new Error("Rendered Tag action did not expose the current legal player wrestler before the attempt.");
      const beforeHash = await exhibitionStateHash(page);
      await tag.click();
      await page.waitForFunction((oldHash) => {
        const text = document.querySelector("details.technical-details footer span")?.textContent ?? "";
        const hash = text.match(/c14n-fnv1a64-v1:[0-9a-f]{16}/)?.[0];
        return Boolean(hash && hash !== oldHash);
      }, beforeHash);
      const afterHash = await exhibitionStateHash(page);
      const after = await legalWrestler.textContent();
      if (!after) throw new Error("Rendered Tag action did not expose a legal player wrestler after the attempt.");
      if (beforeHash === afterHash) throw new Error("Rendered Tag action did not advance canonical Exhibition state.");
      tagAttempts += 1;
      if (before === after) {
        const latestSummary = await page.locator(".event-log ol li").first().locator("summary").textContent();
        if (!String(latestSummary ?? "").toLowerCase().includes("fails to tag")) throw new Error(`Tag attempt preserved the legal wrestler without recording a failed Tag: ${latestSummary}`);
        failedTagAttempts += 1;
      } else {
        actualTag = { before, after, beforeHash, afterHash };
      }
    } else {
      const action = page.locator("button.action:visible").first();
      if (!(await action.count())) throw new Error(`No visible tag action at decision ${decisions}.`);
      await action.click();
    }
    decisions += 1;
  }
  if (!(await page.getByText("MATCH COMPLETE", { exact: true }).count())) throw new Error("Tag browser match did not finish.");
  if (!actualTag) throw new Error("Tag journey never executed a successful legal rendered Tag action.");
  if (!(await page.getByText(/Canonical replay state verified/i).count())) throw new Error("Tag canonical replay verification indicator missing.");
  return { decisions, tagAttempts, failedTagAttempts, actualTag };
}

async function startDeterministicCareer(page, { strict = true, finance = false } = {}) {
  await page.getByRole("button", { name: "Career" }).click();
  const strictControl = page.getByLabel("Strict Manual Mode");
  if (!(await strictControl.isChecked())) throw new Error("Strict Manual Mode is not the default Career profile.");
  if (!strict) {
    await strictControl.uncheck();
    await page.getByText("Extensions may be enabled in Career setup.", { exact: false }).waitFor({ state: "visible" });
  }
  await page.getByText("Advanced / optional extensions").click();
  if (strict) {
    for (const label of ["Post-match injury checks", "Enable contracts and finance extension", "Enable feuds and booking extension"]) {
      if (!(await page.getByLabel(label).isDisabled())) throw new Error(`${label} remained enabled under Strict Manual Mode.`);
    }
  } else if (finance) {
    const financeControl = page.getByLabel("Enable contracts and finance extension");
    if (await financeControl.isDisabled()) throw new Error("Finance extension remained disabled after Strict Manual opt-out.");
    await financeControl.check();
  }
  await page.getByText("Developer / deterministic options").click();
  await page.getByRole("button", { name: "Start generated league with manual seed" }).click();
  await page.getByRole("heading", { name: "Championships and obligations" }).waitFor({ state: "visible" });
  const expected = strict ? "Strict Manual compatible" : "Extensions active";
  await page.getByText(expected, { exact: true }).waitFor({ state: "visible" });
  if (!(await page.getByRole("heading", { name: "Rules compatibility" }).count())) throw new Error("Career dashboard omitted rules compatibility presentation.");
  if (!strict && finance && !(await page.getByText(/financePolicy/).count())) throw new Error("Extension Career did not enumerate financePolicy incompatibility.");
}

async function createNamedSave(page, name) {
  await page.getByLabel("New save name").fill(name);
  await page.getByRole("button", { name: "Save current campaign" }).click();
  if (!(await page.getByText(new RegExp(`Saved .* as "${name}"`)).count())) throw new Error(`Named Career save ${name} was not acknowledged.`);
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
  await page.getByRole("heading", { name: "Career match in progress" }).waitFor({ state: "visible" });
}

async function performCareerActions(page, count) {
  for (let index = 0; index < count; index += 1) {
    if (await page.getByText("MATCH COMPLETE", { exact: true }).count()) throw new Error(`Career match finished before checkpoint action ${index + 1}.`);
    const action = page.locator("button.action:visible").first();
    if (!(await action.count())) throw new Error(`Career path stalled before checkpoint action ${index + 1}.`);
    await action.click();
  }
}

async function finishCareerMatch(page, { doubleCommit = false } = {}) {
  const decisions = await clickActionsUntilResult(page, 800);
  const commit = page.getByRole("button", { name: "Commit official result" });
  if (doubleCommit) {
    const element = await commit.elementHandle();
    if (!element) throw new Error("Commit official result button was not rendered.");
    await element.evaluate((button) => { button.click(); button.click(); });
  } else {
    await commit.click();
  }
  await page.getByRole("heading", { name: "Championships and obligations" }).waitFor({ state: "visible" });
  const latest = page.getByText("Latest official result").locator("..");
  const text = await latest.textContent();
  const match = text?.match(/replay (c14n-fnv1a64-v1:[0-9a-f]{16})/);
  if (!match) throw new Error(`Career dashboard did not expose the committed replay identity: ${text}`);
  return { decisions, replayHash: match[1], finalCampaignHash: await dashboardCampaignHash(page) };
}

async function careerPath(browser, { recover = false, doubleCommit = false, reloadAfterCommit = false } = {}) {
  const { context, page, errors } = await newPage(browser);
  try {
    await startDeterministicCareer(page);
    await createNamedSave(page, recover ? "Recovery Checkpoint" : "Reference Checkpoint");
    await scheduleAndOpenCareerMatch(page);
    await performCareerActions(page, 4);
    const checkpointHash = await careerMatchHash(page);
    if (recover) {
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Career" }).click();
      await page.getByRole("heading", { name: "Career match in progress" }).waitFor({ state: "visible" });
      const restored = await careerMatchHash(page);
      if (checkpointHash !== restored) throw new Error(`Browser recovery changed campaign identity: ${checkpointHash} != ${restored}`);
    }
    await performCareerActions(page, 1);
    const afterNextActionHash = await careerMatchHash(page);
    const result = await finishCareerMatch(page, { doubleCommit });
    if (reloadAfterCommit) {
      const beforeReload = result.finalCampaignHash;
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Career" }).click();
      await page.getByRole("heading", { name: "Championships and obligations" }).waitFor({ state: "visible" });
      const afterReload = await dashboardCampaignHash(page);
      if (beforeReload !== afterReload) throw new Error(`Committed Career reload changed campaign identity: ${beforeReload} != ${afterReload}`);
    }
    if (errors.length) throw new Error(`Browser console/page errors: ${errors.join(" | ")}`);
    return { ...result, checkpointHash, afterNextActionHash };
  } finally { await context.close(); }
}

async function namedSaveRollback(browser) {
  const { context, page, errors } = await newPage(browser);
  try {
    await startDeterministicCareer(page);
    const targetHash = await dashboardCampaignHash(page);
    const targetDate = await careerDate(page);
    await createNamedSave(page, "Rollback Target");
    await page.getByRole("button", { name: "Advance one day" }).click();
    const advancedDate = await careerDate(page);
    if (advancedDate === targetDate) throw new Error("Career did not advance before rollback test.");
    const row = page.locator(".save-row").filter({ hasText: "Rollback Target" });
    await row.getByRole("button", { name: "Load" }).click();
    await page.getByRole("group", { name: "Restore preview" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Confirm restore" }).click();
    const restoredDate = await careerDate(page);
    const restoredHash = await dashboardCampaignHash(page);
    if (restoredDate !== targetDate || restoredHash !== targetHash) throw new Error(`Named-save rollback identity mismatch: ${restoredDate}/${restoredHash} vs ${targetDate}/${targetHash}`);
    if (errors.length) throw new Error(`Browser console/page errors: ${errors.join(" | ")}`);
    return { targetDate, advancedDate, targetHash, restoredHash };
  } finally { await context.close(); }
}

async function extensionCareer(browser) {
  const { context, page, errors } = await newPage(browser);
  try {
    await startDeterministicCareer(page, { strict: false, finance: true });
    const before = await dashboardCampaignHash(page);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Career" }).click();
    await page.getByText("Extensions active", { exact: true }).waitFor({ state: "visible" });
    if (!(await page.getByText(/financePolicy/).count())) throw new Error("Reloaded extension campaign lost its finance compatibility violation.");
    const after = await dashboardCampaignHash(page);
    if (before !== after) throw new Error(`Extension campaign reload changed canonical identity: ${before} != ${after}`);
    const advance = page.getByRole("button", { name: "Advance one day" });
    if (!(await advance.count()) || await advance.isDisabled()) throw new Error("Extension-enabled Career was not playable after reload.");
    if (errors.length) throw new Error(`Browser console/page errors: ${errors.join(" | ")}`);
    return { before, after, financeViolationRetained: true };
  } finally { await context.close(); }
}

async function deterministicExhibitionAction(browser, clicks, staleProbe = false) {
  const { context, page, errors } = await newPage(browser);
  try {
    await openExhibitionAdvanced(page);
    await page.getByLabel("Seed").fill("60061");
    await page.getByRole("button", { name: "Start with manual seed" }).click();
    const before = await exhibitionStateHash(page);
    const action = page.locator("button.action:visible").first();
    const element = await action.elementHandle();
    if (!element) throw new Error("Deterministic Exhibition did not expose a player action.");
    if (clicks === 1) await action.click();
    else await element.evaluate((button) => { button.click(); button.click(); });
    await page.waitForFunction((oldHash) => {
      const text = document.querySelector("details.technical-details footer span")?.textContent ?? "";
      const hash = text.match(/c14n-fnv1a64-v1:[0-9a-f]{16}/)?.[0];
      return Boolean(hash && hash !== oldHash);
    }, before);
    const after = await exhibitionStateHash(page);
    let staleAfter = null;
    if (staleProbe) {
      await element.evaluate((button) => button.click());
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      staleAfter = await exhibitionStateHash(page);
      if (staleAfter !== after) throw new Error(`Detached stale action mutated replacement state: ${after} -> ${staleAfter}`);
    }
    if (errors.length) throw new Error(`Browser console/page errors: ${errors.join(" | ")}`);
    return { before, after, staleAfter };
  } finally { await context.close(); }
}

async function saveBundleValidation(browser) {
  let validBundle;
  {
    const { context, page, errors } = await newPage(browser);
    try {
      await startDeterministicCareer(page);
      await createNamedSave(page, "Portable Valid");
      validBundle = await page.evaluate(() => {
        const prefix = "asw91-campaign-save-";
        const key = Object.keys(localStorage).find((candidate) => candidate.startsWith(prefix));
        if (!key) throw new Error("No named save was stored for bundle fixture.");
        return JSON.stringify({ schema: "asw91-campaign-save-bundle-v1", exportedAt: new Date().toISOString(), saves: [{ key, value: localStorage.getItem(key) }] });
      });
      if (errors.length) throw new Error(`Browser console/page errors: ${errors.join(" | ")}`);
    } finally { await context.close(); }
  }

  const parsed = JSON.parse(validBundle);
  const corrupt = structuredClone(parsed);
  const corruptRecord = JSON.parse(corrupt.saves[0].value);
  corruptRecord.updatedAt = "2099-01-01T00:00:00.000Z";
  corruptRecord.campaignJson = "{";
  corrupt.saves[0].value = JSON.stringify(corruptRecord);
  const corruptBundle = JSON.stringify(corrupt);

  const { context, page, errors } = await newPage(browser);
  try {
    await page.getByRole("button", { name: "Career" }).click();
    const input = page.getByLabel("Import save bundle");
    await input.setInputFiles({ name: "valid-bundle.json", mimeType: "application/json", buffer: Buffer.from(validBundle) });
    await page.getByRole("group", { name: "Import bundle preview" }).waitFor({ state: "visible" });
    if (!(await page.getByText(/Will add 1 new/).count())) throw new Error("Valid save bundle was not classified as an import.");
    await page.getByRole("button", { name: "Apply import" }).click();
    const row = page.locator(".save-row").filter({ hasText: "Portable Valid" });
    if (!(await row.count())) throw new Error("Valid save bundle was not imported into the save list.");

    await input.setInputFiles({ name: "corrupt-newer-bundle.json", mimeType: "application/json", buffer: Buffer.from(corruptBundle) });
    await page.getByRole("group", { name: "Import bundle preview" }).waitFor({ state: "visible" });
    if (!(await page.getByText(/skip 1 invalid/).count())) throw new Error("Corrupt newer save was not classified as skipped.");
    if (!(await page.getByText(/Campaign payload failed validation/).count())) throw new Error("Corrupt save did not expose its validation failure reason.");
    await page.getByRole("button", { name: "Apply import" }).click();
    const stillPresent = page.locator(".save-row").filter({ hasText: "Portable Valid" });
    if (!(await stillPresent.count())) throw new Error("Corrupt bundle destroyed the valid local save.");
    await stillPresent.getByRole("button", { name: "Load" }).click();
    await page.getByRole("heading", { name: "Championships and obligations" }).waitFor({ state: "visible" });
    const loadedHash = await dashboardCampaignHash(page);
    if (errors.length) throw new Error(`Browser console/page errors: ${errors.join(" | ")}`);
    return { validImported: true, corruptSkipped: true, localSaveLoadable: true, loadedHash };
  } finally { await context.close(); }
}

const server = await createServer({ root: fileURLToPath(ROOT), server: { host: "127.0.0.1", port: 4174, strictPort: true } });
await server.listen();
const browser = await launchBrowser();
const started = Date.now();
const report = { schema: "ringcraft-browser-e2e-v2", scenarios: [], durationMs: 0 };
try {
  {
    const { context, page, errors } = await newPage(browser);
    try {
      report.scenarios.push({ id: "A", name: "exhibition-singles-fresh-entropy", status: "passed", ...(await exhibitionSingles(page)) });
      if (errors.length) throw new Error(errors.join(" | "));
    } finally { await context.close(); }
  }
  {
    const { context, page, errors } = await newPage(browser);
    try {
      report.scenarios.push({ id: "B", name: "exhibition-tag-actual-tag", status: "passed", ...(await exhibitionTag(page)) });
      if (errors.length) throw new Error(errors.join(" | "));
    } finally { await context.close(); }
  }

  const reference = await careerPath(browser, { recover: false, doubleCommit: false, reloadAfterCommit: true });
  report.scenarios.push({ id: "C", name: "strict-manual-career", status: "passed", ...reference });

  report.scenarios.push({ id: "D", name: "named-save-rollback", status: "passed", ...(await namedSaveRollback(browser)) });

  const recovered = await careerPath(browser, { recover: true, doubleCommit: true, reloadAfterCommit: false });
  if (reference.checkpointHash !== recovered.checkpointHash) throw new Error(`Recovery reference checkpoint mismatch: ${reference.checkpointHash} != ${recovered.checkpointHash}.`);
  if (reference.afterNextActionHash !== recovered.afterNextActionHash) throw new Error(`Recovery next-action/RNG state ${recovered.afterNextActionHash} diverged from uninterrupted reference ${reference.afterNextActionHash}.`);
  if (reference.replayHash !== recovered.replayHash) throw new Error(`Recovered Career result ${recovered.replayHash} diverged from uninterrupted reference ${reference.replayHash}.`);
  if (reference.finalCampaignHash !== recovered.finalCampaignHash) throw new Error(`Double-commit/recovery campaign ${recovered.finalCampaignHash} diverged from single-commit reference ${reference.finalCampaignHash}.`);
  report.scenarios.push({ id: "E", name: "mid-match-recovery-next-rng", status: "passed", ...recovered, referenceReplayHash: reference.replayHash, referenceNextActionHash: reference.afterNextActionHash });

  report.scenarios.push({ id: "F", name: "extension-career-retention", status: "passed", ...(await extensionCareer(browser)) });

  const single = await deterministicExhibitionAction(browser, 1, false);
  const duplicate = await deterministicExhibitionAction(browser, 2, true);
  if (single.after !== duplicate.after) throw new Error(`Rapid duplicate rendered action changed deterministic state: one=${single.after}, double=${duplicate.after}.`);
  report.scenarios.push({ id: "G", name: "stale-duplicate-protection", status: "passed", singleActionHash: single.after, duplicateActionHash: duplicate.after, staleActionHash: duplicate.staleAfter, singleCommitCampaignHash: reference.finalCampaignHash, duplicateCommitCampaignHash: recovered.finalCampaignHash });

  report.scenarios.push({ id: "H", name: "save-bundle-validation", status: "passed", ...(await saveBundleValidation(browser)) });

  report.durationMs = Date.now() - started;
  await writeFile(new URL("browser-e2e.json", outputDirectory), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`browser-e2e: ${report.scenarios.length} remediation scenarios A-H passed in ${report.durationMs}ms`);
} catch (error) {
  report.durationMs = Date.now() - started;
  report.error = String(error);
  await writeFile(new URL("browser-e2e.json", outputDirectory), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  throw error;
} finally {
  await browser.close();
  await server.close();
}
