import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REPLAY_VERSION, RULESET_VERSION } from "../src/core/index.ts";
import { M10_DECISION_LOG_SCHEMA } from "./m10-ai-corpus.ts";
import { M13_TITLE_SHOT_CHAIN_SCHEMA } from "./m13-title-shot-chain.ts";
import { M13_FEUD_HEAT_CHAIN_SCHEMA } from "./m13-feud-heat-chain.ts";
import { checkCareerReplayCorpus, verifyFeudHeatChainFixture, verifyReplayFile, verifyTitleShotChainFixture } from "./replay-verifier.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
// The replay verifier covers two fixture kinds: exported replay documents
// (fixtures/replays) and career replay corpora — the M10 decision-log fixture
// (fixtures/m10) replayed against the engine's replay contract.
const defaultDirectories = [join(projectRoot, "fixtures", "replays"), join(projectRoot, "fixtures", "m10")];

/** Extra CLI args land at argv[3] because the runner consumes argv[2] as the module path. */
const extra = process.argv.slice(3);

/** A fixture kind this verifier owns: a replay document or an M10 decision-log corpus. */
function isOwnedKind(document: unknown): boolean {
  if (typeof document !== "object" || document === null) return false;
  const record = document as Record<string, unknown>;
  if (record.schema === M10_DECISION_LOG_SCHEMA) return true;
  if (record.schema === M13_TITLE_SHOT_CHAIN_SCHEMA) return true;
  if (record.schema === M13_FEUD_HEAT_CHAIN_SCHEMA) return true;
  // Exported replay documents carry the replay-document keys and no schema.
  return record.schema === undefined && ("replayVersion" in record || "expectedStateHash" in record);
}

async function collectPaths(targets: string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const target of targets.length ? targets : defaultDirectories) {
    const full = resolve(projectRoot, target);
    const info = await stat(full);
    if (info.isDirectory()) {
      // Directory scans collect only the fixture kinds this verifier owns (a
      // scanned directory may also hold fixtures with their own verifiers, e.g.
      // the m10-ruthless-campaign fixture). Explicit file targets below are
      // always collected, so a deliberate single-file check still reports an
      // unsupported schema instead of skipping it.
      for (const entry of await readdir(full)) {
        if (!entry.endsWith(".json")) continue;
        const candidate = join(full, entry);
        try {
          const document = JSON.parse(await readFile(candidate, "utf8"));
          if (isOwnedKind(document)) paths.push(candidate);
        } catch {
          paths.push(candidate); // unparsable JSON is itself a drift report
        }
      }
    } else {
      paths.push(full);
    }
  }
  return paths.sort();
}

const paths = await collectPaths(extra);
if (!paths.length) throw new Error("No replay documents found to verify.");

const reports = [];
for (const path of paths) {
  const raw = await readFile(path, "utf8");
  const sha256 = createHash("sha256").update(raw).digest("hex");
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    document = null;
  }
  const schema = typeof document === "object" && document !== null ? (document as { schema?: unknown }).schema : undefined;
  if (schema === M10_DECISION_LOG_SCHEMA) {
    const report = checkCareerReplayCorpus(raw);
    reports.push({ file: basename(path), sha256, kind: "career-replay-corpus", ...report });
  } else if (schema === M13_TITLE_SHOT_CHAIN_SCHEMA) {
    const report = verifyTitleShotChainFixture(raw);
    reports.push({ file: basename(path), sha256, kind: "title-shot-chain", ...report });
  } else if (schema === M13_FEUD_HEAT_CHAIN_SCHEMA) {
    const report = verifyFeudHeatChainFixture(raw);
    reports.push({ file: basename(path), sha256, kind: "feud-heat-chain", ...report });
  } else if (schema === undefined) {
    // No schema field: an exported replay document (replayVersion/rulesetVersion
    // keys) — verified by the replay-document schema check.
    const report = verifyReplayFile(raw);
    reports.push({ file: basename(path), sha256, kind: "replay-document", ...report });
  } else {
    // A fixture with a schema this verifier does not own (e.g. the
    // m10-ruthless-campaign-v1 fixture, which has its own verifier) — report it
    // rather than misreading it as a replay document.
    reports.push({
      file: basename(path),
      sha256,
      kind: "unsupported-fixture",
      schema: String(schema),
      errors: [`Fixture schema ${String(schema)} is not a replay document or M10 decision-log corpus; verify it with its own verifier.`],
      status: "drift",
    });
  }
}

const driftCount = reports.filter((report) => report.status === "drift").length;
console.log(JSON.stringify({
  supportedReplayVersion: REPLAY_VERSION,
  supportedRulesetVersion: RULESET_VERSION,
  filesChecked: reports.length,
  driftCount,
  files: reports,
  status: driftCount ? "drift" : "verified",
}, null, 2));
if (driftCount) process.exitCode = 1;
