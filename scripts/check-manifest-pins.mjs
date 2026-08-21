import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * Verify HANDOFF-MANIFEST critical-file SHA-256 pins in one of two explicit
 * integrity domains:
 *
 *   repository (default) — compare against committed Git blob bytes. This is
 *   line-ending independent and remains the authoritative checkout check.
 *
 *   filesystem — compare against the bytes actually present under --root.
 *   This is the authoritative clean-room/archive check and deliberately does
 *   not require a .git database in the extracted package.
 *
 * Usage:
 *   node scripts/check-manifest-pins.mjs --repository
 *   node scripts/check-manifest-pins.mjs --filesystem [--root /path/to/root]
 */
const args = process.argv.slice(2);
const requestedRepository = args.includes("--repository");
const requestedFilesystem = args.includes("--filesystem");
if (requestedRepository && requestedFilesystem) throw new Error("Choose exactly one manifest verification mode.");
const mode = requestedFilesystem ? "filesystem" : "repository";
const rootIndex = args.indexOf("--root");
if (rootIndex >= 0 && !args[rootIndex + 1]) throw new Error("--root requires a directory path.");
const root = resolve(rootIndex >= 0 ? args[rootIndex + 1] : process.cwd());
const manifestPath = resolve(root, "HANDOFF-MANIFEST.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const pins = manifest.critical_file_sha256 ?? {};
const entries = Object.entries(pins);
if (entries.length === 0) {
  console.error("check-manifest-pins: no critical_file_sha256 pins found in HANDOFF-MANIFEST.json.");
  process.exit(1);
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const failures = [];
let matched = 0;

function safeFilesystemPath(path) {
  if (isAbsolute(path)) throw new Error(`Pinned path must be repository-relative: ${path}`);
  const candidate = resolve(root, path);
  const rel = relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    throw new Error(`Pinned path escapes verification root: ${path}`);
  }
  return candidate;
}

if (mode === "repository") {
  if (!existsSync(resolve(root, ".git"))) {
    console.error(`check-manifest-pins: repository mode requires .git at ${root}. Use --filesystem for an extracted clean-room archive.`);
    process.exit(1);
  }
  const tree = execFileSync("git", ["-C", root, "ls-tree", "-r", "HEAD"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const blobByPath = new Map();
  for (const line of tree.split("\n")) {
    const match = line.match(/^[0-9]+ blob ([0-9a-f]{40})\t(.*)$/);
    if (match) blobByPath.set(match[2], match[1]);
  }
  for (const [path, expected] of entries) {
    const blobSha = blobByPath.get(path);
    if (!blobSha) {
      failures.push(`${path}: not tracked in HEAD — a repository pin must resolve to a committed blob`);
      continue;
    }
    const blob = execFileSync("git", ["-C", root, "cat-file", "blob", blobSha], { encoding: null, maxBuffer: 256 * 1024 * 1024 });
    const actual = sha256(blob);
    if (actual === expected) matched += 1;
    else failures.push(`${path}: pin ${String(expected).slice(0, 12)}… ≠ LF-blob ${actual.slice(0, 12)}…`);
  }
} else {
  for (const [path, expected] of entries) {
    let filePath;
    try { filePath = safeFilesystemPath(path); }
    catch (error) { failures.push(String(error)); continue; }
    if (!existsSync(filePath)) {
      failures.push(`${path}: missing from extracted filesystem`);
      continue;
    }
    const actual = sha256(readFileSync(filePath));
    if (actual === expected) matched += 1;
    else failures.push(`${path}: pin ${String(expected).slice(0, 12)}… ≠ filesystem ${actual.slice(0, 12)}…`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`check-manifest-pins: ${matched}/${entries.length} pins match in ${mode} mode; ${failures.length} failed.`);
  process.exit(1);
}
console.log(`check-manifest-pins: OK — all ${matched} pinned files match in ${mode} mode.`);
