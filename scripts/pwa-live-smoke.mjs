import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createBrotliDecompress } from "node:zlib";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import tarFs from "tar-fs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const outputDirectory = path.join(ROOT, "output", "readiness");
const runtimeDirectory = path.join(outputDirectory, "pwa-live-runtime");
await mkdir(outputDirectory, { recursive: true });
await mkdir(runtimeDirectory, { recursive: true });
process.env.TMPDIR = runtimeDirectory;
process.env.LD_LIBRARY_PATH = [path.join(runtimeDirectory, "al2023", "lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");

const target = process.argv[2] || process.env.PWA_URL;
if (!target) throw new Error("Usage: node scripts/pwa-live-smoke.mjs <https://host/path/>");
const url = new URL(target);
if (url.protocol !== "https:") throw new Error(`Hosted PWA smoke requires HTTPS, got ${url.protocol}`);
if (!url.pathname.endsWith("/")) url.pathname += "/";

async function portableChromiumPath() {
  const executable = path.join(runtimeDirectory, "chromium");
  const packageBin = new URL("../node_modules/@sparticuz/chromium/bin/", import.meta.url);
  await pipeline(createReadStream(fileURLToPath(new URL("chromium.br", packageBin))), createBrotliDecompress(), createWriteStream(executable, { mode: 0o700 }));
  await chmod(executable, 0o700);
  for (const [archive, destination] of [["fonts.tar.br", path.join(runtimeDirectory, "fonts")], ["swiftshader.tar.br", runtimeDirectory], ["al2023.tar.br", path.join(runtimeDirectory, "al2023")]]) {
    await mkdir(destination, { recursive: true });
    await pipeline(createReadStream(fileURLToPath(new URL(archive, packageBin))), createBrotliDecompress(), tarFs.extract(destination, { chown: false }));
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
  try { return await chromium.launch({ headless: true, executablePath: await portableChromiumPath(), args }); }
  catch (error) {
    const fallback = await systemBrowserPath();
    if (!fallback) throw error;
    return chromium.launch({ headless: true, executablePath: fallback, args });
  }
}

async function gotoWithRetry(page) {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await page.goto(url.href, { waitUntil: "networkidle", timeout: 30000 });
      if (response?.ok()) return response;
      lastError = new Error(`HTTP ${response?.status() ?? "no response"}`);
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw lastError ?? new Error("Hosted page never became reachable.");
}

async function waitForController(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("service worker controller timeout")), 15000);
      navigator.serviceWorker.addEventListener("controllerchange", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  });
}

const evidence = {
  schema: "ringcraft-pwa-live-smoke-v1",
  sourceSha: process.env.GITHUB_SHA ?? null,
  url: url.href,
  scenarios: {},
};
let browser;
try {
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  const response = await gotoWithRetry(page);
  if (!response.ok()) throw new Error(`Hosted Ringcraft returned HTTP ${response.status()}.`);
  if ((await page.title()) !== "Project Ringcraft") throw new Error(`Unexpected hosted title: ${await page.title()}`);
  const rootText = await page.locator("#root").innerText();
  if (!rootText.includes("Ringcraft") || rootText.length < 100) throw new Error("Ringcraft UI did not render on the hosted origin.");
  evidence.scenarios.hostedShell = { status: "PASS", httpStatus: response.status(), title: await page.title() };

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  if (!manifestHref) throw new Error("Hosted page has no manifest link.");
  const manifestUrl = new URL(manifestHref, url).href;
  const manifestResponse = await page.request.get(manifestUrl);
  if (!manifestResponse.ok()) throw new Error(`Hosted manifest returned ${manifestResponse.status()}.`);
  const manifest = await manifestResponse.json();
  if (manifest.name !== "Project Ringcraft" || manifest.display !== "standalone") throw new Error("Hosted manifest identity/display mismatch.");
  for (const icon of manifest.icons ?? []) {
    const iconResponse = await page.request.get(new URL(icon.src, manifestUrl).href);
    if (!iconResponse.ok()) throw new Error(`Hosted icon ${icon.src} returned ${iconResponse.status()}.`);
  }
  evidence.scenarios.manifestAndIcons = { status: "PASS", manifestUrl, iconCount: manifest.icons?.length ?? 0 };

  await page.evaluate(() => localStorage.setItem("ringcraft-pwa-live-qa-marker", "hosted-save-survives"));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });
  await waitForController(page);
  const controllerScript = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || "");
  if (!controllerScript.includes("sw.js?build=")) throw new Error(`Hosted service worker is not build-keyed: ${controllerScript}`);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.enable");
  const appManifest = await cdp.send("Page.getAppManifest");
  const installabilityErrors = await cdp.send("Page.getInstallabilityErrors");
  if (installabilityErrors.installabilityErrors?.length) throw new Error(`Hosted Chromium installability errors: ${JSON.stringify(installabilityErrors.installabilityErrors)}`);
  evidence.scenarios.installability = { status: "PASS", manifestUrl: appManifest.url, controllerScript };

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  if ((await page.title()) !== "Project Ringcraft") throw new Error("Hosted PWA shell did not reopen offline.");
  if (await page.evaluate(() => localStorage.getItem("ringcraft-pwa-live-qa-marker")) !== "hosted-save-survives") throw new Error("Hosted LocalStorage marker was lost during offline relaunch.");
  evidence.scenarios.offlineAndStorage = { status: "PASS", localStoragePreserved: true };
  await context.setOffline(false);
  await page.reload({ waitUntil: "networkidle" });
  await waitForController(page);

  if (consoleErrors.length) throw new Error(`Hosted browser console errors: ${consoleErrors.join(" | ")}`);
  evidence.status = "PASS";
  await context.close();
} catch (error) {
  evidence.status = "FAIL";
  evidence.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  if (browser) await browser.close();
  await writeFile(path.join(outputDirectory, "pwa-live-smoke.json"), JSON.stringify(evidence, null, 2) + "\n");
}
