import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createBrotliDecompress } from "node:zlib";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import tarFs from "tar-fs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = path.join(ROOT, "dist");
const BASE_PATH = "/ringcraft/";
const PORT = 4176;
const BASE_URL = `http://127.0.0.1:${PORT}${BASE_PATH}`;
const outputDirectory = path.join(ROOT, "output", "readiness");
const runtimeDirectory = path.join(outputDirectory, "pwa-browser-runtime");
await mkdir(outputDirectory, { recursive: true });
await mkdir(runtimeDirectory, { recursive: true });
process.env.TMPDIR = runtimeDirectory;
process.env.LD_LIBRARY_PATH = [path.join(runtimeDirectory, "al2023", "lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");

const types = new Map([[".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"], [".webmanifest", "application/manifest+json; charset=utf-8"], [".png", "image/png"], [".svg", "image/svg+xml"], [".woff2", "font/woff2"]]);
function contentType(file) { return types.get(path.extname(file)) || "application/octet-stream"; }
function safeFileFor(requestUrl) {
  const url = new URL(requestUrl, BASE_URL);
  if (!url.pathname.startsWith(BASE_PATH)) return null;
  const relative = decodeURIComponent(url.pathname.slice(BASE_PATH.length));
  const requested = relative && !relative.endsWith("/") ? relative : "index.html";
  const full = path.resolve(DIST, requested);
  if (!full.startsWith(path.resolve(DIST) + path.sep) && full !== path.resolve(DIST, "index.html")) return null;
  return full;
}

const server = createServer(async (req, res) => {
  try {
    let full = safeFileFor(req.url || BASE_PATH);
    if (!full) { res.writeHead(404).end("Not found"); return; }
    try {
      if ((await stat(full)).isDirectory()) full = path.join(full, "index.html");
      const body = await readFile(full);
      res.writeHead(200, { "content-type": contentType(full), "cache-control": "no-store", "service-worker-allowed": BASE_PATH });
      res.end(body);
    } catch {
      const body = await readFile(path.join(DIST, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(body);
    }
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

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
  for (const candidate of ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) { try { await access(candidate); return candidate; } catch { /* next */ } }
  return null;
}
async function launchBrowser() {
  const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];
  try { return await chromium.launch({ headless: true, executablePath: await portableChromiumPath(), args }); }
  catch (error) { const fallback = await systemBrowserPath(); if (!fallback) throw error; return chromium.launch({ headless: true, executablePath: fallback, args }); }
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

const evidence = { schema: "ringcraft-pwa-installability-v1", basePath: BASE_PATH, scenarios: {} };
let browser;
try {
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  if (manifestHref !== `${BASE_PATH}manifest.webmanifest`) throw new Error(`Unexpected manifest href: ${manifestHref}`);
  const manifest = await page.evaluate(async () => fetch(document.querySelector('link[rel="manifest"]').href).then((response) => response.json()));
  if (manifest.name !== "Project Ringcraft" || manifest.display !== "standalone") throw new Error("Manifest identity/display mismatch.");

  await page.evaluate(() => localStorage.setItem("ringcraft-pwa-qa-marker", "career-save-survives"));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });
  await waitForController(page);
  const controllerScript = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || "");
  if (!controllerScript.includes("sw.js?build=")) throw new Error(`Build-keyed service worker is not controlling the page: ${controllerScript}`);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.enable");
  const appManifest = await cdp.send("Page.getAppManifest");
  const installabilityErrors = await cdp.send("Page.getInstallabilityErrors");
  if (!appManifest.url?.endsWith(`${BASE_PATH}manifest.webmanifest`)) throw new Error(`Chromium manifest URL mismatch: ${appManifest.url}`);
  if (installabilityErrors.installabilityErrors?.length) throw new Error(`Chromium installability errors: ${JSON.stringify(installabilityErrors.installabilityErrors)}`);
  evidence.scenarios.installability = { status: "PASS", manifestUrl: appManifest.url, controllerScript };

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  if ((await page.title()) !== "Project Ringcraft") throw new Error(`Offline shell title mismatch: ${await page.title()}`);
  const markerOffline = await page.evaluate(() => localStorage.getItem("ringcraft-pwa-qa-marker"));
  if (markerOffline !== "career-save-survives") throw new Error("LocalStorage marker was lost during offline relaunch.");
  evidence.scenarios.offline = { status: "PASS", localStoragePreserved: true };

  await context.setOffline(false);
  await page.reload({ waitUntil: "networkidle" });
  await waitForController(page);
  const updateResult = await page.evaluate(async (basePath) => {
    const previousCaches = (await caches.keys()).filter((name) => name.startsWith("ringcraft-shell-"));
    const expected = `${location.origin}${basePath}sw.js?build=pwa-update-regression`;
    const controllerChanged = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 15000);
      navigator.serviceWorker.addEventListener("controllerchange", () => { clearTimeout(timer); resolve(true); }, { once: true });
    });
    const registration = await navigator.serviceWorker.register(`${basePath}sw.js?build=pwa-update-regression`, { scope: basePath });
    const worker = registration.installing || registration.waiting || registration.active;
    if (worker && worker.state !== "activated") await new Promise((resolve) => worker.addEventListener("statechange", () => { if (worker.state === "activated") resolve(); }));
    if (navigator.serviceWorker.controller?.scriptURL !== expected) await controllerChanged;
    const currentCaches = (await caches.keys()).filter((name) => name.startsWith("ringcraft-shell-"));
    return { previousCaches, currentCaches, controller: navigator.serviceWorker.controller?.scriptURL || "", marker: localStorage.getItem("ringcraft-pwa-qa-marker") };
  }, BASE_PATH);
  if (!updateResult.controller.includes("build=pwa-update-regression")) throw new Error(`Updated worker did not control client: ${updateResult.controller}`);
  if (updateResult.marker !== "career-save-survives") throw new Error("LocalStorage marker was lost during service-worker update.");
  if (updateResult.currentCaches.length !== 1 || !updateResult.currentCaches[0].endsWith("pwa-update-regression")) throw new Error(`Stale Ringcraft shell caches remain after update: ${JSON.stringify(updateResult.currentCaches)}`);
  evidence.scenarios.update = { status: "PASS", ...updateResult };

  if (consoleErrors.length) throw new Error(`Browser console errors: ${consoleErrors.join(" | ")}`);
  evidence.status = "PASS";
  await context.close();
} catch (error) {
  evidence.status = "FAIL";
  evidence.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(path.join(outputDirectory, "pwa-installability.json"), JSON.stringify(evidence, null, 2) + "\n");
}
