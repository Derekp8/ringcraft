import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { M9_ARCHIVE_NAME, M9_EXCLUDED_PREFIXES, M9_REQUIRED_FILES, M9_REQUIRED_ROOTS, M9_REVIEWED_SCREENSHOTS, isAllowedM9Path, normalizeM9Path } from "./m9-packaging-contracts";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const archivePath = resolve(process.argv[2] ?? join(projectRoot, "output", "m9", M9_ARCHIVE_NAME));
const evidenceDirectory = join(projectRoot, "output", "m9");
await mkdir(evidenceDirectory, { recursive: true });
let extraction = "";
const results: Array<Record<string, unknown>> = [];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
/** The four difficulty rungs of the AI ladder, weakest to strongest — pinned by the M11 playtest deterministic evidence. */
const LADDER_DIFFICULTY_ORDER = ["novice", "standard", "veteran", "ruthless"] as const;

function crc32(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

async function readZipEntries(data: Buffer): Promise<Array<{ name: string; bytes: Buffer }>> {
  const endOffset = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) throw new Error("M9 archive has no ZIP end record.");
  const count = data.readUInt16LE(endOffset + 10);
  const centralOffset = data.readUInt32LE(endOffset + 16);
  const entries: Array<{ name: string; bytes: Buffer }> = [];
  const names = new Set<string>();
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > data.length) throw new Error("M9 archive central directory is truncated.");
    if (data.readUInt32LE(cursor) !== 0x02014b50) throw new Error("M9 archive has an invalid central-directory entry.");
    const method = data.readUInt16LE(cursor + 10);
    const expectedCrc = data.readUInt32LE(cursor + 16);
    const compressedSize = data.readUInt32LE(cursor + 20);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const localOffset = data.readUInt32LE(cursor + 42);
    const name = data.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (cursor + 46 + nameLength + extraLength + commentLength > data.length) throw new Error(`M9 archive central entry is truncated: ${name}`);
    if (method !== 0) throw new Error(`M9 archive entry is not store-only: ${name}`);
    if (!isAllowedM9Path(name)) throw new Error(`M9 archive contains excluded path: ${name}`);
    const normalizedName = normalizeM9Path(name);
    if (names.has(normalizedName)) throw new Error(`M9 archive contains duplicate path: ${normalizedName}`);
    names.add(normalizedName);
    if (localOffset + 30 > data.length || data.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`M9 archive has an invalid local entry: ${name}`);
    const localNameLength = data.readUInt16LE(localOffset + 26);
    const localExtraLength = data.readUInt16LE(localOffset + 28);
    const localName = data.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8");
    if (localName !== name) throw new Error(`M9 archive local/central names differ: ${name}`);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    if (start + compressedSize > data.length) throw new Error(`M9 archive local entry is truncated: ${name}`);
    const bytes = data.subarray(start, start + compressedSize);
    if (crc32(bytes) !== expectedCrc) throw new Error(`M9 archive CRC mismatch: ${name}`);
    entries.push({ name: normalizedName, bytes });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Parses the first JSON object in `text` that contains `marker` (verbatim), or null. */
function extractJsonContaining(text: string, marker: string): Record<string, unknown> | null {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.lastIndexOf("{", markerIndex);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function assertCompleteArchive(entries: Array<{ name: string; bytes: Buffer }>): void {
  const names = new Set(entries.map((entry) => entry.name));
  for (const file of M9_REQUIRED_FILES) if (!names.has(file)) throw new Error(`M9 archive is missing required file: ${file}`);
  for (const root of M9_REQUIRED_ROOTS) if (![...names].some((name) => name === root || name.startsWith(`${root}/`))) throw new Error(`M9 archive is missing required root: ${root}`);
  for (const screenshot of M9_REVIEWED_SCREENSHOTS) if (!names.has(screenshot)) throw new Error(`M9 archive is missing reviewed evidence: ${screenshot}`);
}

async function importArchive(path: string, baseDirectory: string): Promise<string> {
  const data = await readFile(path);
  const { mkdtemp } = await import("node:fs/promises");
  const directory = await mkdtemp(join(baseDirectory, "clean-room-"));
  try {
    const entries = await readZipEntries(data);
    assertCompleteArchive(entries);
    for (const entry of entries) {
      const destination = join(directory, entry.name);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, entry.bytes);
    }
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function run(command: string, args: string[]): Promise<Record<string, unknown>> {
  const started = Date.now();
  try {
    const directNode = process.platform === "win32" && command.toLowerCase().endsWith("node.exe");
    const executable = process.platform === "win32" && !directNode ? process.env.ComSpec ?? "cmd.exe" : command;
    const executableArgs = process.platform === "win32" && !directNode ? ["/d", "/s", "/c", `${command} ${args.join(" ")}`] : args;
    const result = await execFileAsync(executable, executableArgs, { cwd: extraction, maxBuffer: 8 * 1024 * 1024 });
    const record = { command: [command, ...args].join(" "), exitCode: 0, durationMs: Date.now() - started, stdout: result.stdout.slice(-24000), stderr: result.stderr.slice(-24000) };
    results.push(record);
    return record;
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    results.push({ command: [command, ...args].join(" "), exitCode: failure.code ?? 1, durationMs: Date.now() - started, stdout: failure.stdout?.slice(-24000), stderr: failure.stderr?.slice(-24000), error: failure.message });
    throw error;
  }
}

async function assertManifestHashes(directory: string): Promise<Record<string, unknown>> {
  const manifest = JSON.parse(await readFile(join(directory, "HANDOFF-MANIFEST.json"), "utf8")) as {
    critical_file_sha256?: Record<string, string>;
    deterministic_evidence?: Record<string, string>;
  };
  for (const [path, expected] of Object.entries(manifest.critical_file_sha256 ?? {})) {
    const actual = createHash("sha256").update(await readFile(join(directory, path))).digest("hex");
    if (actual !== expected) throw new Error(`M9 manifest hash mismatch for ${path}: expected ${expected}, got ${actual}`);
  }
  return manifest as Record<string, unknown>;
}

let failure: unknown = null;
try {
  if (basename(archivePath) !== M9_ARCHIVE_NAME) throw new Error(`Expected ${M9_ARCHIVE_NAME}, received ${basename(archivePath)}.`);
  extraction = await importArchive(archivePath, evidenceDirectory);
  await stat(join(extraction, "package.json"));
  const manifest = await assertManifestHashes(extraction);
  const lockBefore = createHash("sha256").update(await readFile(join(extraction, "package-lock.json"))).digest("hex");
  await run(npmCommand, ["ci"]);
  await run(npmCommand, ["run", "check"]);
  const fixtureResult = await run(npmCommand, ["run", "fixtures:verify"]);
  const evidence = (manifest.deterministic_evidence ?? {}) as Record<string, string>;
  for (const key of ["fixture_completed_campaign_hash", "fixture_completed_match_hash", "fixture_recovered_final_campaign_hash", "fixture_ruthless_campaign_final_hash"]) {
    if (evidence[key] && !fixtureResult.stdout.includes(evidence[key])) throw new Error(`Fixture verification output did not contain manifest evidence ${key}: ${evidence[key]}`);
  }
  // The M10 corpus verifier must report its per-decision hash column and
  // final-state-hash coverage explicitly: every decision carries a hash column
  // and every run replays its terminal finalStateHash. The manifest pins those
  // counts as deterministic evidence, and the corpus verifier's JSON is parsed
  // (not just grepped) so a wrong count can never pass a substring match.
  const corpusJson = extractJsonContaining(fixtureResult.stdout, '"schema": "m10-ai-decision-log-v1"');
  if (!corpusJson) throw new Error("fixtures:verify output did not contain the M10 corpus verifier result.");
  for (const [key, field] of [["m10_corpus_hash_column_checked", "hashColumnChecked"], ["m10_corpus_final_state_hashes_replayed", "finalStateHashesReplayed"]] as const) {
    if (evidence[key] && corpusJson[field] !== Number(evidence[key])) {
      throw new Error(`M10 corpus ${field} does not match manifest evidence ${key}: expected ${evidence[key]}, got ${corpusJson[field]}`);
    }
  }
  // The M11 playtest verifier re-derives per-difficulty AI win shares from the
  // pinned batches. The manifest pins each value as deterministic evidence, and
  // each exact observed value is pinned. This aggregate report is measurement,
  // not a monotonic balance contract; ladder policy separation is covered by
  // the dedicated seeded-window tests.
  const playtestJson = extractJsonContaining(fixtureResult.stdout, '"schema": "asw91-playtest-balance-report-v1"');
  if (!playtestJson) throw new Error("fixtures:verify output did not contain the M11 playtest verifier result.");
  const ladderWinShares = (playtestJson.ladderWinShares ?? (playtestJson.analytics as { winShare?: { byDifficulty?: Record<string, number> } } | undefined)?.winShare?.byDifficulty) as Record<string, number> | undefined;
  if (!ladderWinShares || !LADDER_DIFFICULTY_ORDER.every((difficulty) => typeof ladderWinShares[difficulty] === "number")) {
    throw new Error("M11 playtest verifier did not report per-difficulty win shares.");
  }
  for (const difficulty of LADDER_DIFFICULTY_ORDER) {
    const key = `m11_playtest_win_share_${difficulty}`;
    if (evidence[key] && ladderWinShares[difficulty] !== Number(evidence[key])) {
      throw new Error(`M11 playtest win share ${difficulty} does not match manifest evidence ${key}: expected ${evidence[key]}, got ${ladderWinShares[difficulty]}`);
    }
  }
  // The M11 playtest report's own reportHash is re-derived by the verifier from
  // the pinned batches; the manifest pins it as deterministic evidence and the
  // gate compares the parsed JSON field numerically, so a wrong report identity
  // (even with matching win shares) fails the check.
  if (evidence["m11_playtest_report_hash"] && playtestJson.reportHash !== evidence["m11_playtest_report_hash"]) {
    throw new Error(`M11 playtest reportHash does not match manifest evidence m11_playtest_report_hash: expected ${evidence["m11_playtest_report_hash"]}, got ${playtestJson.reportHash}`);
  }
  // The save-manager determinism fixture's fixtureHash is re-derived by its
  // verifier from the pinned scenario inputs (bundle-merge rule, autosave ring
  // incl. the retention-cap prune leg, and the remote-sync arc incl. each
  // step's SyncResult.message and the persisted SyncMeta baseline). The manifest
  // pins it as deterministic evidence and the gate parses the verifier's JSON
  // (not a substring match), so a change to the merge rule, ring retention,
  // remote revision/fingerprint logic, campaign hashing, or payload
  // serialization fails the clean-room gate with the pinned-vs-actual hash.
  const saveDeterminismJson = extractJsonContaining(fixtureResult.stdout, '"schema": "asw91-save-determinism-fixture-v1"');
  if (!saveDeterminismJson) throw new Error("fixtures:verify output did not contain the save-determinism verifier result.");
  if (evidence["save_determinism_fixture_hash"] && saveDeterminismJson.fixtureHash !== evidence["save_determinism_fixture_hash"]) {
    throw new Error(`save-determinism fixtureHash does not match manifest evidence save_determinism_fixture_hash: expected ${evidence["save_determinism_fixture_hash"]}, got ${saveDeterminismJson.fixtureHash}`);
  }
  // The M13 title-shot chain verifier re-derives the grant → decline / grant →
  // accept event chains from the pinned derivation and reports its fixtureHash;
  // the manifest pins it as deterministic evidence and the gate compares the
  // parsed JSON field, so a change to the offer id derivation, the feud term,
  // the roll breakdown, or the scheduling rule fails the clean-room gate.
  const titleShotChainJson = extractJsonContaining(fixtureResult.stdout, '"schema": "m13-title-shot-chain-v1"');
  if (!titleShotChainJson) throw new Error("fixtures:verify output did not contain the title-shot chain verifier result.");
  if (evidence["m13_title_shot_chain_fixture_hash"] && titleShotChainJson.fixtureHash !== evidence["m13_title_shot_chain_fixture_hash"]) {
    throw new Error(`title-shot chain fixtureHash does not match manifest evidence m13_title_shot_chain_fixture_hash: expected ${evidence["m13_title_shot_chain_fixture_hash"]}, got ${titleShotChainJson.fixtureHash}`);
  }
  // The M13 feud-heat chain verifier re-derives the start-feud → committed
  // feud match → monthly decay chain from the pinned derivation and reports its
  // fixtureHash; the manifest pins it as deterministic evidence and the gate
  // compares the parsed JSON field, so a change to the heat tables, the decay
  // rule, the match engine outcome, or the campaign hashing fails the gate.
  // Gated on the evidence pin: archives built before this fixture existed carry
  // no pin and their fixtures:verify output has no feud-heat chain result, so
  // the check only runs when the archive's own manifest declares the evidence.
  const feudHeatChainJson = evidence["m13_feud_heat_chain_fixture_hash"] ? extractJsonContaining(fixtureResult.stdout, '"schema": "m13-feud-heat-chain-v1"') : null;
  if (evidence["m13_feud_heat_chain_fixture_hash"] && !feudHeatChainJson) throw new Error("fixtures:verify output did not contain the feud-heat chain verifier result.");
  if (feudHeatChainJson && feudHeatChainJson.fixtureHash !== evidence["m13_feud_heat_chain_fixture_hash"]) {
    throw new Error(`feud-heat chain fixtureHash does not match manifest evidence m13_feud_heat_chain_fixture_hash: expected ${evidence["m13_feud_heat_chain_fixture_hash"]}, got ${feudHeatChainJson.fixtureHash}`);
  }
  await run(process.execPath, ["scripts/visual-qa.mjs"]);
  const lockAfter = createHash("sha256").update(await readFile(join(extraction, "package-lock.json"))).digest("hex");
  if (lockBefore !== lockAfter) throw new Error("Clean-room verification modified package-lock.json.");
} catch (error) {
  failure = error;
}
const report = {
  archiveName: M9_ARCHIVE_NAME,
  archiveSha256: createHash("sha256").update(await readFile(archivePath)).digest("hex"),
  verified: !failure,
  browserTarget: process.platform === "linux" ? "linux-portable-chromium" : "windows-edge-fallback",
  canonicalLinuxBrowserVerified: process.platform === "linux" && !failure,
  error: failure ? String(failure) : undefined,
  excludedPrefixes: [...M9_EXCLUDED_PREFIXES],
  results,
};
await writeFile(join(evidenceDirectory, "m9-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (extraction) await rm(extraction, { recursive: true, force: true });
if (failure) throw failure;
