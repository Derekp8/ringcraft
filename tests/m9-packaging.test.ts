import { describe, expect, it } from "vitest";
import {
  M9_ARCHIVE_NAME,
  M9_EXCLUDED_PREFIXES,
  M9_REQUIRED_FILES,
  M9_REQUIRED_ROOTS,
  isAllowedM9Path,
  normalizeM9Path,
} from "../scripts/m9-packaging-contracts";

describe("M9 private handoff packaging contracts", () => {
  it("uses the approved archive identity and required roots", () => {
    expect(M9_ARCHIVE_NAME).toBe("asw91-project-ringcraft-m9-private-handoff-1.2.0.zip");
    expect(M9_REQUIRED_ROOTS).toEqual(["src", "tests", "scripts", "fixtures/m5", "fixtures/m10", "fixtures/m11", "fixtures/m13", "fixtures/saves", "fixtures/replays", "docs"]);
    expect(M9_REQUIRED_FILES).toEqual(expect.arrayContaining(["package.json", "package-lock.json", "README.md", "FREEBUFF-HANDOFF.md", "HANDOFF-MANIFEST.json", "vitest.config.ts"]));
  });

  it("normalizes archive paths to stable forward-slash names", () => {
    expect(normalizeM9Path("src\\ui\\App.tsx")).toBe("src/ui/App.tsx");
    expect(normalizeM9Path("./docs/../README.md")).toBe("README.md");
    expect(normalizeM9Path("output/qa/./ringcraft-tour.png")).toBe("output/qa/ringcraft-tour.png");
  });

  it("allows only approved source, evidence, and reviewed screenshot paths", () => {
    expect(isAllowedM9Path("src/ui/App.tsx")).toBe(true);
    expect(isAllowedM9Path("tests/m9-packaging.test.ts")).toBe(true);
    expect(isAllowedM9Path("docs/m9-handoff-evidence.md")).toBe(true);
    expect(isAllowedM9Path("output/qa/ringcraft-tour.png")).toBe(true);
    expect(isAllowedM9Path("output/qa/ringcraft-unreviewed.png")).toBe(false);
  });

  it("rejects local state, dependencies, builds, runtimes, and temporary files", () => {
    for (const prefix of M9_EXCLUDED_PREFIXES) {
      expect(isAllowedM9Path(`${prefix}sample.bin`)).toBe(false);
    }
    expect(isAllowedM9Path("node_modules/react/index.js")).toBe(false);
    expect(isAllowedM9Path("dist/assets/index.js")).toBe(false);
    expect(isAllowedM9Path(".freebuff/desktop-v2.db")).toBe(false);
    expect(isAllowedM9Path("output/qa/browser-runtime/chromium")).toBe(false);
    expect(isAllowedM9Path("README.md~")).toBe(false);
    expect(isAllowedM9Path("src/../README.md")).toBe(false);
    expect(isAllowedM9Path("docs/debug.log")).toBe(false);
    expect(isAllowedM9Path("src/.env")).toBe(false);
  });
});
