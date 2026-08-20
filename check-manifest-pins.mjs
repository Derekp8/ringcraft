import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Verifies every `critical_file_sha256` pin in HANDOFF-MANIFEST.json against
 * the committed git blob (LF representation) of the pinned path.
 *
 * Pins are the SHA-256 of the file's canonical bytes as committed to git — the
 * LF representation the clean-room export produces. A pin computed from any
 * other representation (e.g. a CRLF working-tree checkout on Windows) is a
 * "mixed-representation" pin: it matches the on-disk file but fails the
 * clean-room `npm run check`'s 45/45 pin verification. This check compares
 * against the blobs directly, so it is independent of the checkout's line
 * endings and fails the moment any pin drifts from the committed representation.
 *
 * Run from the repository root: `node scripts/check-manifest-pins.mjs`.
 * Exits 0 only when every pinned path is tracked in HEAD and its pin equals
 * the sha256 of its HEAD blob.
 */
const manifest = JSON.parse(readFileSync("HANDOFF-MANIFEST.json", "utf8"));
const pins = manifest.critical_file_sha256 ?? {};
const entries = Object.entries(pins);
if (entries.length === 0) {
  console.error("check-manifest-pins: no critical_file_sha256 pins found in HANDOFF-MANIFEST.json.");
  process.exit(1);
}

// `git ls-tree -r HEAD` prints paths relative to the current directory, which
// matches the manifest's repository-relative keys when run from the project
// root (the only supported cwd, locally and in CI).
const tree = execFileSync("git", ["ls-tree", "-r", "HEAD"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const blobByPath = new Map();
for (const line of tree.split("\n")) {
  const match = line.match(/^[0-9]+ blob ([0-9a-f]{40})\t(.*)$/);
  if (match) blobByPath.set(match[2], match[1]);
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
let matched = 0;
const failures = [];
for (const [path, expected] of entries) {
  const blobSha = blobByPath.get(path);
  if (!blobSha) {
    failures.push(`${path}: not tracked in HEAD — a pinned path must exist as a committed blob to verify its LF representation`);
    continue;
  }
  const blob = execFileSync("git", ["cat-file", "blob", blobSha], { encoding: null, maxBuffer: 256 * 1024 * 1024 });
  const actual = sha256(blob);
  if (actual === expected) {
    matched += 1;
  } else {
    failures.push(`${path}: pin ${expected.slice(0, 12)}… ≠ LF-blob ${actual.slice(0, 12)}… (mixed-representation or stale pin — refresh from the git blob, not the working tree)`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`check-manifest-pins: ${matched}/${entries.length} pins match their LF blobs; ${failures.length} drifted.`);
  process.exit(1);
}
console.log(`check-manifest-pins: OK — all ${matched} pinned files match their LF git-blob sha256.`);
