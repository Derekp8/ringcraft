import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chooseDeterministicPolicyAction, choosePolicyAction, fnv1a32 } from "../src/core/index.ts";
import { ALL_DECISION_KINDS, M10_DECISION_LOG_SCHEMA, kindCoverage, normalizeFixtureEol, verifyCorpusFixture } from "./m10-ai-corpus.ts";
import type { DecisionLogFixture } from "./m10-ai-corpus.ts";

const fixtureUrl = new URL("../fixtures/m10/ai-decision-log-v1.json", import.meta.url);
const raw = await readFile(fixtureUrl, "utf8");
// Hash the LF-normalized text so the reported identity is identical on LF and
// CRLF checkouts (see normalizeFixtureEol); JSON.parse below is EOL-agnostic.
const rawForHashing = normalizeFixtureEol(raw);
const fixture: DecisionLogFixture = JSON.parse(raw);
if (fixture.schema !== M10_DECISION_LOG_SCHEMA) throw new Error("M10 decision-log fixture schema is unsupported.");

// The golden log must reproduce exactly under today's policy, and each run's
// terminal state hash must replay identically (the strengthened replay
// contract: the decision sequence AND the entire resulting match state). The
// selector is difficulty-aware and routes from the config's own difficulty:
// standard runs replay under the deterministic v1 path (identical to
// chooseDeterministicPolicyAction), and the seeded ruthless run under the
// 2-ply policy — so the ruthless replay contract is covered by the
// fixtures:verify gate. AI-side decisions resolve internally from
// state.config.aiDifficulty regardless of the injected selector.
const difficultyAwareSelect: Parameters<typeof verifyCorpusFixture>[1] = (state, decision) =>
  choosePolicyAction(state, decision, state.config.aiDifficulty ?? "standard");
verifyCorpusFixture(fixture, difficultyAwareSelect);

const coverage = kindCoverage(fixture.corpus);
const missing = ALL_DECISION_KINDS.filter((kind) => !coverage[kind]);
if (missing.length) throw new Error(`Corpus is missing decision kinds: ${missing.join(", ")}.`);

let decisionsReplayed = 0;
let hashColumnChecked = 0;
let finalStateHashesReplayed = 0;
for (const record of fixture.corpus) {
  decisionsReplayed += record.decisions.length;
  hashColumnChecked += record.decisions.filter((entry) => /^[0-9a-f]{8}$/.test(entry.hash)).length;
  finalStateHashesReplayed += 1;
}
const decisionCounts: Record<string, number> = {};
for (const record of fixture.corpus) for (const entry of record.decisions) decisionCounts[entry.kind] = (decisionCounts[entry.kind] ?? 0) + 1;

// Deterministic-evidence surface the M9 clean-room gate asserts against the
// manifest's `deterministic_evidence` (m10_corpus_hash_column_checked and
// m10_corpus_final_state_hashes_replayed): every decision must carry a
// per-decision hash column, and every run must replay its final state hash.
console.log(JSON.stringify({
  schema: fixture.schema,
  capturedPolicy: fixture.capturedPolicy,
  fixtureSha256: createHash("sha256").update(rawForHashing).digest("hex"),
  fixtureFnv1a32: fnv1a32(rawForHashing),
  runs: fixture.corpus.length,
  decisions: decisionsReplayed,
  hashColumnChecked,
  finalStateHashesReplayed,
  kindsCovered: Object.keys(coverage).length,
  decisionCounts,
  status: "verified",
}, null, 2));
