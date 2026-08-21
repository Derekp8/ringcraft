import { createReadStream, createWriteStream, readFileSync } from "node:fs";
import { access, chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createMockSaveSyncServer } from "./mock-save-sync-server.mjs";
import { fileURLToPath } from "node:url";
import { createBrotliDecompress } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { chromium } from "playwright-core";
import tarFs from "tar-fs";
import { createServer } from "vite";

const baseUrl = "http://127.0.0.1:4173";
/** Pinned replay hash for the seeded (1991) ruthless exhibition match — see the m10-difficulty-exhibition profile. */
const RUTHLESS_SEED_1991_REPLAY_HASH = "c14n-fnv1a64-v1:03e0fea1cb9c5be1";
/** Pinned replay hash for the seeded (1991) tag-team exhibition match — see the tag-desktop profile. */
const TAG_SEED_1991_REPLAY_HASH = "c14n-fnv1a64-v1:1b26c32a342f08c8";
/** Pinned replay hash for the seeded world-tag defense match in the tag-feud-career profile (career-team-2 vs champion career-team-1, time-limit draw) — see the tag-feud-career profile. */
const WORLD_TAG_DEFENSE_REPLAY_HASH = "c14n-fnv1a64-v1:0707c852c4025914";
/** Fixed mock save-sync port so the rendered Endpoint field is deterministic (an ephemeral port would show in every dashboard capture). */
const MOCK_SYNC_PORT = 4183;
const outputDirectory = new URL("../output/qa/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });
/** Consecutive-run pixel-diff guard: captures must stay byte-identical across runs except within the known timestamp rows. */
const baselineDirectory = new URL("../output/qa/baseline/", import.meta.url);
await mkdir(baselineDirectory, { recursive: true });
/** Per-capture y-bands (full-page coordinates) where the timestamp rows render; only these rows may differ between runs. */
const timestampRowBands = new Map();
const cacheDirectory = new URL("../output/qa/browser-cache/", import.meta.url);
await mkdir(cacheDirectory, { recursive: true });
process.env.XDG_CACHE_HOME = fileURLToPath(cacheDirectory);
const runtimeTempDirectory = new URL("../output/qa/browser-runtime/", import.meta.url);
await mkdir(runtimeTempDirectory, { recursive: true });
process.env.TMPDIR = fileURLToPath(runtimeTempDirectory);
process.env.LD_LIBRARY_PATH = [fileURLToPath(new URL("al2023/lib/", runtimeTempDirectory)), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");

async function portableChromiumPath() {
  const executable = fileURLToPath(new URL("chromium", runtimeTempDirectory));
  const packageBin = new URL("../node_modules/@sparticuz/chromium/bin/", import.meta.url);
  await pipeline(createReadStream(fileURLToPath(new URL("chromium.br", packageBin))), createBrotliDecompress(), createWriteStream(executable, { mode: 0o700 }));
  await chmod(executable, 0o700);
  for (const [archive, destination] of [["fonts.tar.br", new URL("fonts/", runtimeTempDirectory)], ["swiftshader.tar.br", runtimeTempDirectory], ["al2023.tar.br", new URL("al2023/", runtimeTempDirectory)]]) {
    await mkdir(destination, { recursive: true });
    await pipeline(
      createReadStream(fileURLToPath(new URL(archive, packageBin))),
      createBrotliDecompress(),
      tarFs.extract(fileURLToPath(destination), { chown: false }),
    );
  }
  return executable;
}

const server = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), server: { host: "127.0.0.1", port: 4173, strictPort: true } });
await server.listen();

async function systemBrowserPath() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* try next candidate */ }
  }
  return null;
}

const launchArgs = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];
const executablePath = await portableChromiumPath();
let browser;
try {
  browser = await chromium.launch({ args: launchArgs, executablePath, headless: true });
} catch (error) {
  const systemPath = await systemBrowserPath();
  if (!systemPath) throw error;
  console.warn(`Portable chromium unavailable (${error.message}); falling back to ${systemPath}.`);
  browser = await chromium.launch({ args: launchArgs, executablePath: systemPath, headless: true });
}
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, timezoneId: "UTC", locale: "en-US" });
// Freeze the page clock at a fixed instant (persists across reloads and gotos)
// so wall-clock-derived UI — autosave snapshot timestamps, save-bundle export
// filenames — renders deterministically. Combined with the en-US/UTC context
// above, the career/save-manager screenshot bytes become pinnable across runs
// instead of drifting with the host wall clock.
await page.clock.setFixedTime(new Date("1991-01-01T12:00:00.000Z"));
// Freeze identity generation too: named saves get their IDs from
// `crypto.randomUUID()`, and those IDs are embedded in the save-bundle keys,
// so the bundle fingerprint — which the last-synced baseline line renders —
// was drifting between runs. Patching `Crypto.prototype.randomUUID` to a
// deterministic counter makes the exported bundle bytes (and the fingerprint)
// pinnable across runs; no other crypto surface is touched.
await page.addInitScript(() => {
  // The counter is persisted across navigations: a fresh closure per navigation
  // would restart at 0 after a reload and re-mint an ID already in use, which
  // both collides with an existing save key and lets a later delete remove the
  // wrong save. Monotonicity across the whole run keeps every ID distinct.
  const counterKey = "asw91-qa-identity-counter";
  let nextId = Number(localStorage.getItem(counterKey) ?? "0");
  if (!Number.isFinite(nextId) || nextId < 0) nextId = 0;
  Crypto.prototype.randomUUID = function () {
    const id = `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
    nextId += 1;
    localStorage.setItem(counterKey, String(nextId));
    return id;
  };
});
let currentProfile = "startup";
let suppressResourceLoadErrors = false;
page.on("console", (message) => { if (message.type() === "error" && !(suppressResourceLoadErrors && message.text().startsWith("Failed to load resource"))) errors.push(`${currentProfile}: ${message.text()}`); });
page.on("pageerror", (error) => errors.push(`${currentProfile}: ${error.message}`));

async function assertPage(profile) {
  const visibleActions = await page.locator("button.action:visible").count();
  if (visibleActions < 1) errors.push(`${profile}: no playable action buttons were visible`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) errors.push(`${profile}: horizontal page overflow detected`);
  const verified = await page.locator(".verified").count();
  if (!verified) errors.push(`${profile}: replay verification indicator missing`);
}

async function assertSurface(profile, selector) {
  if (!(await page.locator(selector).count())) errors.push(`${profile}: ${selector} was not visible`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) errors.push(`${profile}: horizontal page overflow detected`);
}

async function assertAccessibleNameCoverage(profile, target = page) {
  const missing = await target.locator("button:visible, a[href]:visible, input:visible, select:visible, textarea:visible").evaluateAll((elements) => elements
    .filter((element) => {
      const labelledBy = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      const label = element.closest("label")?.textContent ?? "";
      return !(element.getAttribute("aria-label") || labelledBy || label || element.textContent)?.trim();
    })
    .map((element) => element.outerHTML.slice(0, 100)));
  if (missing.length) errors.push(`${profile}: ${missing.length} visible controls lack accessible names: ${missing.join(" | ")}`);
}

async function assertLandmarkAndHeadingStructure(profile, target = page) {
  if (await target.locator("main").count() !== 1) errors.push(`${profile}: expected exactly one main landmark`);
  const unlabeled = await target.locator("nav:visible, aside:visible, [role=region]:visible, [role=dialog]:visible").evaluateAll((elements) => elements
    .filter((element) => !(element.getAttribute("aria-label") || element.getAttribute("aria-labelledby"))));
  if (unlabeled.length) errors.push(`${profile}: ${unlabeled.length} landmarks lack accessible labels`);
  const emptyHeading = await target.locator("h1:visible, h2:visible, h3:visible, h4:visible").evaluateAll((elements) => elements.filter((element) => !element.textContent?.trim()).length);
  if (emptyHeading) errors.push(`${profile}: ${emptyHeading} visible headings are empty`);
}

async function assertKeyboardTraversal(profile, selector, target = page) {
  const surface = target.locator(selector);
  const controls = surface.locator("button:visible:not([disabled]), a[href]:visible, input:visible:not([disabled]), select:visible:not([disabled]), textarea:visible:not([disabled]), summary:visible");
  const count = await controls.count();
  if (!count) return;
  await controls.first().focus();
  let previousIndex = await controls.evaluateAll((elements) => elements.indexOf(document.activeElement));
  for (let index = 1; index < count; index += 1) {
    await target.keyboard.press("Tab");
    const state = await controls.evaluateAll((elements) => ({
      activeIndex: elements.indexOf(document.activeElement),
      focused: document.activeElement !== document.body,
      visibleFocus: document.activeElement instanceof HTMLElement && document.activeElement.matches(":focus-visible"),
    }));
    if (state.activeIndex <= previousIndex || !state.focused || !state.visibleFocus) errors.push(`${profile}: keyboard focus failed to advance visibly within ${selector} at control ${index}`);
    previousIndex = state.activeIndex;
  }
}

async function assertDialogAccessibility(profile, selector, target = page) {
  const dialog = target.locator(selector);
  const dialogCount = await dialog.count();
  if (dialogCount !== 1) {
    errors.push(`${profile}: expected exactly one dialog, found ${dialogCount}`);
    return;
  }
  if ((await dialog.getAttribute("role")) !== "dialog") errors.push(`${profile}: dialog role missing`);
  if ((await dialog.getAttribute("aria-modal")) !== "true") errors.push(`${profile}: aria-modal=true missing`);
  if (!(await dialog.getAttribute("aria-labelledby"))) errors.push(`${profile}: dialog title labeling missing`);
  if (!(await dialog.evaluate((element) => element.contains(document.activeElement)))) errors.push(`${profile}: initial focus did not enter dialog`);
  const buttons = dialog.locator("button:visible");
  if (!(await buttons.count())) {
    errors.push(`${profile}: dialog has no focusable buttons`);
    return;
  }
  await buttons.last().focus();
  await target.keyboard.press("Tab");
  if (!(await buttons.first().evaluate((element) => document.activeElement === element))) errors.push(`${profile}: Tab did not wrap dialog focus`);
}

async function assertLiveRegion(profile, selector = "[aria-live]:visible", target = page) {
  const regions = target.locator(selector);
  if (!(await regions.count())) errors.push(`${profile}: expected live region was missing`);
  const missingAttribute = await regions.evaluateAll((elements) => elements.filter((element) => !element.getAttribute("aria-live")).length);
  if (missingAttribute) errors.push(`${profile}: ${missingAttribute} live-region targets lack aria-live`);
}

async function assertNoColorOnlyStatus(profile, target = page) {
  const empty = await target.locator(".status:visible, .status-pill:visible, .verified:visible, .invalid:visible").evaluateAll((elements) => elements.filter((element) => !element.textContent?.trim()).length);
  if (empty) errors.push(`${profile}: ${empty} status elements rely on color without visible text`);
  const unlabeledPips = await target.locator(".pip:visible").evaluateAll((elements) => elements.filter((element) => !element.getAttribute("aria-label") && !element.textContent?.trim()).length);
  if (unlabeledPips) errors.push(`${profile}: ${unlabeledPips} phase indicators lack text or accessible labels`);
}

/**
 * Fails on any element whose text is hard-clipped: the element clips its own
 * overflow (overflow: hidden/clip, text-overflow: ellipsis with nowrap, or a
 * fixed-height hidden box) and the content actually exceeds the box, or the
 * visible text runs past the QA viewport's right edge (the capture is fullPage
 * at the fixed viewport width, so a wider element is cut in the review bytes),
 * so the full text is unrecoverable without a DOM change. Scrollable
 * containers (overflow: auto/scroll) are excluded — their content is
 * reachable — as are sr-only/a11y-hidden nodes (1px clip boxes), form
 * controls, hidden subtrees, and fully off-screen elements. Runs at every
 * capture, so a truncation regression like the compact-log hash ellipsis
 * fails the gate instead of surviving to manual review. Reports the clipping
 * element, axis, extent, and a text snippet.
 */
async function assertNoHardClippedText(profile, target = page) {
  const clipped = await target.evaluate(() => {
    const results = [];
    const describe = (element) => {
      const parts = [element.tagName.toLowerCase()];
      const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter(Boolean) : [];
      if (classes.length) parts.push(`.${classes.join(".")}`);
      if (element.id) parts.push(`#${element.id}`);
      return parts.join("");
    };
    const nowrapChain = (from, upTo) => {
      let node = from;
      while (node && node !== upTo) {
        if (/nowrap|pre/.test(getComputedStyle(node).whiteSpace)) return true;
        node = node.parentElement;
      }
      return false;
    };
    // True when some ancestor up to (and including) <html> can scroll the
    // element horizontally: then its overflow is reachable, not a hard clip.
    const hasScrollableXAncestor = (element) => {
      let node = element.parentElement;
      while (node) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
        node = node.parentElement;
      }
      return false;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      const element = node;
      const hasDirectText = [...element.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
      if (!hasDirectText) continue;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const tag = element.tagName;
      if (["INPUT", "SELECT", "TEXTAREA", "OPTION", "SCRIPT", "STYLE"].includes(tag)) continue;
      if (element.closest("[hidden]")) continue;
      const rect = element.getBoundingClientRect();
      // sr-only / a11y-hidden pattern: a 1px box plus a clip; skip.
      if (rect.width <= 2 && rect.height <= 2 && (style.clipPath !== "none" || style.clip !== "auto")) continue;
      const text = [...element.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join(" ").replace(/\s+/g, " ").trim();
      if (text.length < 2) continue;
      const clientWidth = element.clientWidth;
      const scrollWidth = element.scrollWidth;
      const clientHeight = element.clientHeight;
      const scrollHeight = element.scrollHeight;
      const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
      const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
      let hit = null;
      if (clipsX && clientWidth > 0 && scrollWidth > clientWidth + 1) {
        hit = { axis: "x", label: describe(element), scroll: scrollWidth, client: clientWidth, whiteSpace: style.whiteSpace, text: text.slice(0, 60) };
      } else if (clipsY && clientHeight > 0 && scrollHeight > clientHeight + 1) {
        hit = { axis: "y", label: describe(element), scroll: scrollHeight, client: clientHeight, whiteSpace: style.whiteSpace, text: text.slice(0, 60) };
      } else if (clientWidth === 0) {
        // Inline text: the nearest non-scrollable clipping ancestor decides.
        const range = document.createRange();
        range.selectNodeContents(element);
        const textRect = range.getBoundingClientRect();
        let ancestor = element.parentElement;
        let clippedBy = null;
        while (ancestor && ancestor !== document.body) {
          const ancestorStyle = getComputedStyle(ancestor);
          const overflowX = ancestorStyle.overflowX;
          if (overflowX === "auto" || overflowX === "scroll") { clippedBy = null; break; }
          if (overflowX === "hidden" || overflowX === "clip" || ancestorStyle.textOverflow === "ellipsis") { clippedBy = ancestor; break; }
          ancestor = ancestor.parentElement;
        }
        if (clippedBy) {
          const ancestorRect = clippedBy.getBoundingClientRect();
          const ancestorStyle = getComputedStyle(clippedBy);
          const contentRight = ancestorRect.right - (parseFloat(ancestorStyle.paddingRight) || 0);
          if (nowrapChain(element, clippedBy.parentElement) && textRect.right > contentRight + 1) {
            hit = { axis: "x", label: describe(clippedBy), scroll: Math.round(textRect.right - contentRight), client: Math.round(ancestorRect.width), whiteSpace: "inline", text: text.slice(0, 60) };
          }
        }
      }
      // Viewport-boundary clip: the capture is fullPage at the fixed QA viewport
      // width (1440px), so any visible text that starts on-screen and runs past
      // the right edge is cut off in the review bytes — unrecoverable without a
      // DOM change, exactly like an overflow:hidden truncation — unless a
      // scrollable ancestor makes it reachable. (Vertical overflow is safe:
      // fullPage captures the full height.) Fully off-screen elements are left
      // alone — they are not visible text at the viewport.
      if (!hit && rect.left < window.innerWidth && rect.right > window.innerWidth + 1 && !hasScrollableXAncestor(element)) {
        hit = { axis: "viewport-x", label: describe(element), scroll: Math.round(rect.right), client: window.innerWidth, whiteSpace: style.whiteSpace, text: text.slice(0, 60) };
      }
      if (hit) results.push(hit);
    }
    return results;
  });
  if (clipped.length) {
    errors.push(`${profile}: ${clipped.length} hard-clipped text element(s): ${clipped.map((item) => `${item.label} (${item.axis}-axis, ${item.scroll}px content in ${item.client}px box, white-space:${item.whiteSpace}, text \"${item.text}\")`).join("; ")}`);
  }
}

/**
 * Asserts a difficulty select's hint-panel accessibility: the select carries
 * aria-describedby wiring to a visible difficulty-hint panel, the select
 * itself is keyboard-focusable (the keyboard/SR entry point that announces the
 * hint on focus), and the hint panel participates in keyboard/reading order —
 * it sits between the select and the next focusable control, and Tab advances
 * focus past the select to that control (no focus trap).
 */
async function assertDifficultyHintWiring(profile, selectLabel) {
  const select = page.getByLabel(selectLabel, { exact: true });
  if (!(await select.count())) {
    errors.push(`${profile}: difficulty select ${selectLabel} missing`);
    return;
  }
  const describedBy = await select.getAttribute("aria-describedby");
  if (!describedBy) errors.push(`${profile}: difficulty select ${selectLabel} lacks aria-describedby wiring`);
  else {
    const target = await select.evaluate((element, id) => {
      const node = document.getElementById(id);
      if (!node) return { found: false };
      const style = getComputedStyle(node);
      return {
        found: true,
        isHint: node.classList.contains("difficulty-hint"),
        visible: style.display !== "none" && style.visibility !== "hidden",
        rows: node.querySelectorAll(".difficulty-hint__row").length,
      };
    }, describedBy);
    if (!target.found) errors.push(`${profile}: difficulty select ${selectLabel} aria-describedby references missing element #${describedBy}`);
    else {
      if (!target.isHint) errors.push(`${profile}: difficulty select ${selectLabel} aria-describedby target is not the difficulty hint panel`);
      if (!target.visible) errors.push(`${profile}: difficulty hint panel #${describedBy} is not visible`);
      if (!target.rows) errors.push(`${profile}: difficulty hint panel #${describedBy} has no level rows`);
    }
  }
  await select.focus();
  const focused = await select.evaluate((element) => document.activeElement === element);
  if (!focused) errors.push(`${profile}: difficulty select ${selectLabel} is not keyboard-focusable`);

  // Focus-traversal contract for the hint panel: it must be reachable in
  // reading order between the select and the next focusable control, and Tab
  // from the select must advance focus to that control instead of trapping it.
  const traversal = await select.evaluate((element, id) => {
    const hint = id ? document.getElementById(id) : null;
    if (!hint) return { ok: false, reason: "hint panel missing for focus traversal" };
    const isVisible = (node) => {
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
    };
    const focusable = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary";
    const after = [...document.querySelectorAll(focusable)].filter((control) =>
      isVisible(control) && control !== element && (control.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING) !== 0,
    );
    if (!after.length) return { ok: true, hintBetween: true, nextLabel: null };
    const next = after[0];
    return {
      ok: true,
      hintBetween: (hint.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
        && (hint.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      nextLabel: next.getAttribute("aria-label") || (next.textContent ?? "").trim().slice(0, 40) || next.tagName,
    };
  }, describedBy);
  if (!traversal.ok) errors.push(`${profile}: difficulty select ${selectLabel} ${traversal.reason}`);
  else if (!traversal.hintBetween) errors.push(`${profile}: difficulty hint panel #${describedBy} is not reachable in reading order between the select and the next control (${traversal.nextLabel ?? "none"})`);
  await page.keyboard.press("Tab");
  const advanced = await select.evaluate((element) => {
    const active = document.activeElement;
    return {
      moved: active !== null && active !== element && active !== document.body,
      visibleFocus: active instanceof HTMLElement && active.matches(":focus-visible"),
    };
  });
  if (!advanced.moved) errors.push(`${profile}: Tab from difficulty select ${selectLabel} did not advance focus past the hint panel (focus trap)`);
  if (!advanced.visibleFocus) errors.push(`${profile}: focus after difficulty select ${selectLabel} is not visible (:focus-visible)`);
  await select.focus(); // restore the pre-check focus state so captures stay byte-stable
}

/**
 * Keyboard-only operability of the import-bundle preview's confirm gate: both
 * preview buttons must be reachable by Tab alone from the import control with
 * visible focus (:focus-visible), Enter on Cancel must dismiss the preview
 * without applying anything, and Enter on "Apply import" must apply the
 * bundle. Mirrors the M8 dialog keyboard contract for the save-manager's
 * confirm-gate panel (which is a labelled group, not a modal dialog).
 */
async function assertImportPreviewKeyboardOperable(profile, { bundleFile, applyRowName }) {
  const preview = page.locator(".overwrite-preview[aria-label='Import bundle preview']");
  if (!(await preview.count())) {
    errors.push(`${profile}: import bundle preview did not render`);
    return;
  }
  if ((await preview.getAttribute("role")) !== "group") errors.push(`${profile}: import bundle preview lacks group role`);
  const applyButton = preview.getByRole("button", { name: "Apply import" });
  const cancelButton = preview.getByRole("button", { name: "Cancel" });
  if (!(await applyButton.count())) errors.push(`${profile}: Apply import button missing from the import preview`);
  if (!(await cancelButton.count())) errors.push(`${profile}: Cancel button missing from the import preview`);

  const importInput = page.locator("input[aria-label='Import save bundle']");
  const tabUntilFocused = async (button) => {
    await importInput.focus();
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press("Tab");
      if (await button.evaluate((element) => document.activeElement === element)) {
        const visible = await button.evaluate((element) => element.matches(":focus-visible"));
        return { reached: true, visible };
      }
    }
    return { reached: false, visible: false };
  };

  // Cancel: keyboard-reachable, and Enter dismisses the preview without applying.
  const cancelWalk = await tabUntilFocused(cancelButton);
  if (!cancelWalk.reached) errors.push(`${profile}: Cancel was not keyboard-reachable by Tab alone`);
  else {
    if (!cancelWalk.visible) errors.push(`${profile}: Cancel does not carry visible focus (:focus-visible)`);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.querySelector(".overwrite-preview[aria-label='Import bundle preview']")).catch(() => errors.push(`${profile}: Enter on Cancel did not dismiss the import preview`));
  }

  // Re-open the preview (Cancel applied nothing), then Apply import: keyboard-reachable,
  // and Enter applies the bundle.
  await page.locator("input[aria-label='Import save bundle']").setInputFiles({
    name: bundleFile.suggestedFilename(),
    mimeType: "application/json",
    buffer: readFileSync(await bundleFile.path()),
  });
  await page.waitForFunction(() => document.body.textContent?.includes("Import bundle preview"));
  const applyWalk = await tabUntilFocused(applyButton);
  if (!applyWalk.reached) errors.push(`${profile}: Apply import was not keyboard-reachable by Tab alone`);
  else {
    if (!applyWalk.visible) errors.push(`${profile}: Apply import does not carry visible focus (:focus-visible)`);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.body.textContent?.includes("Imported 1 named save")).catch(() => errors.push(`${profile}: Enter on Apply import did not apply the import`));
    if (!(await saveRow(applyRowName).count())) errors.push(`${profile}: imported save did not render after keyboard activation of Apply import`);
  }
}

async function dismissTour() {
  const overlay = page.locator(".tour-overlay");
  if (await overlay.count()) {
    await page.getByRole("button", { name: /Skip/ }).click();
    await page.waitForFunction(() => !document.querySelector(".tour-overlay"));
  }
}

/** Selects a save-manager row whose exact displayed name matches, so "X" and "X (copy)" stay distinct. */
function saveRow(name) {
  return page.locator(".save-row").filter({ has: page.getByText(name, { exact: true }) });
}

async function gotoApp() {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await dismissTour();
}

/**
 * Opens a nav surface: clicks the named nav button, then waits for the
 * requested surface variant to render instead of racing its first paint.
 * Pass `predicate` (a self-contained document predicate, as given to
 * waitForFunction) or `selector` (a CSS selector; defaults to the named
 * surface's root) identifying the variant under test. On timeout a clean QA
 * error is recorded and false is returned so the caller can skip
 * surface-specific assertions; pass `debug: true` to dump the page state and
 * a screenshot for diagnosis (used by the m10-difficulty-career setup-select
 * wait).
 */
async function openSurface({ nav, predicate, selector, timeout = 20_000, debug = false, label = "surface" } = {}) {
  await page.getByRole("button", { name: nav }).click();
  const ready = await (predicate
    ? page.waitForFunction(predicate, undefined, { timeout })
    : page.waitForFunction((query) => document.querySelector(query) !== null, selector, { timeout })
  ).then(() => true).catch(async () => {
    if (debug) {
      console.log(`${currentProfile} ${nav} DEBUG body:`, (await page.locator("body").innerText()).slice(0, 500).replace(/\s+/g, " "));
      console.log(`${currentProfile} ${nav} DEBUG selects:`, await page.locator("select").evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label") ?? element.getAttribute("id") ?? "?")));
      console.log(`${currentProfile} ${nav} DEBUG buttons:`, await page.getByRole("button").allTextContents());
      await capture(page, `${currentProfile}-debug.png`);
    }
    return false;
  });
  if (!ready) errors.push(`${currentProfile}: ${nav} ${label} never rendered after clicking ${nav}`);
  return ready;
}

/**
 * Opens the Career surface: clicks the Career nav button, then waits for the
 * requested surface variant to render instead of racing its first paint.
 * See openSurface for the wait contract.
 */
async function openCareer({ predicate, selector = ".career-surface", timeout = 20_000, debug = false, label = "surface" } = {}) {
  return openSurface({ nav: "Career", predicate, selector, timeout, debug, label });
}

/** Opens a collapsed Career option group by its accessible summary text. */
async function ensureCareerOptionsOpen(summaryText) {
  const summary = page.getByText(summaryText, { exact: true });
  if (!(await summary.count())) throw new Error(`Career option group is missing: ${summaryText}`);
  const open = await summary.evaluate((element) => element.parentElement?.hasAttribute("open") ?? false);
  if (!open) await summary.click();
}

/** Starts the generated QA league through the current manual-seed surface. */
async function startDeterministicQaCareer() {
  await ensureCareerOptionsOpen("Developer / deterministic options");
  await page.getByRole("button", { name: "Start generated league with manual seed" }).click();
}

/**
 * Freeze native caret rendering so captures never depend on the browser's
 * caret-blink phase. A focused text input's caret blinks on an internal timer
 * that Playwright's stability heuristics do not wait for, so a screenshot can
 * catch it in either phase; making the caret fully transparent pins that
 * variable out of the rendered bytes. Focus, selection, and `:focus` styles
 * are untouched, so only the blinking caret glyph itself is removed.
 */
async function freezeCaret(pageHandle) {
  await pageHandle.addStyleTag({ content: "input, textarea, [contenteditable] { caret-color: transparent !important; }" });
}

/** Screenshot with the caret frozen so the capture bytes are blink-independent. */
async function capture(pageHandle, fileName) {
  await freezeCaret(pageHandle);
  // Every capture is also a truncation check point: a hard-clipped text element
  // (e.g. a hash pair cut by overflow: hidden + nowrap) fails the gate here.
  await assertNoHardClippedText(fileName.replace(/^ringcraft-/, "").replace(/\.png$/, ""), pageHandle);
  await pageHandle.screenshot({ path: fileURLToPath(new URL(fileName, outputDirectory)), fullPage: true });
}

/** Records the full-page y-bands where timestamp-bearing rows currently render, as the only rows allowed to differ between runs. */
async function recordTimestampRows(fileName) {
  const bands = await page.evaluate(() => {
    const rows = [];
    for (const selector of [".save-row", ".autosave-row"]) {
      for (const element of document.querySelectorAll(selector)) {
        const rect = element.getBoundingClientRect();
        rows.push([Math.round(rect.top + window.scrollY), Math.round(rect.bottom + window.scrollY)]);
      }
    }
    return rows;
  });
  timestampRowBands.set(fileName, bands);
}

/**
 * Returns the row bands where two PNGs differ, decoded in-browser (no PNG
 * decoder dependency). A per-channel tolerance of 2/255 is applied so pure
 * sub-pixel antialiasing jitter (a border edge blending 1 unit differently
 * between runs, as observed on the gold `.equation` rows) does not fail the
 * gate; any real content change shifts pixels by far more than 2 units and is
 * still reported.
 */
async function pixelDiffRowBands(aPath, bPath) {
  const a = (await readFile(aPath)).toString("base64");
  const b = (await readFile(bPath)).toString("base64");
  const diffPage = await browser.newPage();
  try {
    return await diffPage.evaluate(async ({ a, b }) => {
      const load = (src) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
      });
      const [imageA, imageB] = await Promise.all([load(a), load(b)]);
      const width = Math.max(imageA.width, imageB.width);
      const height = Math.max(imageA.height, imageB.height);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.drawImage(imageA, 0, 0);
      const dataA = context.getImageData(0, 0, width, height).data;
      context.clearRect(0, 0, width, height);
      context.drawImage(imageB, 0, 0);
      const dataB = context.getImageData(0, 0, width, height).data;
      const channelsDiffer = (index) => {
        for (let channel = 0; channel < 4; channel += 1) {
          if (Math.abs(dataA[index + channel] - dataB[index + channel]) > 2) return true;
        }
        return false;
      };
      const bands = [];
      let start = -1;
      for (let y = 0; y < height; y += 1) {
        let rowDiff = false;
        for (let x = 0; x < width; x += 1) {
          if (channelsDiffer((y * width + x) * 4)) {
            rowDiff = true;
            break;
          }
        }
        if (rowDiff && start < 0) start = y;
        if (!rowDiff && start >= 0) {
          bands.push([start, y - 1]);
          start = -1;
        }
      }
      if (start >= 0) bands.push([start, height - 1]);
      return { width, height, bands };
    }, { a: `data:image/png;base64,${a}`, b: `data:image/png;base64,${b}` });
  } finally {
    await diffPage.close();
  }
}

/**
 * Consecutive-run pixel-diff guard: every ringcraft-*.png capture must match the
 * previous run's baseline bytes, or differ only within the rows where timestamps
 * render (recorded per capture via recordTimestampRows). Anything else fails.
 * The baseline always advances to this run's captures afterwards, so the guard
 * is defined between consecutive runs: a one-off capture flake fails exactly the
 * run that observed it and the next run self-heals, while a persistent drift
 * keeps failing every run until fixed.
 */
async function assertConsecutiveRunStability() {
  const files = (await readdir(outputDirectory)).filter((name) => name.startsWith("ringcraft-") && name.endsWith(".png")).sort();
  const stabilityErrors = [];
  let established = 0;
  let advanced = 0;
  for (const name of files) {
    const current = await readFile(fileURLToPath(new URL(name, outputDirectory)));
    const baselinePath = fileURLToPath(new URL(name, baselineDirectory));
    let baseline = null;
    try {
      baseline = await readFile(baselinePath);
    } catch { /* first run: no baseline yet */ }
    if (baseline === null) {
      await writeFile(baselinePath, current);
      established += 1;
      continue;
    }
    if (baseline.equals(current)) continue;
    const { bands } = await pixelDiffRowBands(baselinePath, fileURLToPath(new URL(name, outputDirectory)));
    const allowed = timestampRowBands.get(name) ?? [];
    const outside = bands.filter(([y0, y1]) => !allowed.some(([a0, a1]) => y0 >= a0 && y1 <= a1));
    if (outside.length) stabilityErrors.push(`pixel-stability: ${name} changed in ${outside.length} row band(s) outside the known timestamp rows: ${JSON.stringify(outside)} (allowed: ${JSON.stringify(allowed)})`);
    await writeFile(baselinePath, current);
    advanced += 1;
  }
  if (stabilityErrors.length) console.log(`pixel-stability: ${stabilityErrors.length} capture(s) drifted outside the timestamp rows; baseline advanced to this run so the next run compares against it.`);
  else if (established) console.log(`pixel-stability: baseline established for ${established} capture(s) (first run; nothing to compare).`);
  else if (advanced) console.log(`pixel-stability: ${advanced} capture(s) changed within the known timestamp rows; baseline advanced.`);
  else console.log("pixel-stability: all captures byte-identical to the previous run.");
  return stabilityErrors;
}

for (const profile of [
  { name: "singles-desktop", viewport: { width: 1440, height: 1100 }, mode: "singles" },
  { name: "tag-desktop", viewport: { width: 1440, height: 1100 }, mode: "tag" },
  { name: "tag-narrow", viewport: { width: 390, height: 844 }, mode: "tag" },
]) {
  currentProfile = profile.name;
  await page.setViewportSize(profile.viewport);
  await gotoApp();
  await assertAccessibleNameCoverage(profile.name);
  await assertLandmarkAndHeadingStructure(profile.name);
  await assertKeyboardTraversal(profile.name, "main");
  if (profile.mode === "tag") {
    await page.getByLabel("Mode").selectOption("tag");
    await page.getByLabel("Advanced exhibition options").click();
    await page.getByLabel("Include internal test wrestlers").check();
    await page.getByLabel("Your wrestler").selectOption("fixture:player-a");
    await page.getByLabel("Your partner").selectOption("fixture:player-b");
    await page.getByLabel("Opponent", { exact: true }).selectOption("fixture:ai-a");
    await page.getByLabel("Opponent partner", { exact: true }).selectOption("fixture:ai-b");
    await page.getByRole("button", { name: "Start with manual seed" }).click();
    await page.waitForFunction(() => document.body.textContent?.includes("Nova Hart"));
  }
  await assertPage(profile.name);
  await capture(page, `ringcraft-${profile.name}.png`);
  const noDodge = page.getByRole("button", { name: "Do not Dodge" });
  if (await noDodge.count()) await noDodge.click();
  await page.waitForFunction(() => document.querySelectorAll(".event-log li").length > 3);
  await assertPage(`${profile.name}-after-action`);
  if (profile.name === "tag-desktop") {
    // Play the seeded tag match to a result and pin its replay hash, mirroring the ruthless leg.
    let tagGuard = 0;
    while (!(await page.locator(".decision--result").count()) && tagGuard < 1200) {
      const action = page.locator("button.action:visible").first();
      if (!(await action.count())) break;
      await action.click();
      tagGuard++;
    }
    if (!(await page.locator(".decision--result").count())) errors.push("tag-desktop: tag match did not reach a result within the action cap");
    const tagDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export replay" }).click();
    const tagReplay = JSON.parse(readFileSync(await (await tagDownload).path(), "utf8"));
    const { replayFromInputLog: replayTag } = await server.ssrLoadModule("/src/core/engine.ts");
    const { hashMatchState: hashTag } = await server.ssrLoadModule("/src/core/hash.ts");
    const tagHash = hashTag(replayTag({ config: tagReplay.config, inputLog: tagReplay.inputs }));
    if (tagHash !== tagReplay.expectedStateHash) errors.push(`tag-desktop: external replay hash ${tagHash} diverged from the app's pinned ${tagReplay.expectedStateHash}`);
    if (tagHash !== TAG_SEED_1991_REPLAY_HASH) errors.push(`tag-desktop: seeded tag replay hash changed to ${tagHash} (pinned ${TAG_SEED_1991_REPLAY_HASH})`);
  }
}

currentProfile = "accessibility";
await page.setViewportSize({ width: 1024, height: 900 });
await gotoApp();
await page.locator(".accessibility summary").click();
await page.getByLabel("Larger text").check();
await page.getByLabel("High contrast").check();
await page.getByLabel("Reduced motion").check();
if (!(await page.locator("main.a11y-large.a11y-contrast.a11y-reduced").count())) errors.push("accessibility: option classes were not applied");
await assertAccessibleNameCoverage("accessibility");
await assertLandmarkAndHeadingStructure("accessibility");
await assertNoColorOnlyStatus("accessibility");
await assertDifficultyHintWiring("accessibility", "AI difficulty");
await capture(page, "ringcraft-accessibility.png");

// Keyboard-only import-bundle preview: the save-manager's "Apply import"
// confirm gate must be reachable and fully operable with the keyboard alone.
// Start a deterministic career, save a named save, export it as a bundle,
// wipe it, and re-import so the preview opens; then drive the preview with
// Tab/Enter only. The capture above is taken before this step so its bytes
// stay identical across runs.
await openCareer({ label: "setup surface" });
await startDeterministicQaCareer();
await page.waitForFunction(() => document.body.textContent?.includes("Championships and obligations"));
await page.getByLabel("New save name").fill("Accessibility QA import");
await page.getByRole("button", { name: "Save current campaign" }).click();
if (!(await saveRow("Accessibility QA import").count())) errors.push("accessibility: named save did not render before the import-preview keyboard check");
const a11yBundleDownload = page.waitForEvent("download");
await page.getByRole("button", { name: "Export save bundle" }).click();
const a11yBundleFile = await a11yBundleDownload;
let a11yWipeDialogType = null;
page.once("dialog", (dialog) => { a11yWipeDialogType = dialog.type(); void dialog.accept(); });
await saveRow("Accessibility QA import").getByRole("button", { name: "Delete" }).click();
if (a11yWipeDialogType !== "confirm") errors.push("accessibility: wipe-before-import did not open a confirm dialog");
await page.locator("input[aria-label='Import save bundle']").setInputFiles({ name: a11yBundleFile.suggestedFilename(), mimeType: "application/json", buffer: readFileSync(await a11yBundleFile.path()) });
await page.waitForFunction(() => document.body.textContent?.includes("Import bundle preview"));
if (!(await page.locator(".import-outcome--imported").count())) errors.push("accessibility: import preview did not flag the incoming save as imported");
await assertImportPreviewKeyboardOperable("accessibility", { bundleFile: a11yBundleFile, applyRowName: "Accessibility QA import" });
// Reset the save/autosave storage so the later career-setup profile starts from a clean slate.
// Iterate a snapshot of keys: Chromium's localStorage.key() enumeration reorders
// after a mid-list removal, so an index-based backwards loop can skip a key that
// shifts past the already-visited index (observed: the seq-195 snapshot survived
// a clear that removed seq-196). Removing from a frozen key list is order-proof.
await page.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key?.startsWith("asw91-campaign-save-") || key?.startsWith("asw91-project-ringcraft-autosave-v1")) localStorage.removeItem(key);
  }
});
await gotoApp();

currentProfile = "m10-difficulty-exhibition";
await page.setViewportSize({ width: 1440, height: 1100 });
await gotoApp();
await assertDifficultyHintWiring("m10-difficulty-exhibition", "AI difficulty");
await page.getByLabel("Advanced exhibition options").click();
await page.getByLabel("Include internal test wrestlers").check();
await page.getByLabel("Your wrestler").selectOption("fixture:player-a");
await page.getByLabel("Opponent", { exact: true }).selectOption("fixture:ai-a");
await page.getByLabel("Seed", { exact: true }).fill("1991");
await page.getByLabel("AI difficulty", { exact: true }).selectOption("ruthless");
if ((await page.getByLabel("AI difficulty", { exact: true }).inputValue()) !== "ruthless") errors.push("m10-difficulty-exhibition: difficulty select did not update");
if (!(await page.locator(".difficulty-hint__row--active", { hasText: "Ruthless" }).count())) errors.push("m10-difficulty-exhibition: selected difficulty not highlighted in the hint panel");
await page.getByRole("button", { name: "Start with manual seed" }).click();
let m10Guard = 0;
while (!(await page.locator(".decision--result").count()) && m10Guard < 600) {
  const action = page.locator("button.action:visible").first();
  if (!(await action.count())) break;
  await action.click();
  m10Guard++;
}
if (!(await page.locator(".decision--result").count())) errors.push("m10-difficulty-exhibition: ruthless match did not reach a result within the action cap");
if (!(await page.getByText(/asw91-ai-policy-v1 ruthless/).count())) errors.push("m10-difficulty-exhibition: ruthless policy label did not surface in the match event log");
if (!(await page.locator(".setup-panel .difficulty-hint__row--active", { hasText: "Ruthless" }).count())) errors.push("m10-difficulty-exhibition: active difficulty not highlighted in the persistent setup hint");
if (!(await page.locator("footer .verified", { hasText: "REPLAY VERIFIED" }).count())) errors.push("m10-difficulty-exhibition: replay verification badge missing on the completed match");
const footerStateHash = await page.evaluate(() => {
  const match = document.querySelector("footer")?.textContent?.match(/state (c14n-fnv1a64-v1:[0-9a-f]{16})/);
  return match ? match[1] : "";
});
if (!footerStateHash) errors.push("m10-difficulty-exhibition: could not read the final match state hash from the footer");
if (!(await page.locator("footer", { hasText: RUTHLESS_SEED_1991_REPLAY_HASH }).count())) errors.push("m10-difficulty-exhibition: pinned ruthless replay identity did not surface in the footer");
if (!(await page.locator("footer .verified", { hasText: /Pinned internal replay: .* - matched/ }).count())) errors.push("m10-difficulty-exhibition: footer did not report a matched pinned internal replay");
if (!(await page.locator("footer", { hasText: footerStateHash }).count())) errors.push("m10-difficulty-exhibition: footer did not surface the live match state hash");
const replayDownload = page.waitForEvent("download");
await page.getByRole("button", { name: "Export replay" }).click();
const replayExport = JSON.parse(readFileSync(await (await replayDownload).path(), "utf8"));
if (replayExport.config.seed !== 1991) errors.push(`m10-difficulty-exhibition: exported replay config lost the seeded value (seed ${replayExport.config.seed})`);
const { replayFromInputLog } = await server.ssrLoadModule("/src/core/engine.ts");
const { hashMatchState } = await server.ssrLoadModule("/src/core/hash.ts");
const replayHash = hashMatchState(replayFromInputLog({ config: replayExport.config, inputLog: replayExport.inputs }));
if (replayHash !== replayExport.expectedStateHash) errors.push(`m10-difficulty-exhibition: external replay hash ${replayHash} diverged from the app's pinned ${replayExport.expectedStateHash}`);
if (replayHash !== footerStateHash) errors.push(`m10-difficulty-exhibition: external replay hash ${replayHash} diverged from the footer hash ${footerStateHash}`);
console.log(`RUTHLESS_SEED_1991_REPLAY_HASH=${replayHash}`);
if (replayHash !== RUTHLESS_SEED_1991_REPLAY_HASH) errors.push(`m10-difficulty-exhibition: ruthless seeded replay hash changed to ${replayHash} (pinned ${RUTHLESS_SEED_1991_REPLAY_HASH})`);
await capture(page, "ringcraft-m10-difficulty-exhibition.png");

currentProfile = "tour";
const tourContext = await browser.newContext();
const tourPage = await tourContext.newPage();
tourPage.on("console", (message) => { if (message.type() === "error") errors.push(`${currentProfile}: ${message.text()}`); });
tourPage.on("pageerror", (error) => errors.push(`${currentProfile}: ${error.message}`));
await tourPage.goto(baseUrl, { waitUntil: "networkidle" });
if (!(await tourPage.locator(".tour-overlay").count())) errors.push("tour: onboarding overlay did not auto-open on first visit");
if (!(await tourPage.getByRole("heading", { name: "Run the Territory" }).count())) errors.push("tour: first step title missing");
if ((await tourPage.locator(".tour-overlay").getAttribute("role")) !== "dialog") errors.push("tour: overlay lacks dialog role");
if ((await tourPage.locator(".tour-overlay").getAttribute("aria-modal")) !== "true") errors.push("tour: overlay lacks aria-modal=true");
await assertAccessibleNameCoverage("tour", tourPage);
await assertDialogAccessibility("tour", ".tour-overlay", tourPage);
await tourPage.getByRole("button", { name: "Next" }).click();
if (!(await tourPage.getByText("One-off matches").count())) errors.push("tour: Next did not advance to the exhibition step");
if (!(await tourPage.getByText("difficulty never changes rules dice").count())) errors.push("tour: exhibition step is missing the onboarding difficulty line");
if (!(await tourPage.getByText("novice plays forgiving hash-derived mistakes").count())) errors.push("tour: exhibition difficulty line does not describe the novice level");
// Advance through creator (2), progression (3), and career (4) to the Career
// step, which carries the onboarding difficulty line.
await tourPage.getByRole("button", { name: "Next" }).click();
if (!(await tourPage.getByText("Build a legal wrestler").count())) errors.push("tour: Next did not advance to the creator step");
await tourPage.getByRole("button", { name: "Next" }).click();
if (!(await tourPage.getByText("Spend match WP").count())) errors.push("tour: Next did not advance to the progression step");
await tourPage.getByRole("button", { name: "Next" }).click();
if (!(await tourPage.getByText("The verified loop").count())) errors.push("tour: Next did not advance to the career step");
if (!(await tourPage.getByText("difficulty never changes rules dice").count())) errors.push("tour: career step is missing the onboarding difficulty line");
if (!(await tourPage.getByText("novice plays forgiving hash-derived mistakes").count())) errors.push("tour: career difficulty line does not describe the novice level");
await capture(tourPage, "ringcraft-tour.png");
await tourPage.locator(".tour-overlay").press("Escape");
if (await tourPage.locator(".tour-overlay").count()) errors.push("tour: Escape did not dismiss the overlay");
await tourContext.close();

currentProfile = "help-toggle";
await page.getByRole("button", { name: "Open the guided tour" }).click();
if (!(await page.locator(".tour-overlay").count())) errors.push("help-toggle: ? button did not reopen the tour");
await assertDialogAccessibility("help-toggle", ".tour-overlay");
await page.locator(".tour-overlay").press("Escape");
if (await page.locator(".tour-overlay").count()) errors.push("help-toggle: Escape did not close the reopened tour");
if (!(await page.getByRole("button", { name: "Open the guided tour" }).evaluate((element) => document.activeElement === element))) errors.push("help-toggle: focus did not return to opener");
await capture(page, "ringcraft-help-toggle.png");

currentProfile = "creator-desktop";
await page.setViewportSize({ width: 1440, height: 1100 });
await gotoApp();
await openSurface({ nav: "Create Wrestler", selector: ".creator-surface", label: "creator surface" });
if (!(await page.locator(".validation--error").count())) errors.push("creator-initial: expected incomplete-creator validation was not visible");
await assertSurface("creator-initial", ".creator-surface");
await assertAccessibleNameCoverage("creator-initial");
await assertLandmarkAndHeadingStructure("creator-initial");
await assertKeyboardTraversal("creator-initial", ".creator-surface");
await capture(page, "ringcraft-creator-validation.png");
await page.getByRole("button", { name: "Roll height and weight" }).click();
await page.getByRole("button", { name: "Roll debut history" }).click();
await page.getByRole("button", { name: "Build exact-spend legal package" }).click();
await page.waitForFunction(() => document.body.textContent?.includes("All creator invariants pass"));
await assertSurface("creator-desktop", ".creator-surface");
await capture(page, "ringcraft-creator-desktop.png");

currentProfile = "creator-narrow";
await page.setViewportSize({ width: 390, height: 844 });
await assertSurface("creator-narrow", ".creator-surface");
await capture(page, "ringcraft-creator-narrow.png");
await page.getByRole("button", { name: "Finalize wrestler" }).click();
await page.waitForFunction(() => document.body.textContent?.includes("it is now available for exhibitions and progression"));

currentProfile = "created-exhibition";
await page.setViewportSize({ width: 1440, height: 1000 });
await openSurface({ nav: "Exhibition", selector: ".setup-panel", label: "setup panel" });
const createdOptionValue = await page.getByLabel("Your wrestler", { exact: true }).locator("option").filter({ hasText: "New Challenger" }).getAttribute("value");
if (!createdOptionValue) errors.push("created-exhibition: finalized wrestler option was missing");
else await page.getByLabel("Your wrestler", { exact: true }).selectOption(createdOptionValue);
await page.getByLabel("Advanced exhibition options").click();
await page.getByRole("button", { name: "Start with manual seed" }).click();
await page.waitForFunction(() => Array.from(document.querySelectorAll("button.action")).some((element) => element instanceof HTMLElement && element.offsetParent !== null));
await assertPage("created-exhibition");
await capture(page, "ringcraft-created-exhibition.png");

currentProfile = "progression";
await page.setViewportSize({ width: 1200, height: 900 });
await openSurface({ nav: "Progression", selector: ".progression-surface", label: "progression surface" });
await page.getByRole("button", { name: "Apply match award" }).click();
await page.waitForFunction(() => document.body.textContent?.includes("available WP") && document.querySelectorAll(".compact-log li").length > 0);
await assertSurface("progression", ".progression-surface");
await assertAccessibleNameCoverage("progression");
await assertLandmarkAndHeadingStructure("progression");
await assertKeyboardTraversal("progression", ".progression-surface");
await capture(page, "ringcraft-progression.png");

currentProfile = "career-setup";
await page.setViewportSize({ width: 1440, height: 1100 });
const careerSetupSurfaceReady = await openCareer({ label: "setup surface" });
await assertSurface("career-setup", ".career-surface");
await assertAccessibleNameCoverage("career-setup");
await assertLandmarkAndHeadingStructure("career-setup");
await assertKeyboardTraversal("career-setup", ".career-surface");
if (careerSetupSurfaceReady) await ensureCareerOptionsOpen("Developer fixtures");
if (!(await page.getByRole("button", { name: "Load completed fixture" }).count())) errors.push("career-setup: completed fixture shortcut missing");
if (!(await page.getByRole("button", { name: "Load in-progress fixture" }).count())) errors.push("career-setup: in-progress fixture shortcut missing");
if (careerSetupSurfaceReady) {
  await page.getByRole("button", { name: "Load completed fixture" }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("Freebuff M5 Example Career"));
  if (!(await page.locator(".playtest-panel").count())) errors.push("career-fixture-completed: playtest panel missing");
}
await page.evaluate(() => { for (const key of Object.keys(localStorage)) { if (key?.startsWith("asw91-project-ringcraft-autosave-v1")) localStorage.removeItem(key); } });
await page.reload({ waitUntil: "networkidle" });
const careerRecoveryReady = await openCareer({ label: "setup surface" });
if (careerRecoveryReady) {
  await ensureCareerOptionsOpen("Developer fixtures");
  await page.getByRole("button", { name: "Load in-progress fixture" }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("Career match in progress"));
  if (!(await page.locator(".playtest-panel").count())) errors.push("career-fixture-recovery: playtest panel missing during recovery");
}
await page.evaluate(() => { for (const key of Object.keys(localStorage)) { if (key?.startsWith("asw91-project-ringcraft-autosave-v1")) localStorage.removeItem(key); } });
await page.reload({ waitUntil: "networkidle" });
await openCareer({ label: "setup surface" });
await assertSurface("career-setup", ".career-surface");
await recordTimestampRows("ringcraft-career-setup.png");
await capture(page, "ringcraft-career-setup.png");
  await ensureCareerOptionsOpen("Developer / deterministic options");
  await page.getByLabel("Career seed").fill("2000");
  await ensureCareerOptionsOpen("Advanced / optional extensions");
  await page.getByLabel("Post-match injury checks").selectOption("d20-check");
  // The curve-fair renewals checkbox is gated on the negotiation toggle: it
  // starts disabled, enables with negotiation, and wires renewalStrategy
  // "curve-fair" into the created campaign (re-pinning the post-match hash).
  if (!(await page.getByLabel("Enable curve-fair renewals", { exact: true }).isDisabled())) errors.push("career-setup: curve-fair renewals should start disabled without negotiation");
  await page.getByLabel("Enable contracts and finance extension").check();
  await page.getByLabel("Enable contract negotiation extension").check();
  if (await page.getByLabel("Enable curve-fair renewals", { exact: true }).isDisabled()) errors.push("career-setup: curve-fair renewals did not enable with negotiation");
  await page.getByLabel("Enable curve-fair renewals", { exact: true }).check();
  await page.getByLabel("Enable feuds and booking extension").check();
  await startDeterministicQaCareer();
  await page.waitForFunction(() => document.body.textContent?.includes("Championships and obligations"));
  await assertSurface("career-desktop", ".career-surface");
  if (!(await page.locator(".autosave-row").count())) errors.push("career-desktop: autosave history missing after starting the career");
  // M13 feud panel: start a feud through the panel's own controls so the
  // rivalry list, heat history, and booking card render real content in the
  // career-desktop capture (the start consumes no dice).
  await page.getByLabel("Feud entrant one").selectOption({ index: 1 });
  await page.getByLabel("Feud entrant two").selectOption({ index: 1 });
  await page.getByLabel("Feud label").fill("QA grudge");
  await page.getByRole("button", { name: "Start feud" }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("QA grudge"));
  if (!(await page.locator(".status-pill--active").count())) errors.push("career-desktop: active feud status pill missing after starting a feud");
  // M12 negotiation panel: offer a fair contract through the panel's own
  // controls so the contract list, expected-salary line, and the deterministic
  // accept basis render real content in the career-desktop capture (a fair
  // offer consumes no dice).
  await page.getByLabel("Negotiation target").selectOption({ index: 1 });
  await page.getByLabel("Offer weekly salary").fill("350");
  await page.getByLabel("Offer term weeks").fill("26");
  await page.getByRole("button", { name: "Offer contract" }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("Fair offer: $350/week meets the $350 expectation"));
  if (!(await page.getByText(/Fair offer: \$350\/week meets the \$350 expectation/).count())) errors.push("career-desktop: negotiation accept basis missing after the fair offer");
  if (!(await page.getByText(/Expected \$350\/week \(salary curve\)/).count())) errors.push("career-desktop: negotiation expected-salary line missing");
  if (!(await page.getByText(/Renewal strategy: curve-fair/).count())) errors.push("career-desktop: active renewal strategy line missing (expected curve-fair)");
// Deterministic, timestamp-free assertion: the frozen clock pins the rendered
// autosave timestamp to fixed text (1991-01-01T12:00:00.000Z under en-US/UTC),
// so the save-manager screenshots' bytes no longer depend on the host wall clock.
if (!(await page.locator(".autosave-row span").first().getByText(/^Saved 1\/1\/1991, 12:00:00 PM/).count())) errors.push("autosave: rendered snapshot timestamp diverged from the pinned frozen-clock value (expected 1/1/1991, 12:00:00 PM)");
await page.getByLabel("New save name").fill("Career QA checkpoint");
await page.getByRole("button", { name: "Save current campaign" }).click();
if (!(await saveRow("Career QA checkpoint").count())) errors.push("career-desktop: named save did not render in the save manager");
await saveRow("Career QA checkpoint").getByRole("button", { name: "Duplicate" }).click();
if (!(await saveRow("Career QA checkpoint (copy)").count())) errors.push("save-manager: duplicated save did not render as a (copy)");
let renameDialogType = null;
page.once("dialog", (dialog) => { renameDialogType = dialog.type(); void dialog.accept("Career QA renamed"); });
await saveRow("Career QA checkpoint (copy)").getByRole("button", { name: "Rename" }).click();
if (renameDialogType !== "prompt") errors.push("save-manager: rename did not open a prompt dialog");
if (!(await saveRow("Career QA renamed").count())) errors.push("save-manager: renamed save did not render under the new name");
if (await saveRow("Career QA checkpoint (copy)").count()) errors.push("save-manager: old name lingered after rename");
let cancelDeleteDialogType = null;
page.once("dialog", (dialog) => { cancelDeleteDialogType = dialog.type(); void dialog.dismiss(); });
await saveRow("Career QA renamed").getByRole("button", { name: "Delete" }).click();
if (cancelDeleteDialogType !== "confirm") errors.push("save-manager: delete did not open a confirm dialog");
if (!(await saveRow("Career QA renamed").count())) errors.push("save-manager: dismissed delete dialog still removed the save");
let deleteDialogType = null;
page.once("dialog", (dialog) => { deleteDialogType = dialog.type(); void dialog.accept(); });
await saveRow("Career QA renamed").getByRole("button", { name: "Delete" }).click();
if (deleteDialogType !== "confirm") errors.push("save-manager: confirmed delete path did not open a confirm dialog");
if (await saveRow("Career QA renamed").count()) errors.push("save-manager: confirmed delete left the save behind");
if (!(await saveRow("Career QA checkpoint").count())) errors.push("save-manager: deleting the duplicate removed the original save");
const bundleDownload = page.waitForEvent("download");
await page.getByRole("button", { name: "Export save bundle" }).click();
const bundleFile = await bundleDownload;
if (!bundleFile.suggestedFilename().match(/^ringcraft-save-bundle-\d{4}-\d{2}-\d{2}\.json$/)) errors.push(`save-bundle: unexpected export filename ${bundleFile.suggestedFilename()}`);
const bundlePath = await bundleFile.path();
const bundleJson = JSON.parse(readFileSync(bundlePath, "utf8"));
if (bundleJson.schema !== "asw91-campaign-save-bundle-v1") errors.push("save-bundle: exported bundle does not carry the v1 schema tag");
if (!Array.isArray(bundleJson.saves) || bundleJson.saves.length !== 1) errors.push(`save-bundle: expected 1 named save in the export, got ${bundleJson.saves?.length}`);
if (bundleJson.saves.some((entry) => typeof entry.key !== "string" || !entry.key.startsWith("asw91-campaign-save-") || typeof entry.value !== "string")) errors.push("save-bundle: exported entries do not use the named-save key prefix");
let wipeDialogType = null;
page.once("dialog", (dialog) => { wipeDialogType = dialog.type(); void dialog.accept(); });
await saveRow("Career QA checkpoint").getByRole("button", { name: "Delete" }).click();
if (wipeDialogType !== "confirm") errors.push("save-bundle: wipe-before-import did not open a confirm dialog");
if (await page.locator(".save-row").count()) errors.push("save-bundle: save list was not empty after wiping for the import test");
await page.locator("input[aria-label='Import save bundle']").setInputFiles({ name: bundleFile.suggestedFilename(), mimeType: "application/json", buffer: readFileSync(bundlePath) });
await page.waitForFunction(() => document.body.textContent?.includes("Import bundle preview"));
if (!(await page.locator(".import-outcome--imported").count())) errors.push("save-bundle: import preview did not flag the incoming save as imported");
await page.getByRole("button", { name: "Apply import" }).click();
await page.waitForFunction(() => document.body.textContent?.includes("Imported 1 named save"));
if (!(await saveRow("Career QA checkpoint").count())) errors.push("save-bundle: re-imported save did not render in the save manager");
// Merged-row diff hint: import a bundle whose entry collides with the existing save
// but carries a newer snapshot (future updatedAt, advanced date and record); the
// preview must flag it merged and show the stored-vs-incoming diff hint before Apply.
const mergeBundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const mergedEntry = mergeBundle.saves[0];
const mergedValue = JSON.parse(mergedEntry.value);
mergedValue.updatedAt = "2099-01-01T00:00:00.000Z";
mergedValue.preview = { ...mergedValue.preview, currentDate: "1991-03-01", wins: mergedValue.preview.wins + 1 };
mergedEntry.value = JSON.stringify(mergedValue);
await page.locator("input[aria-label='Import save bundle']").setInputFiles({ name: "merge-bundle.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(mergeBundle)) });
await page.waitForFunction(() => document.body.textContent?.includes("Import bundle preview"));
if (!(await page.locator(".import-outcome--merged").count())) errors.push("save-bundle: merge preview did not flag the newer same-campaign entry as merged");
if (!(await page.locator(".import-diff").count())) errors.push("save-bundle: merged row lacks the stored-vs-incoming diff hint");
if (!(await page.locator(".import-diff", { hasText: /Date: .* -> 1991-03-01/ }).count())) errors.push("save-bundle: diff hint missing the date change");
if (!(await page.locator(".import-diff", { hasText: /Record: .* -> .*W\// }).count())) errors.push("save-bundle: diff hint missing the record change");
await page.getByRole("button", { name: "Cancel" }).click();
await page.waitForFunction(() => !document.querySelector(".overwrite-preview[aria-label='Import bundle preview']")).catch(() => errors.push("save-bundle: Cancel did not dismiss the merged preview"));
if (!(await page.locator("input[aria-label='Remote save endpoint']").count())) errors.push("remote-sync: endpoint field missing from the save manager");
if (!(await page.locator("input[aria-label='Auto-sync saves']").count())) errors.push("remote-sync: auto-sync toggle missing from the save manager");
if (!(await page.getByRole("button", { name: "Sync" }).count())) errors.push("remote-sync: Sync button missing");
if (!(await page.getByRole("button", { name: "Force push" }).count())) errors.push("remote-sync: Force push button missing");
if (!(await page.getByRole("button", { name: "Force pull" }).count())) errors.push("remote-sync: Force pull button missing");
// Remote save sync against the in-repo mock endpoint: push, conflict, and both
// resolution paths — force push (local wins) then, after re-diverging the
// remote, force pull (remote wins).
const remoteMock = await createMockSaveSyncServer({ port: MOCK_SYNC_PORT });
const remoteEndpoint = remoteMock.endpoint;
// The endpoint's 404/409 responses are the expected save-sync contract signals, not page errors.
suppressResourceLoadErrors = true;
await page.locator("input[aria-label='Remote save endpoint']").fill(remoteEndpoint);
await page.getByRole("button", { name: "Sync" }).click();
await page.waitForFunction(() => document.querySelector(".sync-status")?.textContent?.includes("Pushed"), { timeout: 15000 }).catch(() => errors.push("remote-sync: first sync did not push local saves"));
if (!(await page.locator(".sync-status--pushed").count())) errors.push("remote-sync: pushed status not rendered");
// Keep the remote's pushed bundle (without the copy) so the force-pull leg
// still has different content to adopt after force push resolves the conflict.
const preConflictBundle = remoteMock.state.bundle;
// Change both sides: duplicate locally, then advance the remote behind the gate's back.
await saveRow("Career QA checkpoint").getByRole("button", { name: "Duplicate" }).click();
if (!(await saveRow("Career QA checkpoint (copy)").count())) errors.push("remote-sync: duplicate did not change the local bundle");
await remoteMock.putForce(remoteMock.state.bundle);
await page.getByRole("button", { name: "Sync" }).click();
await page.waitForFunction(() => document.querySelector(".sync-status")?.textContent?.toLowerCase().includes("conflict"), { timeout: 15000 }).catch(() => errors.push("remote-sync: both-sides change did not surface a conflict"));
if (!(await page.locator(".sync-status--conflict").count())) errors.push("remote-sync: conflict status not rendered");
// Force push resolves the conflict with the local side winning: the remote
// bundle is replaced by the local saves (copy included) and the status clears.
await page.getByRole("button", { name: "Force push" }).click();
await page.waitForFunction(() => document.querySelector(".sync-status")?.textContent?.includes("Force-pushed"), { timeout: 15000 }).catch(() => errors.push("remote-sync: force push did not resolve the conflict with local wins"));
if (!(await page.locator(".sync-status--pushed").count())) errors.push("remote-sync: force-push resolution did not render the pushed status");
if (!remoteMock.state.bundle.saves.some((entry) => JSON.parse(entry.value).name === "Career QA checkpoint (copy)")) errors.push("remote-sync: force push did not replace the remote bundle with the local saves");
if (remoteMock.state.revision !== 3) errors.push(`remote-sync: force push did not advance the remote revision (expected 3, got ${remoteMock.state.revision})`);
// Re-diverging the remote lets the force-pull leg exercise remote-wins.
await remoteMock.putForce(preConflictBundle);
await page.getByRole("button", { name: "Force pull" }).click();
await page.waitForFunction(() => document.querySelector(".sync-status")?.textContent?.includes("Pulled"), { timeout: 15000 }).catch(() => errors.push("remote-sync: force pull did not adopt the remote bundle"));
if (!(await page.locator(".sync-status--pulled").count())) errors.push("remote-sync: pulled status not rendered");
if (await saveRow("Career QA checkpoint (copy)").count()) errors.push("remote-sync: force pull did not replace the local save set with the remote bundle");
// Enabling scheduled auto-sync fires one immediate background sync and surfaces
// the result in the panel with the Auto-sync prefix (the arc left local, remote,
// and the sync meta in the up-to-date state, so the immediate sync reports it).
// The toggle is restored to off afterwards so the deterministic captures keep
// the default panel state. This must run while the mock server is still up.
await page.locator("input[aria-label='Auto-sync saves']").check();
await page.waitForFunction(() => document.querySelector(".sync-status")?.textContent?.startsWith("Auto-sync:"), { timeout: 15000 }).catch(() => errors.push("remote-sync: enabling auto-sync did not surface an immediate background sync"));
if (!(await page.locator(".sync-status", { hasText: /^Auto-sync:/ }).count())) errors.push("remote-sync: auto-sync status line missing the Auto-sync prefix");
if (!(await page.locator(".sync-baseline", { hasText: /server revision 4/ }).count())) errors.push("remote-sync: auto-sync did not update the last-synced baseline");
await page.locator("input[aria-label='Auto-sync saves']").uncheck();
suppressResourceLoadErrors = false;
remoteMock.close();
// The last-synced baseline line reads from the sync meta: fingerprint, revision, and when.
if (!(await page.locator(".sync-baseline").count())) errors.push("remote-sync: last-synced baseline line missing after the sync arc");
if (!(await page.locator(".sync-baseline", { hasText: /server revision 4/ }).count())) errors.push("remote-sync: baseline line missing the server revision");
if (!(await page.locator(".sync-baseline", { hasText: /bundle [0-9a-f]{8}/ }).count())) errors.push("remote-sync: baseline line missing the bundle fingerprint");
if (!(await page.getByText(/Canonical round trip: verified/).count())) errors.push("career-desktop: canonical save round-trip indicator missing");
if (!(await page.getByText(/Opposition AI difficulty: standard/).count())) errors.push("career-desktop: default difficulty label missing from the dashboard");
if (!(await page.locator(".month-banner").count())) errors.push("career-desktop: month-end banner missing on fresh career");
// The month-end report lists the autosave ring: the frozen clock pins the
// career-start snapshot, the feud-start transaction, and the contract-offer
// transaction each write one, so the banner must report 3 retained snapshots
// and the newest restore point 1991-01-01.
if (!(await page.locator(".month-banner").getByText(/^Autosaves: 3 snapshots retained; newest restore point 1991-01-01/).count())) errors.push("career-desktop: month-end banner missing the autosave ring line (3 snapshots, restore point 1991-01-01)");
if (!(await page.locator(".dossier-panel").count())) errors.push("career-desktop: career dossier panel missing");
if (!(await page.locator(".blocked-guidance").count())) errors.push("career-desktop: blocked-action guidance missing");
if (!(await page.locator(".blocked-guidance .status-pill--blocked").count())) errors.push("career-desktop: no blocked action pill rendered");
if (!(await page.locator(".playtest-panel").count())) errors.push("career-desktop: playtest panel missing");
if (!(await page.getByLabel("Playtest session goal").count())) errors.push("career-desktop: playtest goal field missing");
if (!(await page.getByRole("textbox", { name: "Playtest notes" }).count())) errors.push("career-desktop: playtest notes field missing");
if (!(await page.getByRole("group", { name: "Friction tags" }).count())) errors.push("career-desktop: friction tag group missing");
await page.getByLabel("Playtest session goal").fill("Find the next booking");
await page.getByLabel("Unclear next step").check();
await page.getByRole("textbox", { name: "Playtest notes" }).fill("The first career loop is understandable.");
await page.getByRole("button", { name: "Save notes" }).click();
if (!(await page.getByText("Saved locally").count())) errors.push("career-desktop: playtest notes did not save");
await assertAccessibleNameCoverage("career-desktop");
await assertLandmarkAndHeadingStructure("career-desktop");
await assertKeyboardTraversal("career-desktop", ".career-surface");
await assertLiveRegion("career-desktop", ".playtest-panel__status");
await assertNoColorOnlyStatus("career-desktop");
const reportDownload = page.waitForEvent("download");
await page.getByRole("button", { name: "Export playtest report" }).click();
const reportFile = await reportDownload;
if (!reportFile.suggestedFilename().endsWith("-playtest-report.json")) errors.push(`career-desktop: unexpected report filename ${reportFile.suggestedFilename()}`);
await page.reload({ waitUntil: "networkidle" });
await openCareer({
  predicate: () => document.body.textContent?.includes("Championships and obligations") && document.querySelector("input[aria-label='Playtest session goal']")?.value === "Find the next booking",
  label: "dashboard with the restored playtest goal",
});
if (await page.getByRole("textbox", { name: "Playtest session goal" }).inputValue() !== "Find the next booking") errors.push("career-desktop: saved playtest goal did not survive reload");
await recordTimestampRows("ringcraft-career-desktop.png");
await capture(page, "ringcraft-career-desktop.png");
// The import-campaign-JSON path shares the diff preview when a live campaign
// would be replaced: reimporting the current campaign shows no tracked
// differences, importing the M5 completed fixture shows the rollback diff, and
// Cancel leaves the live campaign untouched either way.
const campaignJsonDownload = page.waitForEvent("download");
await page.getByRole("button", { name: "Export campaign JSON" }).click();
const campaignJsonBuffer = readFileSync(await (await campaignJsonDownload).path());
await page.locator("input[aria-label='Replace campaign from JSON']").setInputFiles({ name: "reimport.json", mimeType: "application/json", buffer: campaignJsonBuffer });
await page.waitForFunction(() => document.querySelector("[aria-label='Import campaign preview']") !== null);
if (!(await page.locator("[aria-label='Import campaign preview']").getByText(/^Import reimport\.json: \d+W\/\d+D\/\d+L \(\d+ matches\) \u2014 hash c14n-fnv1a64-v1:[0-9a-f]{16}$/).count())) errors.push("import-json: reimport preview missing the snapshot summary (record, hash)");
if (!(await page.locator("[aria-label='Import campaign preview']").getByText("No tracked differences").count())) errors.push("import-json: same-campaign reimport did not report no tracked differences");
if (!(await page.locator("[aria-label='Import campaign preview']").getByText(/^Current c14n-fnv1a64-v1:[0-9a-f]{16} -> imported c14n-fnv1a64-v1:[0-9a-f]{16}$/).count())) errors.push("import-json: preview missing the current -> imported hash equation");
await page.locator("[aria-label='Import campaign preview']").getByRole("button", { name: "Cancel" }).click();
await page.waitForFunction(() => !document.querySelector("[aria-label='Import campaign preview']"));
if (!(await page.locator("#career-dashboard-title").getByText("Private Ringcraft Career").count())) errors.push("import-json: cancelled reimport still replaced the live campaign");
// A genuinely different campaign opens the same preview with the rollback diff.
await page.locator("input[aria-label='Replace campaign from JSON']").setInputFiles({ name: "example-career-save.json", mimeType: "application/json", buffer: readFileSync(new URL("../fixtures/m5/example-career-save.json", import.meta.url)) });
await page.waitForFunction(() => document.querySelector("[aria-label='Import campaign preview']") !== null);
if (!(await page.locator("[aria-label='Import campaign preview'] .overwrite-preview__list li").count())) errors.push("import-json: cross-campaign import preview did not open a rollback diff list");
if (!(await page.locator("[aria-label='Import campaign preview'] .overwrite-preview__list li", { hasText: /Record: .* -> .*W\// }).count())) errors.push("import-json: cross-campaign diff missing the record rollback line");
await page.locator("[aria-label='Import campaign preview']").getByRole("button", { name: "Cancel" }).click();
await page.waitForFunction(() => !document.querySelector("[aria-label='Import campaign preview']"));
if (!(await page.locator("#career-dashboard-title").getByText("Private Ringcraft Career").count())) errors.push("import-json: cancelled cross-campaign import still replaced the live campaign");
// Reset the file input so the rendered "No file chosen" label (and the capture bytes) match the pre-test state.
await page.locator("input[aria-label='Replace campaign from JSON']").setInputFiles([]);
const missingLabels = await page.evaluate(() => {
  const bad = [];
  for (const element of Array.from(document.querySelectorAll("input, select, textarea"))) {
    if (!(element.getAttribute("aria-label") || (element.id && document.querySelector(`label[for="${element.id}"]`)) || element.closest("label"))) bad.push(element.outerHTML.slice(0, 60));
  }
  return bad;
});
if (missingLabels.length) errors.push(`a11y-controls: ${missingLabels.length} form controls lack a label: ${missingLabels.slice(0, 3).join(" | ")}`);
if (!(await page.locator("input[aria-label='Autosave retention']").count())) errors.push("autosave: retention input missing from the dashboard");
if (!(await page.locator(".autosave-row").first().getByRole("button", { name: "Export as save" }).count())) errors.push("autosave: export-as-save button missing on snapshot rows");
if (!(await page.locator(".autosave-row").first().getByRole("button", { name: "Prune" }).count())) errors.push("autosave: prune button missing on snapshot rows");
await page.getByLabel("Autosave retention").fill("2");
await page.waitForFunction(() => document.querySelectorAll(".autosave-row").length <= 2, { timeout: 10000 });
if (!(await page.locator(".autosave-row").count())) errors.push("autosave: retention setting emptied the snapshot ring");
// Restore/load previews: advance a day so the live campaign diverges from the stored snapshots.
if (!(await page.getByRole("button", { name: "Advance one day" }).isEnabled())) errors.push("restore-preview: fresh career could not advance a day to create diff material");
await page.getByRole("button", { name: "Advance one day" }).click();
await page.waitForFunction(() => document.body.textContent?.includes("1991-01-02"), { timeout: 10000 });
const restorePreview = () => page.getByRole("group", { name: "Restore preview" });
// Named-save load preview (cancel path): shows the rollback diff, never applies.
await saveRow("Career QA checkpoint").getByRole("button", { name: "Load" }).click();
await page.waitForFunction(() => document.querySelector("[aria-label='Restore preview']") !== null, { timeout: 10000 });
if (!(await restorePreview().count())) errors.push("restore-preview: loading a named save did not open the restore preview");
if (!(await restorePreview().getByText("Date: 1991-01-02 -> 1991-01-01").count())) errors.push("restore-preview: load preview did not list the rollback diff line");
if (!(await restorePreview().getByText(/-> stored/).count())) errors.push("restore-preview: load preview missing the current -> stored hash equation");
if (!(await restorePreview().getByText(/^Snapshot Career QA checkpoint: \d+W\/\d+D\/\d+L \(\d+ matches\) \u2014 hash c14n-fnv1a64-v1:[0-9a-f]{16}$/).count())) errors.push("restore-preview: load preview missing the snapshot summary (date, record, hash)");
if (!(await restorePreview().getByText(/^Restoring discards \d+ event/).count())) errors.push("restore-preview: load preview missing the discard warning line");
if (!(await restorePreview().getByText(/roll forward again by restoring a newer snapshot or named save/).count())) errors.push("restore-preview: load preview missing the roll-forward hint");
await restorePreview().getByRole("button", { name: "Cancel" }).click();
if (await restorePreview().count()) errors.push("restore-preview: cancel did not close the load preview");
if (!(await page.getByText("1991-01-02").count())) errors.push("restore-preview: cancelled load still changed the campaign date");
// Autosave restore preview (confirm path): restoring the oldest snapshot rolls the campaign back.
// Capture the snapshot's pinned campaignHash from its history row first, so the post-restore
// assertions can prove the live campaign hashes to exactly the snapshot (byte-exact restore).
const restoreSnapshotHash = (await page.locator(".autosave-row").last().locator("span").first().textContent())?.match(/c14n-fnv1a64-v1:[0-9a-f]{16}/)?.[0] ?? null;
if (!restoreSnapshotHash) errors.push("restore-hash: autosave row did not render the snapshot's pinned campaignHash");
await page.locator(".autosave-row").last().getByRole("button", { name: "Restore" }).click();
await page.waitForFunction(() => document.querySelector("[aria-label='Restore preview']") !== null, { timeout: 10000 });
if (!(await restorePreview().getByText("Date: 1991-01-02 -> 1991-01-01").count())) errors.push("restore-preview: autosave restore preview did not list the rollback diff line");
if (!(await restorePreview().getByText(/^Snapshot 1\/1\/1991, 12:00:00 PM: \d+W\/\d+D\/\d+L \(\d+ matches\) \u2014 hash c14n-fnv1a64-v1:[0-9a-f]{16}$/).count())) errors.push("restore-preview: autosave restore preview missing the snapshot summary (date, record, hash)");
if (!(await restorePreview().getByText(/^Restoring discards \d+ event/).count())) errors.push("restore-preview: autosave restore preview missing the discard warning line");
if (!(await restorePreview().getByText(/roll forward again by restoring a newer snapshot or named save/).count())) errors.push("restore-preview: autosave restore preview missing the roll-forward hint");
await restorePreview().getByRole("button", { name: "Confirm restore" }).click();
await page.waitForFunction(() => document.body.textContent?.includes("1991-01-01") && !document.querySelector("[aria-label='Restore preview']"), { timeout: 10000 });
if (!(await page.getByText(/Restored autosave from/).count())) errors.push("restore-preview: confirmed restore did not record the restore message");
// Restore-from-snapshot hash contract: the restore is byte-exact, not just
// date-approximate. The restore message hash (the snapshot's stored
// campaignHash) and the dashboard's live round-trip hash (recomputed from the
// restored campaign state) must both equal the pinned hash captured above.
if (restoreSnapshotHash && !(await page.getByText(new RegExp(`Restored autosave from .* \\(${restoreSnapshotHash}\\)`)).count())) errors.push("restore-hash: restore message hash diverged from the snapshot's pinned campaignHash");
if (restoreSnapshotHash && !(await page.getByText(new RegExp(`Canonical round trip: verified - ${restoreSnapshotHash}`)).count())) errors.push("restore-hash: live campaign hash after restore diverged from the snapshot's pinned campaignHash");
let exportPromptType = null;
page.once("dialog", (dialog) => { exportPromptType = dialog.type(); void dialog.accept("Snapshot export"); });
await page.locator(".autosave-row").first().getByRole("button", { name: "Export as save" }).click();
if (exportPromptType !== "prompt") errors.push("autosave: export-as-save did not open a name prompt");
if (!(await saveRow("Snapshot export").count())) errors.push("autosave: exported snapshot did not render as a named save");
const rowsBeforePrune = await page.locator(".autosave-row").count();
let pruneDialogType = null;
page.once("dialog", (dialog) => { pruneDialogType = dialog.type(); void dialog.accept(); });
await page.locator(".autosave-row").first().getByRole("button", { name: "Prune" }).click();
if (pruneDialogType !== "confirm") errors.push("autosave: prune did not open a confirm dialog");
if ((await page.locator(".autosave-row").count()) !== rowsBeforePrune - 1) errors.push("autosave: pruning a snapshot did not remove exactly one row");
// Clean up the promoted snapshot so the save-manager flow keeps its single save.
let cleanupDialogType = null;
page.once("dialog", (dialog) => { cleanupDialogType = dialog.type(); void dialog.accept(); });
await saveRow("Snapshot export").getByRole("button", { name: "Delete" }).click();
if (cleanupDialogType !== "confirm") errors.push("autosave: cleanup delete did not open a confirm dialog");
if (await saveRow("Snapshot export").count()) errors.push("autosave: exported snapshot cleanup left a named save behind");
// One-click export-all serializes the whole snapshot ring into the archival bundle.
const autosaveBundleDownload = page.waitForEvent("download");
await page.getByRole("button", { name: "Export all" }).click();
const autosaveBundleName = (await autosaveBundleDownload).suggestedFilename();
if (!autosaveBundleName.includes("autosave-bundle")) errors.push("autosave: export-all did not download the autosave bundle file");
const autosaveBundle = JSON.parse(readFileSync(await (await autosaveBundleDownload).path(), "utf8"));
if (autosaveBundle.schema !== "asw91-autosave-bundle-v1") errors.push("autosave: export-all bundle has the wrong schema");
if (!Array.isArray(autosaveBundle.autosaves) || autosaveBundle.autosaves.length === 0) errors.push("autosave: export-all bundle did not include the snapshot ring");
if (!autosaveBundle.autosaves.every((entry) => typeof entry.campaignHash === "string" && typeof entry.campaignJson === "string")) errors.push("autosave: export-all bundle entries are incomplete");

currentProfile = "career-narrow";
await page.setViewportSize({ width: 390, height: 844 });
await assertSurface("career-narrow", ".career-surface");
await recordTimestampRows("ringcraft-career-narrow.png");
await capture(page, "ringcraft-career-narrow.png");

currentProfile = "career-match";
await page.setViewportSize({ width: 1440, height: 1100 });
await page.getByRole("button", { name: "Decline", exact: true }).click();
if (!(await page.getByText(/Declined optional match offer/).count())) errors.push("career-offer: decline transaction was not recorded");
await page.getByRole("button", { name: "Accept and schedule" }).click();
await page.getByRole("button", { name: "Play due match" }).click();
await page.waitForFunction(() => document.body.textContent?.includes("Career match in progress"));
await assertPage("career-match");
await assertAccessibleNameCoverage("career-match");
await assertLandmarkAndHeadingStructure("career-match");
await assertKeyboardTraversal("career-match", ".career-match");
await assertLiveRegion("career-match", ".event-log .sr-only");
if (!(await page.locator(".difficulty-hint-disclosure").count())) errors.push("career-match: difficulty hint disclosure missing mid-match");
if (!(await page.locator(".difficulty-hint-disclosure summary").getByText(/Opposition AI difficulty: standard/).count())) errors.push("career-match: mid-match summary does not state the active difficulty");
await page.locator(".difficulty-hint-disclosure summary").click();
if (!(await page.locator(".difficulty-hint-disclosure .difficulty-hint").count())) errors.push("career-match: difficulty hint list did not expand mid-match");
if (!(await page.locator(".difficulty-hint-disclosure .difficulty-hint__row--active", { hasText: "Standard" }).count())) errors.push("career-match: active difficulty not highlighted in the mid-match hint");
await capture(page, "ringcraft-career-match.png");
const careerAction = page.locator("button.action:visible").first();
const careerEventCountBefore = await page.locator(".event-log li").count();
await careerAction.click();
await page.waitForFunction((count) => document.querySelectorAll(".event-log li").length > count, careerEventCountBefore);

currentProfile = "career-recovery";
await page.reload({ waitUntil: "networkidle" });
await dismissTour();
await openCareer({ predicate: () => document.body.textContent?.includes("Career match in progress"), label: "in-progress match surface" });
await assertPage("career-recovery");
await assertAccessibleNameCoverage("career-recovery");
await assertLandmarkAndHeadingStructure("career-recovery");
await assertKeyboardTraversal("career-recovery", ".career-match");
await assertLiveRegion("career-recovery", ".event-log .sr-only");
await capture(page, "ringcraft-career-recovery.png");

currentProfile = "career-post-match";
await page.setViewportSize({ width: 1440, height: 1100 });
let commitButton = page.getByRole("button", { name: "Commit official result" });
let guard = 0;
while ((await commitButton.count()) === 0 && guard < 600) {
  const action = page.locator("button.action:visible").first();
  if (!(await action.count())) break;
  await action.click();
  guard++;
}
if ((await commitButton.count()) === 0) {
  errors.push("career-post-match: match did not reach a committable result within the action cap");
} else {
  await commitButton.click();
  await page.waitForFunction(() => document.querySelector(".report-card"));
  if (!(await page.locator(".report-card").count())) errors.push("career-post-match: post-match report card missing after commit");
  if (!(await page.locator(".report-card").getByText(/WP awarded/).count())) errors.push("career-post-match: report card lacks WP award row");
  if (!(await page.locator(".report-card").getByText(/Career Wrestler 10: 3 week layoff, eligible 1991-01-22/).count())) errors.push("career-post-match: report card lacks the deterministic d20-check injury row");
  if (!(await page.getByText(/Post-match sprain \(check 3\)/).count())) errors.push("career-post-match: deterministic seed-2000 sprain did not surface in the career ledger");
  // The campaign commit state hash is pinned: with M12 finance/negotiation and
  // M13 feuds enabled at setup (ledgers present) this career's seeded outcome
  // hashes to a fixed value, so a divergence means the career setup or match
  // flow changed.
  if (!(await page.getByText(/8e5e03653d6a40ed/).count())) errors.push("career-post-match: commit state hash diverged from the pinned seeded outcome (expected c14n-fnv1a64-v1:8e5e03653d6a40ed; page shows: " + ((await page.locator("body").innerText().catch(() => "")).match(/Canonical round trip: verified - c14n-fnv1a64-v1:[0-9a-f]{16}/)?.[0] ?? "no canonical line") + ")");
  await recordTimestampRows("ringcraft-career-post-match.png");
  await capture(page, "ringcraft-career-post-match.png");
}

currentProfile = "save-overwrite";
await page.setViewportSize({ width: 1440, height: 1100 });
if (!(await saveRow("Career QA checkpoint").getByText(/on 1991-01-01/).count())) errors.push("save-overwrite: pre-update snapshot did not retain its original campaign date");
await page.getByRole("button", { name: "Advance one day" }).click();
await page.waitForFunction(() => document.body.textContent?.includes("1991-01-02"));
await saveRow("Career QA checkpoint").getByRole("button", { name: "Update" }).click();
if (!(await page.getByRole("group", { name: "Overwrite preview" }).count())) errors.push("save-overwrite: diff preview missing before update");
if (!(await page.getByText(/Date: \d{4}-\d{2}-\d{2} -> \d{4}-\d{2}-\d{2}/).count())) errors.push("save-overwrite: diff summary missing the date change");
if (!(await page.getByText(/Record: \d+W\/\d+D\/\d+L/).count())) errors.push("save-overwrite: diff summary missing the record change");
if (!(await page.getByText(/new campaign event/).count())) errors.push("save-overwrite: diff summary missing the event delta");
// The overwrite preview also mirrors the restore direction for the same save.
if (!(await page.getByText(/^Updating this save records:$/).count())) errors.push("save-overwrite: preview missing the update section label");
if (!(await page.getByText(/^Restoring this save instead would change:$/).count())) errors.push("save-overwrite: preview missing the restore section label");
if (!(await page.getByText(/^Date: 1991-01-02 -> 1991-01-01$/).count())) errors.push("save-overwrite: preview missing the restore-direction date line");
if (!(await page.getByText(/^Restoring discards \d+ event/).count())) errors.push("save-overwrite: preview missing the restore discard warning");
if (!(await page.getByText(/roll forward again by restoring a newer snapshot or named save/).count())) errors.push("save-overwrite: preview missing the restore roll-forward hint");
if (!(await page.getByText(/^Current c14n-fnv1a64-v1:[0-9a-f]{16} -> stored c14n-fnv1a64-v1:[0-9a-f]{16}$/).count())) errors.push("save-overwrite: preview missing the current -> stored hash equation");
await page.getByRole("button", { name: "Confirm overwrite" }).click();
if (!(await page.getByText(/Updated "Career QA checkpoint" in place to 1991-01-02/).count())) errors.push("save-overwrite: in-place update confirmation message missing");
if ((await page.locator(".save-row").count()) !== 1) errors.push("save-overwrite: update-in-place created or removed a save row");
if (!(await saveRow("Career QA checkpoint").getByText(/on 1991-01-02/).count())) errors.push("save-overwrite: updated save preview did not reflect the advanced campaign date");
if (await saveRow("Career QA checkpoint").getByText(/on 1991-01-01/).count()) errors.push("save-overwrite: updated save preview retained the stale pre-advance date");
if (!(await page.getByText(/Updated "Career QA checkpoint" in place to 1991-01-02/).count())) errors.push("save-overwrite: in-place update confirmation message missing");
await recordTimestampRows("ringcraft-save-overwrite.png");
await capture(page, "ringcraft-save-overwrite.png");

currentProfile = "m10-difficulty-career";
await page.setViewportSize({ width: 1440, height: 1100 });
await page.evaluate(() => { for (const key of Object.keys(localStorage)) { if (key?.startsWith("asw91-project-ringcraft-autosave-v1")) localStorage.removeItem(key); } });
await page.reload({ waitUntil: "networkidle" });
await dismissTour();
const careerSetupReady = await openCareer({ selector: "select[aria-label='Career AI difficulty']", debug: true, label: "setup select" });
if (careerSetupReady) {
  await assertDifficultyHintWiring("m10-difficulty-career", "Career AI difficulty");
  await page.getByLabel("Career AI difficulty", { exact: true }).selectOption("veteran");
  if ((await page.getByLabel("Career AI difficulty", { exact: true }).inputValue()) !== "veteran") errors.push("m10-difficulty-career: setup select did not update");
  if (!(await page.locator(".difficulty-hint__row--active", { hasText: "Veteran" }).count())) errors.push("m10-difficulty-career: selected difficulty not highlighted in the hint panel");
  await startDeterministicQaCareer();
  await page.waitForFunction(() => document.body.textContent?.includes("Championships and obligations"));
  if (!(await page.getByText(/Opposition AI difficulty: veteran/).count())) errors.push("m10-difficulty-career: dashboard difficulty label missing");
  await recordTimestampRows("ringcraft-m10-difficulty-career.png");
  await capture(page, "ringcraft-m10-difficulty-career.png");
}

currentProfile = "tag-feud-career";
await page.setViewportSize({ width: 1440, height: 1100 });
await page.evaluate(() => { for (const key of Object.keys(localStorage)) { if (key?.startsWith("asw91-project-ringcraft-autosave-v1")) localStorage.removeItem(key); } });
await page.reload({ waitUntil: "networkidle" });
await dismissTour();
const tagFeudSetupReady = await openCareer({ selector: "select[aria-label='Career type']", label: "setup select" });
if (tagFeudSetupReady) {
  await page.getByLabel("Career type", { exact: true }).selectOption("tag");
  await ensureCareerOptionsOpen("Advanced / optional extensions");
  await page.getByLabel("Enable feuds and booking extension").check();
  await startDeterministicQaCareer();
  await page.waitForFunction(() => document.body.textContent?.includes("Championships and obligations"));
  await assertSurface("tag-feud-career", ".career-surface");
  // M13 tag-mode toggle: a tag career defaults the feud panel to tag mode, so
  // the entrant selects list only teams and a team feud starts from the
  // dashboard through the panel's own controls (no dice).
  if (!(await page.locator("select[aria-label='Feud entrant type']").count())) errors.push("tag-feud-career: feud entrant-type toggle missing");
  if ((await page.getByLabel("Feud entrant type", { exact: true }).inputValue()) !== "tag") errors.push("tag-feud-career: toggle did not default to tag mode for a tag career");
  const tagOptions = await page.getByLabel("Feud entrant one", { exact: true }).locator("option").allTextContents();
  if (!tagOptions.length || !tagOptions.every((text) => text.includes("Select") || text.includes("tag team"))) errors.push("tag-feud-career: tag-mode entrant list mixes singles options");
  // Feud the player's own team (Career Team 3, the QA player entrant) so the
  // month-end booking card carries the feud item for the tag career.
  await page.getByLabel("Feud entrant one", { exact: true }).selectOption({ index: 3 });
  await page.getByLabel("Feud entrant two", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Feud label").fill("QA team grudge");
  await page.getByRole("button", { name: "Start feud" }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("QA team grudge"));
  if (!(await page.locator(".status-pill--active").count())) errors.push("tag-feud-career: active feud status pill missing after starting a team feud");
  if (!(await page.getByText(/Career Team 3 vs Career Team 1/).count())) errors.push("tag-feud-career: team rivalry row missing the tag-team entrant labels");
  // M13 title-shot term surfacing: the player's feud rival (Career Team 1) is
  // the world-tag holder, so rolling the world-tag shot grants the player an
  // offer whose card must list the graded terms ("+2 feud heat 50 vs champion")
  // instead of a bare "modifiers" placeholder.
  await page.locator(".title-list > div").filter({ hasText: "World Tag" }).getByRole("button", { name: "Roll title shot" }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("earned a World Tag shot"));
  const worldTagShotCard = page.locator(".offer-card", { hasText: "earned a World Tag shot" }).first();
  if (!(await worldTagShotCard.getByText(/\+2 feud heat 50 vs champion/).count())) errors.push("tag-feud-career: title-shot card missing the feud heat term with its label");
  if ((await worldTagShotCard.textContent())?.includes("modifiers")) errors.push("tag-feud-career: title-shot card still shows the bare 'modifiers' placeholder");
  // The grant-event roll line must surface on the decisions card too, named by
  // the human label, so the panel and the event log stay visibly in sync (the
  // same core titleShotGrantLine helper feeds both).
  if (!(await worldTagShotCard.getByText(/Career Team 3 granted World Tag offer [a-z0-9-]+; roll 6 -3 same side \(tag\) \+2 feud heat 50 vs champion = 5\./).count())) errors.push("tag-feud-career: title-shot card missing the grant-event roll line (log/panel sync)");
  // M13 grant-event auditability: the roll-title-shot event itself must record
  // the same consolidated roll line before any accept/decline decision.
  if (!(await page.getByText(/career-team-3 granted World Tag offer [a-z0-9-]+; roll 6 -3 same side \(tag\) \+2 feud heat 50 vs champion = 5\./).count())) errors.push("tag-feud-career: grant event missing the consolidated roll breakdown in the log");
  // M13 title-shot auditability: declining the shot must record the same roll
  // breakdown in the event log so the feud term survives the decision.
  await worldTagShotCard.getByRole("button", { name: "Decline", exact: true }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("declined World Tag offer"));
  if (!(await page.getByText(/declined World Tag offer [a-z0-9-]+; roll 6 -3 same side \(tag\) \+2 feud heat 50 vs champion = 5 — candidate traversal may continue\./).count())) errors.push("tag-feud-career: title-shot roll breakdown missing from the event log after decline");
  // M13 month-end banner: the champion must defend in January to survive the
  // Feb 1 strip, so roll the world-tag shot again (the traversal now offers
  // career-team-2), accept it, and play the mandatory defense — the champion
  // retains and the booking card's feud line surfaces the same graded feud
  // title-shot term the decisions panel shows (heat 50 decays 5 to 45).
  await page.locator(".title-list > div").filter({ hasText: "World Tag" }).getByRole("button", { name: "Roll title shot" }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("earned a World Tag shot"));
  const secondShotCard = page.locator(".offer-card", { hasText: "earned a World Tag shot" }).first();
  if (!(await secondShotCard.getByText(/Career Team 2 earned a World Tag shot/).count())) errors.push("tag-feud-career: second traversal did not offer the world-tag shot to career-team-2");
  await secondShotCard.getByRole("button", { name: "Accept", exact: true }).click();
  // The mandatory defense is scheduled for tomorrow, so advance one day first
  // (the calendar blocks on the scheduled match once it is due, then the
  // dashboard offers "Play due match").
  await page.getByRole("button", { name: "Advance one day" }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("Play due match"));
  await page.getByRole("button", { name: "Play due match" }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("Career match in progress"));
  let defenseCommit = page.getByRole("button", { name: "Commit official result" });
  let defenseGuard = 0;
  while ((await defenseCommit.count()) === 0 && defenseGuard < 800) {
    const action = page.locator("button.action:visible").first();
    if (!(await action.count())) break;
    await action.click();
    defenseGuard += 1;
  }
  if ((await defenseCommit.count()) === 0) errors.push("tag-feud-career: world-tag defense did not reach a committable result");
  else {
    await defenseCommit.click();
    await page.waitForFunction(() => document.body.textContent?.includes("Championships and obligations"));
    if (!(await page.locator(".title-list > div").filter({ hasText: "World Tag" }).getByText(/Career Team 1/).count())) errors.push("tag-feud-career: champion did not retain the world-tag through the January defense");
    // Pin the seeded world-tag defense match replay identity: the latest
    // official result card must surface the exact final match hash, and the
    // committed match's stored replay must re-derive to the same identity
    // externally (mirroring the ruthless/tag exhibition replay pins) — so the
    // defense outcome is asserted deterministically, not just via the banner.
    if (!(await page.getByText(new RegExp(`replay ${WORLD_TAG_DEFENSE_REPLAY_HASH}`)).count())) errors.push("tag-feud-career: world-tag defense replay hash missing from the latest official result card");
    const defenseReplay = await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith("asw91-project-ringcraft-autosave-v1-")) continue;
        try {
          const snapshot = JSON.parse(localStorage.getItem(key));
          if (!snapshot?.campaignJson) continue;
          const campaign = JSON.parse(snapshot.campaignJson);
          const defense = campaign.schedule?.find((row) => row.status === "completed" && row.titleId === "world-tag" && row.result?.finalMatchHash);
          if (defense) return { replayConfig: defense.replayConfig, replayInputs: defense.replayInputs, finalMatchHash: defense.result.finalMatchHash };
        } catch { /* skip corrupt snapshots */ }
      }
      return null;
    });
    if (!defenseReplay) errors.push("tag-feud-career: could not read the committed world-tag defense replay from the autosave snapshot");
    else {
      const { replayFromInputLog: replayDefense } = await server.ssrLoadModule("/src/core/engine.ts");
      const { hashMatchState: hashDefense } = await server.ssrLoadModule("/src/core/hash.ts");
      const derivedDefenseHash = hashDefense(replayDefense({ config: defenseReplay.replayConfig, inputLog: defenseReplay.replayInputs }));
      if (derivedDefenseHash !== WORLD_TAG_DEFENSE_REPLAY_HASH) errors.push(`tag-feud-career: world-tag defense replay hash drifted to ${derivedDefenseHash} (pinned ${WORLD_TAG_DEFENSE_REPLAY_HASH})`);
      if (derivedDefenseHash !== defenseReplay.finalMatchHash) errors.push("tag-feud-career: externally replayed defense hash diverged from the committed finalMatchHash");
      console.log(`WORLD_TAG_DEFENSE_REPLAY_HASH=${derivedDefenseHash}`);
    }
    for (let day = 0; day < 30; day += 1) {
      await page.getByRole("button", { name: "Advance one day" }).click();
    }
    await page.waitForFunction(() => document.body.textContent?.includes("Booking card for 1991-02"));
    if (!(await page.getByText(/Booking card for 1991-02: feud vs Career Team 1 \(heat 45; title-shot \+2 feud heat 45 vs champion\); optional vs Career Team 2\./).count())) errors.push("tag-feud-career: month-end banner missing the feud title-shot term against the champion or the optional card item");
  }
  await recordTimestampRows("ringcraft-tag-feud-career.png");
  await capture(page, "ringcraft-tag-feud-career.png");
}

currentProfile = "rules-lab";
await gotoApp();
await page.getByLabel("Advanced exhibition options").click();
await page.getByLabel("Rules Lab").selectOption("critical-hold-100");
await page.getByRole("button", { name: "Start with manual seed" }).click();
const labBefore = await page.locator(".event-log li").count();
await page.getByRole("button", { name: "Step one transaction" }).click();
const labAfter = await page.locator(".event-log li").count();
if (labAfter !== labBefore + 1) errors.push(`rules-lab: expected one new event, saw ${labAfter - labBefore}`);
await capture(page, "ringcraft-rules-lab.png");

const stabilityErrors = await assertConsecutiveRunStability();
if (stabilityErrors.length) errors.push(...stabilityErrors);
await page.close();
await browser.close();
await server.close();
if (errors.length) throw new Error(`Visual QA failed:\n${errors.join("\n")}`);
console.log("Visual QA passed for exhibition, creator, progression, career setup/dashboard/match/recovery/post-match (seeded post-match injury), save-manager create/duplicate/rename/delete plus save-bundle export/import and update-in-place and restore-from-snapshot hash pin, M10 difficulty exhibition/career profiles (seeded ruthless replay pinned at c14n-fnv1a64-v1:03e0fea1cb9c5be1; seeded tag replay pinned at c14n-fnv1a64-v1:1b26c32a342f08c8), tour, help-toggle, rules-lab, narrow, accessibility, and M6/M7/M8 acceptance profiles.");
