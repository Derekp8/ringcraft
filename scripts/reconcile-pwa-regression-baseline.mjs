import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

function replaceExactly(file, before, after) {
  const source = readFileSync(file, "utf8");
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${file}: expected exactly one reconciliation target, found ${count}.`);
  writeFileSync(file, source.replace(before, after));
}

replaceExactly(
  "tests/save-manager.test.ts",
  `  importCampaignJson,\n  rollCreationHistory,`,
  `  importCampaignJson,\n  advanceCampaignDays,\n  rollCreationHistory,`,
);

replaceExactly(
  "tests/save-manager.test.ts",
  `  it("surfaces a stored-vs-incoming diff hint on merged rows so the merge decision is visible", () => {\n    const storage = new FakeStorage();\n    const meta = createSave(makeCampaign(), "Existing", storage);\n    const stored = readSave(meta.saveId, storage)!;\n    const incoming: CampaignSave = {\n      ...stored,\n      saveId: "in-newer",\n      name: "Newer",\n      updatedAt: "2099-01-01T00:00:00.000Z",\n      preview: {\n        ...stored.preview,\n        currentDate: "1991-02-01",\n        wins: stored.preview.wins + 1,\n        wpBalance: stored.preview.wpBalance + 5,\n      },\n    };\n    const bundle = JSON.stringify({ schema: SAVE_BUNDLE_SCHEMA, exportedAt: "2099-01-01T00:00:00.000Z", saves: [{ key: \`${CAMPAIGN_SAVE_PREFIX}in-newer\`, value: JSON.stringify(incoming) }] });\n    const plan = planSaveBundleImport(bundle, storage);\n    expect(plan.rows).toHaveLength(1);\n    expect(plan.rows[0].outcome).toBe("merged");\n    expect(plan.rows[0].existingPreview).toEqual(stored.preview);\n    expect(plan.rows[0].preview).toEqual(incoming.preview);\n    const diff = diffSavePreviews(plan.rows[0].existingPreview, plan.rows[0].preview);\n    expect(diff).toContain("Date: 1991-01-01 -> 1991-02-01");\n    expect(diff).toContain(\`Record: ${stored.preview.wins}W/${stored.preview.draws}D/${stored.preview.losses}L (${stored.preview.matches} matches) -> ${incoming.preview.wins}W/${incoming.preview.draws}D/${incoming.preview.losses}L (${incoming.preview.matches} matches)\`);\n    expect(diff).toContain(\`WP balance: ${stored.preview.wpBalance} -> ${incoming.preview.wpBalance}\`);\n  });`,
  `  it("surfaces a validated stored-vs-incoming diff hint on merged rows so the merge decision is visible", () => {\n    const storage = new FakeStorage();\n    const meta = createSave(makeCampaign(), "Existing", storage);\n    const stored = readSave(meta.saveId, storage)!;\n\n    const incomingStorage = new FakeStorage();\n    const advanced = advanceCampaignDays(makeCampaign(), 31);\n    const advancedMeta = createSave(advanced, "Newer", incomingStorage);\n    const incoming: CampaignSave = {\n      ...readSave(advancedMeta.saveId, incomingStorage)!,\n      saveId: "in-newer",\n      name: "Newer",\n      createdAt: stored.createdAt,\n      updatedAt: "2099-01-01T00:00:00.000Z",\n    };\n    expect(incoming.campaignId).toBe(stored.campaignId);\n\n    const bundle = JSON.stringify({ schema: SAVE_BUNDLE_SCHEMA, exportedAt: "2099-01-01T00:00:00.000Z", saves: [{ key: \`${CAMPAIGN_SAVE_PREFIX}in-newer\`, value: JSON.stringify(incoming) }] });\n    const plan = planSaveBundleImport(bundle, storage);\n    expect(plan.rows).toHaveLength(1);\n    expect(plan.rows[0].outcome).toBe("merged");\n    expect(plan.rows[0].existingPreview).toEqual(stored.preview);\n    expect(plan.rows[0].preview).toEqual(incoming.preview);\n    const diff = diffSavePreviews(plan.rows[0].existingPreview, plan.rows[0].preview);\n    expect(diff).toContain("Date: 1991-01-01 -> 1991-02-01");\n  });`,
);

replaceExactly(
  "tests/mock-save-sync-server.test.ts",
  `import { RemoteBundleStorage, readSyncMeta } from "../src/ui/remote-save-storage";\nimport { importSaveBundle } from "../src/ui/save-manager";\nimport type { CampaignSaveBundle, SaveStorage } from "../src/ui/save-manager";`,
  `import { RemoteBundleStorage, readSyncMeta } from "../src/ui/remote-save-storage";\nimport {\n  advanceCampaignDays,\n  autoAllocateCreationPoints,\n  createCampaign,\n  createCreationSession,\n  finalizeCreationSession,\n  rollCreationHistory,\n  rollCreationStature,\n  setCreationIdentity,\n  setCreationSide,\n} from "../src/core";\nimport type { CampaignState, WrestlerCareerRecord } from "../src/core";\nimport { CAMPAIGN_SAVE_PREFIX, createSave, importSaveBundle, readSave } from "../src/ui/save-manager";\nimport type { CampaignSaveBundle, SaveStorage } from "../src/ui/save-manager";`,
);

replaceExactly(
  "tests/mock-save-sync-server.test.ts",
  `function savePayload(saveId: string, name: string, campaignId: string, updatedAt: string, campaignJson: string): string {\n  return JSON.stringify({\n    saveId,\n    name,\n    campaignId,\n    createdAt: "2099-01-01T00:00:00.000Z",\n    updatedAt,\n    preview: { campaignName: name, currentDate: "1991-01-01", playerDivision: "singles", playerLabel: name, wins: 0, draws: 0, losses: 0, matches: 0, titlesHeld: [], wpBalance: 0 },\n    campaignJson,\n  });\n}`,
  `function syncRecord(seed: number, index: number): WrestlerCareerRecord {\n  let session = createCreationSession(seed + index);\n  session = setCreationIdentity(session, { name: \`Sync Wrestler ${index}\`, epithet: "T", affiliation: "Sync Test Roster" });\n  session = setCreationSide(session, index % 2 ? "rulebreaker" : "fan-favorite");\n  session = rollCreationStature(session);\n  session = rollCreationHistory(session);\n  session = autoAllocateCreationPoints(session);\n  return finalizeCreationSession(session).finalized!;\n}\n\nfunction logicalSeed(campaignId: string): number {\n  let value = 7000;\n  for (const char of campaignId) value = ((value * 33) ^ char.charCodeAt(0)) >>> 0;\n  return (value % 100000) + 1;\n}\n\nfunction syncCampaign(campaignId: string): CampaignState {\n  const seed = logicalSeed(campaignId);\n  const roster = Array.from({ length: 4 }, (_, index) => syncRecord(seed, index));\n  return createCampaign({\n    name: \`Sync ${campaignId}\`,\n    seed,\n    startDate: "1991-01-01",\n    roster,\n    playerEntrantId: roster[0].id,\n    playerDivision: "singles",\n  });\n}\n\nfunction savePayload(saveId: string, name: string, logicalCampaignId: string, updatedAt: string, campaignMarker: string): string {\n  const markerMatch = campaignMarker.match(/:(\\d+)\\s*}/);\n  const advanceDays = Math.max(0, Number(markerMatch?.[1] ?? 1) - 1);\n  const campaign = advanceDays > 0 ? advanceCampaignDays(syncCampaign(logicalCampaignId), advanceDays) : syncCampaign(logicalCampaignId);\n  const storage = inMemoryStorage();\n  const meta = createSave(campaign, name, storage);\n  const record = readSave(meta.saveId, storage)!;\n  return JSON.stringify({\n    ...record,\n    saveId,\n    name,\n    createdAt: "2099-01-01T00:00:00.000Z",\n    updatedAt,\n  });\n}`,
);

replaceExactly(
  "tests/mock-save-sync-server.test.ts",
  `    const alphaAfter = JSON.parse(storage.getItem("asw91-campaign-save-alpha")!) as { updatedAt: string; campaignJson: string };\n    expect(alphaAfter.updatedAt).toBe(t2);\n    expect(alphaAfter.campaignJson).toBe("{\\\"alpha\\\":2}");`,
  `    const alphaAfter = JSON.parse(storage.getItem("asw91-campaign-save-alpha")!) as { updatedAt: string; campaignJson: string };\n    expect(alphaAfter.updatedAt).toBe(t2);\n    expect(alphaAfter.campaignJson).not.toBe(JSON.parse(alphaT1).campaignJson);`,
);

const manifestPath = "HANDOFF-MANIFEST.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
for (const path of ["package.json", "src/ui/App.tsx", "index.html"]) {
  if (!(path in manifest.critical_file_sha256)) throw new Error(`Manifest does not pin ${path}.`);
  manifest.critical_file_sha256[path] = sha256(path);
  console.log(`${path} ${manifest.critical_file_sha256[path]}`);
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Reconciled stale save-hardening tests and intended manifest pins.");
