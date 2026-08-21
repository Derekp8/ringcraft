import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("src/ui/App.tsx", "utf8");
const mainSource = readFileSync("src/main.tsx", "utf8");

describe("QA remediation: player UI ownership boundaries", () => {
  it("starts ordinary Exhibition through the fresh-random match boundary", () => {
    expect(appSource).toContain("function initialExhibitionMatch(): MatchState");
    expect(appSource).toContain("return createRandomMatch({");
    expect(appSource).toContain("useState(initialExhibitionMatch)");
    expect(appSource).not.toContain("useState(() => createMatch({ seed: 1991");
    expect(appSource).toContain("Start with manual seed");
  });

  it("owns Strict Manual inside Career React state rather than a DOM sidecar", () => {
    expect(appSource).toContain("const [strictManualSetup, setStrictManualSetup] = useState(true)");
    expect(appSource).toContain('aria-label="Strict Manual Mode"');
    expect(appSource).toContain("strictManualCampaignCompatibility(campaign)");
    expect(appSource).toContain("disabled={strictManualSetup}");
    expect(appSource).not.toContain("document.querySelectorAll");
    expect(appSource).not.toContain("setInterval(");
    expect(mainSource).not.toContain("M15StrictManualSurface");
    expect(existsSync("src/ui/m15-strict-manual-surface.tsx")).toBe(false);
  });

  it("applies the exact save-bundle plan that the player previewed", () => {
    expect(appSource).toContain("const plan = planSaveBundleImport(json)");
    expect(appSource).toContain("applySaveBundlePlan(pendingBundleImport.plan)");
    expect(appSource).not.toContain("importSaveBundle(pendingBundleImport.json)");
  });
});
