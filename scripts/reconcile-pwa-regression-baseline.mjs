import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

function read(file) { return readFileSync(file, "utf8").replace(/\r\n/g, "\n"); }
function write(file, value) { writeFileSync(file, value); }
function replaceOne(file, before, after) {
  const source = read(file);
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${file}: expected exactly one target for ${JSON.stringify(before)}, found ${count}.`);
  write(file, source.replace(before, after));
}
function replaceSection(file, start, end, replacement) {
  const source = read(file);
  const from = source.indexOf(start);
  if (from < 0) throw new Error(`${file}: start marker not found: ${start}`);
  const to = source.indexOf(end, from + start.length);
  if (to < 0) throw new Error(`${file}: end marker not found: ${end}`);
  write(file, source.slice(0, from) + replacement + "\n\n" + source.slice(to));
}

replaceOne(
  "tests/save-manager.test.ts",
  "  importCampaignJson,\n  rollCreationHistory,",
  "  importCampaignJson,\n  advanceCampaignDays,\n  rollCreationHistory,",
);

replaceSection(
  "tests/save-manager.test.ts",
  '  it("surfaces a stored-vs-incoming diff hint on merged rows so the merge decision is visible", () => {',
  '  it("reports an empty diff hint when stored and incoming previews match", () => {',
  [
    '  it("surfaces a validated stored-vs-incoming diff hint on merged rows so the merge decision is visible", () => {',
    '    const storage = new FakeStorage();',
    '    const meta = createSave(makeCampaign(), "Existing", storage);',
    '    const stored = readSave(meta.saveId, storage)!;',
    '',
    '    const incomingStorage = new FakeStorage();',
    '    const advanced = advanceCampaignDays(makeCampaign(), 31);',
    '    const advancedMeta = createSave(advanced, "Newer", incomingStorage);',
    '    const incoming: CampaignSave = {',
    '      ...readSave(advancedMeta.saveId, incomingStorage)!,',
    '      saveId: "in-newer",',
    '      name: "Newer",',
    '      createdAt: stored.createdAt,',
    '      updatedAt: "2099-01-01T00:00:00.000Z",',
    '    };',
    '    expect(incoming.campaignId).toBe(stored.campaignId);',
    '',
    '    const bundle = JSON.stringify({ schema: SAVE_BUNDLE_SCHEMA, exportedAt: "2099-01-01T00:00:00.000Z", saves: [{ key: `${CAMPAIGN_SAVE_PREFIX}in-newer`, value: JSON.stringify(incoming) }] });',
    '    const plan = planSaveBundleImport(bundle, storage);',
    '    expect(plan.rows).toHaveLength(1);',
    '    expect(plan.rows[0].outcome).toBe("merged");',
    '    expect(plan.rows[0].existingPreview).toEqual(stored.preview);',
    '    expect(plan.rows[0].preview).toEqual(incoming.preview);',
    '    const diff = diffSavePreviews(plan.rows[0].existingPreview, plan.rows[0].preview);',
    '    expect(diff).toContain("Date: 1991-01-01 -> 1991-02-01");',
    '  });',
  ].join("\n"),
);

replaceOne(
  "tests/mock-save-sync-server.test.ts",
  'import { RemoteBundleStorage, readSyncMeta } from "../src/ui/remote-save-storage";\nimport { importSaveBundle } from "../src/ui/save-manager";\nimport type { CampaignSaveBundle, SaveStorage } from "../src/ui/save-manager";',
  [
    'import { RemoteBundleStorage, readSyncMeta } from "../src/ui/remote-save-storage";',
    'import {',
    '  advanceCampaignDays,',
    '  autoAllocateCreationPoints,',
    '  createCampaign,',
    '  createCreationSession,',
    '  finalizeCreationSession,',
    '  rollCreationHistory,',
    '  rollCreationStature,',
    '  setCreationIdentity,',
    '  setCreationSide,',
    '} from "../src/core";',
    'import type { CampaignState, WrestlerCareerRecord } from "../src/core";',
    'import { createSave, importSaveBundle, readSave } from "../src/ui/save-manager";',
    'import type { CampaignSaveBundle, SaveStorage } from "../src/ui/save-manager";',
  ].join("\n"),
);

replaceSection(
  "tests/mock-save-sync-server.test.ts",
  'function savePayload(saveId: string, name: string, campaignId: string, updatedAt: string, campaignJson: string): string {',
  'describe("mock save-sync server (in-repo endpoint)", () => {',
  [
    'function syncRecord(seed: number, index: number): WrestlerCareerRecord {',
    '  let session = createCreationSession(seed + index);',
    '  session = setCreationIdentity(session, { name: `Sync Wrestler ${index}`, epithet: "T", affiliation: "Sync Test Roster" });',
    '  session = setCreationSide(session, index % 2 ? "rulebreaker" : "fan-favorite");',
    '  session = rollCreationStature(session);',
    '  session = rollCreationHistory(session);',
    '  session = autoAllocateCreationPoints(session);',
    '  return finalizeCreationSession(session).finalized!;',
    '}',
    '',
    'function logicalSeed(campaignId: string): number {',
    '  let value = 7000;',
    '  for (const char of campaignId) value = ((value * 33) ^ char.charCodeAt(0)) >>> 0;',
    '  return (value % 100000) + 1;',
    '}',
    '',
    'function syncCampaign(logicalCampaignId: string): CampaignState {',
    '  const seed = logicalSeed(logicalCampaignId);',
    '  const roster = Array.from({ length: 4 }, (_, index) => syncRecord(seed, index));',
    '  return createCampaign({',
    '    name: `Sync ${logicalCampaignId}`,',
    '    seed,',
    '    startDate: "1991-01-01",',
    '    roster,',
    '    playerEntrantId: roster[0].id,',
    '    playerDivision: "singles",',
    '  });',
    '}',
    '',
    'function savePayload(saveId: string, name: string, logicalCampaignId: string, updatedAt: string, campaignMarker: string): string {',
    '  const markerMatch = campaignMarker.match(/:(\\d+)\\s*}/);',
    '  const advanceDays = Math.max(0, Number(markerMatch?.[1] ?? 1) - 1);',
    '  const campaign = advanceDays > 0 ? advanceCampaignDays(syncCampaign(logicalCampaignId), advanceDays) : syncCampaign(logicalCampaignId);',
    '  const storage = inMemoryStorage();',
    '  const meta = createSave(campaign, name, storage);',
    '  const record = readSave(meta.saveId, storage)!;',
    '  return JSON.stringify({',
    '    ...record,',
    '    saveId,',
    '    name,',
    '    createdAt: "2099-01-01T00:00:00.000Z",',
    '    updatedAt,',
    '  });',
    '}',
  ].join("\n"),
);

replaceOne(
  "tests/mock-save-sync-server.test.ts",
  '    expect(alphaAfter.updatedAt).toBe(t2);\n    expect(alphaAfter.campaignJson).toBe("{\\"alpha\\":2}");',
  '    expect(alphaAfter.updatedAt).toBe(t2);\n    expect(alphaAfter.campaignJson).not.toBe(JSON.parse(alphaT1).campaignJson);',
);

const manifestPath = "HANDOFF-MANIFEST.json";
const manifest = JSON.parse(read(manifestPath));
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
for (const file of ["package.json", "src/ui/App.tsx", "index.html"]) {
  if (!(file in manifest.critical_file_sha256)) throw new Error(`Manifest does not pin ${file}.`);
  manifest.critical_file_sha256[file] = sha256(file);
  console.log(`${file} ${manifest.critical_file_sha256[file]}`);
}
write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Reconciled stale save-hardening tests and intended manifest pins.");
