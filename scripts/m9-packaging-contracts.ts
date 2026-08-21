export const M9_ARCHIVE_NAME = "asw91-project-ringcraft-m9-private-handoff-1.2.0.zip";

export const M9_REQUIRED_ROOTS = ["src", "tests", "scripts", "fixtures/m5", "fixtures/m10", "fixtures/m11", "fixtures/saves", "fixtures/replays", "docs"] as const;
export const M9_REQUIRED_FILES = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "vitest.config.ts",
  "index.html",
  ".gitignore",
  "README.md",
  "FREEBUFF-HANDOFF.md",
  "HANDOFF-MANIFEST.json",
  "docs/m9-handoff-evidence.md",
] as const;

/**
 * Every tracked, byte-identical review screenshot. The visual QA gate reproduces
 * all 22 captures byte-for-byte (frozen clock + pixel-stability baseline), and
 * each one is pinned in the manifest's `critical_file_sha256` so the clean-room
 * verifier hashes the archive's embedded bytes against the pin — a change to any
 * committed capture fails the gate, not just the run-to-run stability check.
 */
export const M9_REVIEWED_SCREENSHOTS = [
  "output/qa/ringcraft-accessibility.png",
  "output/qa/ringcraft-career-desktop.png",
  "output/qa/ringcraft-career-match.png",
  "output/qa/ringcraft-career-narrow.png",
  "output/qa/ringcraft-career-post-match.png",
  "output/qa/ringcraft-career-recovery.png",
  "output/qa/ringcraft-career-setup.png",
  "output/qa/ringcraft-created-exhibition.png",
  "output/qa/ringcraft-creator-desktop.png",
  "output/qa/ringcraft-creator-narrow.png",
  "output/qa/ringcraft-creator-validation.png",
  "output/qa/ringcraft-help-toggle.png",
  "output/qa/ringcraft-m10-difficulty-career.png",
  "output/qa/ringcraft-m10-difficulty-exhibition.png",
  "output/qa/ringcraft-progression.png",
  "output/qa/ringcraft-rules-lab.png",
  "output/qa/ringcraft-save-overwrite.png",
  "output/qa/ringcraft-singles-desktop.png",
  "output/qa/ringcraft-tag-desktop.png",
  "output/qa/ringcraft-tag-feud-career.png",
  "output/qa/ringcraft-tag-narrow.png",
  "output/qa/ringcraft-tour.png",
] as const;

export const M9_EXCLUDED_PREFIXES = [
  "node_modules/",
  "dist/",
  ".freebuff/",
  "output/qa/browser-cache/",
  "output/qa/browser-runtime/",
  "output/m9/",
] as const;

export function normalizeM9Path(value: string): string {
  const parts: string[] = [];
  for (const part of value.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length) parts.pop();
      else parts.push("..");
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

export function isAllowedM9Path(value: string): boolean {
  const raw = value.replaceAll("\\", "/");
  if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw) || raw.split("/").includes("..")) return false;
  const path = normalizeM9Path(value);
  const basename = path.split("/").at(-1) ?? "";
  if (!path || path.startsWith("../") || path.includes("/../") || basename.startsWith(".env") || /(?:~|\.bak|\.tmp|\.lock|\.log|\.db(?:-shm|-wal)?|\.sqlite(?:3)?)$/.test(path)) return false;
  if (M9_EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  if (M9_REQUIRED_FILES.includes(path as (typeof M9_REQUIRED_FILES)[number])) return true;
  if (M9_REVIEWED_SCREENSHOTS.includes(path as (typeof M9_REVIEWED_SCREENSHOTS)[number])) return true;
  return M9_REQUIRED_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}
