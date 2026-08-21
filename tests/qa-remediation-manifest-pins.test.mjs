import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = join(process.cwd(), "scripts/check-manifest-pins.mjs");
const digest = (value) => createHash("sha256").update(value).digest("hex");

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: process.cwd(), encoding: "utf8" });
}

describe("QA remediation: manifest integrity domains", () => {
  it("verifies the repository against committed Git blob bytes", () => {
    const result = run(["--repository", "--root", process.cwd()]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("repository mode");
  });

  it("verifies extracted filesystem bytes without a .git database", () => {
    const root = mkdtempSync(join(tmpdir(), "ringcraft-manifest-filesystem-"));
    try {
      const bytes = "clean-room bytes\n";
      writeFileSync(join(root, "sample.txt"), bytes);
      writeFileSync(join(root, "HANDOFF-MANIFEST.json"), JSON.stringify({ critical_file_sha256: { "sample.txt": digest(bytes) } }));
      const result = run(["--filesystem", "--root", root]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("filesystem mode");
      expect(result.stdout).toContain("all 1 pinned files match");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when an extracted pinned file changes", () => {
    const root = mkdtempSync(join(tmpdir(), "ringcraft-manifest-mismatch-"));
    try {
      writeFileSync(join(root, "sample.txt"), "changed\n");
      writeFileSync(join(root, "HANDOFF-MANIFEST.json"), JSON.stringify({ critical_file_sha256: { "sample.txt": digest("expected\n") } }));
      const result = run(["--filesystem", "--root", root]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("filesystem");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
