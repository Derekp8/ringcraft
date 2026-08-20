import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chooseDeterministicPolicyAction, fnv1a32 } from "../src/core/index.ts";
import { M10_DECISION_LOG_SCHEMA, diffCorpusFixture, normalizeFixtureEol } from "./m10-ai-corpus.ts";
import type { DecisionLogFixture } from "./m10-ai-corpus.ts";

// Optional fixture path (default: the committed golden log). The module runner
// consumes argv[2] as the script path, so the first real argument is argv[3].
const defaultPath = fileURLToPath(new URL("../fixtures/m10/ai-decision-log-v1.json", import.meta.url));
const candidatePath = process.argv[3] ? resolve(process.cwd(), process.argv[3]) : defaultPath;
const raw = await readFile(candidatePath, "utf8");
// Hash the LF-normalized text so the reported identity matches the pinned
// fixture hash on both LF and CRLF checkouts (see normalizeFixtureEol).
const rawForHashing = normalizeFixtureEol(raw);
const fixture: DecisionLogFixture = JSON.parse(raw);
if (fixture.schema !== M10_DECISION_LOG_SCHEMA) throw new Error("M10 decision-log fixture schema is unsupported.");

// Whole-corpus diff: every diverged decision across all runs, plus any
// run-level count or final-state-hash divergences — not just the first.
const diff = diffCorpusFixture(fixture, chooseDeterministicPolicyAction);

const byKind: Record<string, number> = {};
for (const entry of diff.divergences) byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;

console.log(JSON.stringify({
  schema: fixture.schema,
  capturedPolicy: fixture.capturedPolicy,
  fixtureSha256: createHash("sha256").update(rawForHashing).digest("hex"),
  fixtureFnv1a32: fnv1a32(rawForHashing),
  runs: diff.runs,
  decisions: diff.decisions,
  divergenceCount: diff.divergenceCount,
  clean: diff.clean,
  decisionDivergences: diff.divergences,
  runDivergences: diff.runDivergences,
  divergedByKind: byKind,
}, null, 2));

if (!diff.clean) {
  process.exitCode = 1;
}
