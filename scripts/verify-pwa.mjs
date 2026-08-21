import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const rootArg = process.argv.find((arg) => arg.startsWith("--root="));
const baseArg = process.argv.find((arg) => arg.startsWith("--base="));
const root = path.resolve(rootArg?.slice(7) || "dist");
const base = baseArg?.slice(7) || "/ringcraft/";
const normalizedBase = base.startsWith("/") ? (base.endsWith("/") ? base : `${base}/`) : `/${base.replace(/^\/+/, "").replace(/\/?$/, "/")}`;

const failures = [];
const pass = (label) => console.log(`PASS ${label}`);
const fail = (label, detail) => { failures.push(`${label}: ${detail}`); console.error(`FAIL ${label}: ${detail}`); };
const requireFile = (relative) => {
  const full = path.join(root, relative);
  if (!existsSync(full)) fail(relative, "missing from production artifact");
  else pass(`${relative} exists`);
  return full;
};

function pngSize(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") throw new Error("not a PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const indexPath = requireFile("index.html");
const manifestPath = requireFile("manifest.webmanifest");
const swPath = requireFile("sw.js");
const index = await readFile(indexPath, "utf8");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const sw = await readFile(swPath, "utf8");

if (index.includes(`href="${normalizedBase}manifest.webmanifest"`)) pass("PWA-02 manifest link uses Pages base");
else fail("PWA-02", `index.html does not reference ${normalizedBase}manifest.webmanifest`);

if (manifest.name === "Project Ringcraft" && manifest.short_name === "Ringcraft" && manifest.display === "standalone") pass("PWA-03 manifest identity");
else fail("PWA-03", "manifest identity/display fields differ");

const manifestUrl = new URL(`https://example.test${normalizedBase}manifest.webmanifest`);
const startUrl = new URL(manifest.start_url, manifestUrl);
const scopeUrl = new URL(manifest.scope, manifestUrl);
if (startUrl.pathname === normalizedBase && scopeUrl.pathname === normalizedBase) pass("PWA-04 start_url and scope");
else fail("PWA-04", `resolved start=${startUrl.pathname} scope=${scopeUrl.pathname}`);

const required = [
  ["icons/ringcraft-192.png", 192, false],
  ["icons/ringcraft-512.png", 512, false],
  ["icons/ringcraft-maskable-512.png", 512, true],
];
for (const [relative, size, maskable] of required) {
  const full = requireFile(relative);
  if (!existsSync(full)) continue;
  try {
    const dimensions = pngSize(await readFile(full));
    if (dimensions.width === size && dimensions.height === size) pass(`PWA-05 ${relative} ${size}x${size}`);
    else fail("PWA-05", `${relative} is ${dimensions.width}x${dimensions.height}`);
    const entry = manifest.icons.find((icon) => icon.src === relative);
    if (!entry) fail("PWA-06", `${relative} missing from manifest`);
    else if (maskable && !String(entry.purpose || "").split(/\s+/).includes("maskable")) fail("PWA-06", `${relative} is not maskable`);
    else pass(`PWA-06 ${relative} resolves from manifest`);
  } catch (error) {
    fail("PWA-05", `${relative}: ${error.message}`);
  }
}

if (sw.includes("ringcraft-shell-") && sw.includes("self.registration.scope") && sw.includes("self.skipWaiting()") && sw.includes("caches.delete")) pass("PWA-07 service-worker shell/update contract");
else fail("PWA-07", "service worker is missing expected scope/cache/update behavior");

const assetsDir = path.join(root, "assets");
const jsFiles = existsSync(assetsDir) ? (await readdir(assetsDir)).filter((name) => name.endsWith(".js")) : [];
let registrationBundle = "";
for (const file of jsFiles) registrationBundle += await readFile(path.join(assetsDir, file), "utf8");
if (registrationBundle.includes("sw.js?build=") && registrationBundle.includes("serviceWorker") && registrationBundle.includes(normalizedBase)) pass("PWA-08 production registration is build-keyed and base-aware");
else fail("PWA-08", "production JS does not expose expected service-worker registration contract");

if (!sw.includes("localStorage") && !sw.includes("indexedDB") && !sw.includes("campaignJson")) pass("PWA-13 service worker does not own save data");
else fail("PWA-13", "service worker appears to reference persistent Campaign storage");

const mainSource = await readFile(path.resolve("src/main.tsx"), "utf8");
if (mainSource.includes("import.meta.env.PROD") && mainSource.includes("registerProductionServiceWorker")) pass("PWA-15 local development is production-worker guarded");
else fail("PWA-15", "service-worker registration is not clearly guarded from dev mode");

if (failures.length) {
  console.error(`\nPWA static verification failed (${failures.length}).`);
  process.exit(1);
}
console.log("\nPWA static verification passed.");
