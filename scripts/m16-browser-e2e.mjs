import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createBrotliDecompress } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { chromium } from "playwright-core";
import tarFs from "tar-fs";
import { createServer } from "vite";

const ROOT = new URL("../", import.meta.url);
const BASE_URL = "http://127.0.0.1:4175";
const outputDirectory = new URL("../output/readiness/", import.meta.url);
const runtimeDirectory = new URL("../output/readiness/m16-browser-runtime/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });
await mkdir(runtimeDirectory, { recursive: true });
process.env.TMPDIR = fileURLToPath(runtimeDirectory);
process.env.LD_LIBRARY_PATH = [fileURLToPath(new URL("al2023/lib/", runtimeDirectory)), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The established remediation suite is the authoritative A-H gameplay path.
run(process.execPath, ["scripts/browser-e2e.mjs"]);
const baseReport = JSON.parse(await readFile(new URL("browser-e2e.json", outputDirectory), "utf8"));
if (!Array.isArray(baseReport.scenarios) || baseReport.scenarios.length !== 8) throw new Error(`Expected 8 A-H scenarios, found ${baseReport.scenarios?.length ?? 0}.`);
for (const id of "ABCDEFGH") {
  const scenario = baseReport.scenarios.find((row) => row.id === id);
  if (!scenario || scenario.status !== "passed") throw new Error(`Base browser scenario ${id} did not pass.`);
}

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
    try { await access(candidate); return candidate; } catch { /* continue */ }
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

async function skipStartupTour(page) {
  const dialog = page.locator(".tour-overlay[role=dialog]");
  if (await dialog.count()) {
    await dialog.locator('button[aria-label="Skip the tour and remember that choice"]').click();
    await dialog.waitFor({ state: "detached" });
  }
}

async function startDeterministicCareer(page) {
  await page.getByRole("button", { name: "Career" }).click();
  if (!(await page.getByLabel("Strict Manual Mode").isChecked())) throw new Error("Strict Manual Mode was not the default Career profile.");
  await page.getByText("Developer / deterministic options").click();
  await page.getByRole("button", { name: "Start generated league with manual seed" }).click();
  await page.getByRole("heading", { name: "Championships and obligations" }).waitFor({ state: "visible" });
}

async function createSave(page, name) {
  await page.getByLabel("New save name").fill(name);
  await page.getByRole("button", { name: "Save current campaign" }).click();
  await page.getByText(new RegExp(`Saved .* as "${name}"`)).waitFor({ state: "visible" });
}

const server = await createServer({ root: fileURLToPath(ROOT), server: { host: "127.0.0.1", port: 4175, strictPort: true } });
await server.listen();
const browser = await launchBrowser();
let lifecycle;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", timezoneId: "UTC" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await skipStartupTour(page);
  await startDeterministicCareer(page);
  await createSave(page, "Lifecycle Target");

  const target = page.locator(".save-row").filter({ hasText: "Lifecycle Target" }).first();
  if (!(await target.count())) throw new Error("Lifecycle Target save row was not created.");
  await target.getByRole("button", { name: "Duplicate" }).click();
  if ((await page.locator(".save-row").count()) !== 2) throw new Error("Duplicate did not create exactly one additional named save.");

  const duplicate = page.locator(".save-row").nth(1);
  page.once("dialog", (dialog) => dialog.accept("Lifecycle Renamed"));
  await duplicate.getByRole("button", { name: "Rename" }).click();
  const renamed = page.locator(".save-row").filter({ hasText: "Lifecycle Renamed" });
  await renamed.waitFor({ state: "visible" });

  page.once("dialog", (dialog) => dialog.dismiss());
  await renamed.getByRole("button", { name: "Delete" }).click();
  if (!(await page.locator(".save-row").filter({ hasText: "Lifecycle Renamed" }).count())) throw new Error("Delete-cancel removed the named save.");

  page.once("dialog", (dialog) => dialog.accept());
  await renamed.getByRole("button", { name: "Delete" }).click();
  await page.getByText(/Deleted save "Lifecycle Renamed"/).waitFor({ state: "visible" });
  if (await page.locator(".save-row").filter({ hasText: "Lifecycle Renamed" }).count()) throw new Error("Delete-confirm left the named save in storage.");
  if ((await page.locator(".save-row").count()) !== 1) throw new Error("Delete-confirm affected an unrelated save.");

  await page.getByRole("button", { name: "Advance one day" }).click();
  const current = page.locator(".save-row").filter({ hasText: "Lifecycle Target" });
  await current.getByRole("button", { name: "Update" }).click();
  await page.getByRole("group", { name: "Overwrite preview" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Confirm overwrite" }).click();
  await page.getByText(/Updated "Lifecycle Target" in place/).waitFor({ state: "visible" });
  if ((await page.locator(".save-row").count()) !== 1) throw new Error("Update-in-place changed the save count.");

  if (errors.length) throw new Error(`Browser console/page errors: ${errors.join(" | ")}`);
  lifecycle = {
    status: "passed",
    create: true,
    duplicate: true,
    rename: true,
    deleteCancel: true,
    deleteConfirm: true,
    unrelatedSavePreserved: true,
    updateInPlace: true,
  };
  await context.close();
} finally {
  await browser.close();
  await server.close();
}

const scenarioD = baseReport.scenarios.find((row) => row.id === "D");
scenarioD.namedSaveLifecycle = lifecycle;
const report = {
  schema: "ringcraft-m16-browser-e2e-v1",
  generatedAt: new Date().toISOString(),
  sourceSuite: baseReport.schema,
  scenarios: baseReport.scenarios,
  durationMs: baseReport.durationMs,
  allPassed: baseReport.scenarios.every((row) => row.status === "passed") && lifecycle.status === "passed",
};
await writeFile(new URL("m16-browser-e2e.json", outputDirectory), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`m16-browser-e2e: A-H passed; named-save lifecycle passed; ${report.scenarios.length} authoritative scenarios recorded.`);
if (!report.allPassed) process.exitCode = 1;
