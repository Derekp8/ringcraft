import { describe, expect, it } from "vitest";
import { chooseDeterministicPolicyAction, choosePolicyAction, fnv1a32 } from "../src/core";
import { ALL_DECISION_KINDS, M10_DECISION_LOG_SCHEMA, collectCorpusDecisions, corpusDecisionHash, diffCorpusFixture, kindCoverage, normalizeFixtureEol, verifyCorpusFixture } from "../scripts/m10-ai-corpus";
import type { DecisionLogFixture } from "../scripts/m10-ai-corpus";
import fixtureJson from "../fixtures/m10/ai-decision-log-v1.json";
import fixtureText from "../fixtures/m10/ai-decision-log-v1.json?raw";

const fixture = fixtureJson as unknown as DecisionLogFixture;
// Line endings are normalized before hashing so the pin is the same on LF and
// CRLF checkouts (see normalizeFixtureEol): the `?raw` import carries the
// checkout's bytes, so a Windows autocrlf checkout must not shift the hash.
const fixtureHash = fnv1a32(normalizeFixtureEol(fixtureText));

/** Routes the player-side selector from the run's own config difficulty, so
 * standard runs replay under the v1 path and the ruthless run under 2-ply. */
const selectFor = (record: { config: { aiDifficulty?: string } }) =>
  (state: Parameters<typeof chooseDeterministicPolicyAction>[0], decision: Parameters<typeof chooseDeterministicPolicyAction>[1]) =>
    choosePolicyAction(state, decision, (record.config.aiDifficulty ?? "standard") as "novice" | "standard" | "veteran" | "ruthless");

describe("M10 AI decision-log corpus", () => {
  it("pins the golden decision log so an unintended regeneration is caught", () => {
    expect(fixtureHash).toBe("64e1f4af");
  });

  it("declares the captured policy and schema", () => {
    expect(fixture.schema).toBe(M10_DECISION_LOG_SCHEMA);
    expect(fixture.capturedPolicy).toBe("asw91-ai-policy-v1");
  });

  it("covers every decision-state kind in the engine", () => {
    const coverage = kindCoverage(fixture.corpus);
    for (const kind of ALL_DECISION_KINDS) {
      expect(coverage[kind], `corpus must capture at least one ${kind} decision`).toBeGreaterThan(0);
    }
  });

  it("replays today's v1 policy byte-identically against the golden log (default identity)", () => {
    let replayCount = 0;
    for (const record of fixture.corpus) {
      const { entries, finalStateHash } = collectCorpusDecisions(record.config, fixture.rosters[record.config.rosterKey], selectFor(record));
      expect(entries).toEqual(record.decisions);
      expect(finalStateHash).toBe(record.finalStateHash);
      replayCount += entries.length;
    }
    expect(replayCount).toBe(1050);
  }, 120_000);

  it("routes default and standard AI difficulty through the same v1 path byte-identically", () => {
    for (const record of fixture.corpus.filter((row) => !row.config.aiDifficulty)) {
      const viaDispatcher = collectCorpusDecisions(record.config, fixture.rosters[record.config.rosterKey], (state, decision) => choosePolicyAction(state, decision, "standard"));
      expect(viaDispatcher.entries).toEqual(record.decisions);
      expect(viaDispatcher.finalStateHash).toBe(record.finalStateHash);
      const viaDefault = collectCorpusDecisions(record.config, fixture.rosters[record.config.rosterKey], (state, decision) => choosePolicyAction(state, decision));
      expect(viaDefault.entries).toEqual(record.decisions);
      expect(viaDefault.finalStateHash).toBe(record.finalStateHash);
    }
  }, 120_000);

  it("replays the seeded ruthless run under the ruthless policy with its golden final state", () => {
    const ruthless = fixture.corpus.find((record) => record.label === "ruthless-singles-1991");
    expect(ruthless).toBeDefined();
    expect(ruthless!.config.aiDifficulty).toBe("ruthless");
    const { entries, finalStateHash } = collectCorpusDecisions(ruthless!.config, fixture.rosters[ruthless!.config.rosterKey], (state, decision) => choosePolicyAction(state, decision, "ruthless"));
    expect(entries).toEqual(ruthless!.decisions);
    expect(finalStateHash).toBe(ruthless!.finalStateHash);
    // The ruthless run must diverge from the standard replay of the same seed.
    const standard = fixture.corpus.find((record) => record.label === "standard-singles-1991-a");
    expect(standard).toBeDefined();
    expect(ruthless!.finalStateHash).not.toBe(standard!.finalStateHash);
  }, 120_000);

  it("records a canonical, run-specific final match state hash per corpus run", () => {
    expect(fixture.corpus.length).toBeGreaterThan(0);
    const hashes = new Set<string>();
    for (const record of fixture.corpus) {
      expect(record.finalStateHash).toMatch(/^c14n-fnv1a64-v1:/);
      expect(hashes.has(record.finalStateHash), `${record.label} reused another run's final state hash`).toBe(false);
      hashes.add(record.finalStateHash);
    }
  });

  it("records a per-decision hash column locating changes by seed, tick, and kind", () => {
    let checked = 0;
    for (const record of fixture.corpus) {
      for (const entry of record.decisions) {
        expect(entry.hash).toMatch(/^[0-9a-f]{8}$/);
        expect(corpusDecisionHash(record.config.seed, entry), `${record.label} tick ${entry.tick} kind ${entry.kind}: golden hash column is inconsistent`).toBe(entry.hash);
        checked += 1;
      }
    }
    expect(checked).toBe(1050);
  });

  it("pins the seeded ruthless run as a corpus entry with a golden final state hash", () => {
    const ruthless = fixture.corpus.find((record) => record.label === "ruthless-singles-1991");
    expect(ruthless).toBeDefined();
    expect(ruthless!.config.seed).toBe(1991);
    expect(ruthless!.decisions.length).toBeGreaterThan(0);
    expect(ruthless!.finalStateHash).toMatch(/^c14n-fnv1a64-v1:/);
  });

  it("stores self-contained rosters that satisfy the corpus schema", () => {
    for (const [rosterKey, records] of Object.entries(fixture.rosters)) {
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        expect(record.id).toBeTruthy();
        expect(record.attributes).toBeTruthy();
        expect(record.skills).toBeTruthy();
        expect(record.maneuverLevels).toBeTruthy();
      }
      for (const run of fixture.corpus.filter((row) => row.config.rosterKey === rosterKey)) {
        expect(run.config.mode).toBe(records.length >= 4 ? "tag" : "singles");
      }
    }
  });

  it("names the exact seed, tick, and kind when a single decision hash is flipped in a scratch copy (mutation fault injection)", () => {
    // Pick a distinctive target: the single damage-charm decision (rare kind,
    // deterministic tick) so the located kind is unambiguous.
    const target = fixture.corpus
      .map((record, recordIndex) => ({ record, recordIndex, entryIndex: record.decisions.findIndex((entry) => entry.kind === "damage-charm") }))
      .find((row) => row.entryIndex >= 0)!;
    expect(target).toBeDefined();
    const golden = target.record.decisions[target.entryIndex];
    expect(golden.kind).toBe("damage-charm");

    // Scratch copy with exactly one decision's hash flipped to a wrong value.
    const mutated = JSON.parse(JSON.stringify(fixture)) as DecisionLogFixture;
    const mutatedRun = mutated.corpus[target.recordIndex];
    const flipped = golden.hash === "00000000" ? "ffffffff" : "00000000";
    mutatedRun.decisions[target.entryIndex] = { ...mutatedRun.decisions[target.entryIndex], hash: flipped };

    let caught: unknown = null;
    try {
      verifyCorpusFixture(mutated, selectFor(target.record));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    // The verifier locates the exact seed, tick, and kind of the mutated decision.
    expect(message).toContain(`seed ${target.record.config.seed}`);
    expect(message).toContain(`tick ${golden.tick}`);
    expect(message).toContain(`kind ${golden.kind}`);
    // And it points at the flipped hash column specifically (golden vs actual).
    expect(message).toContain(flipped);
    expect(message).toContain(golden.hash);

    // The untouched fixture still verifies cleanly.
    expect(() => verifyCorpusFixture(fixture, selectFor(target.record))).not.toThrow();
  }, 120_000);

  it("reports every diverged decision across all runs, not just the first (whole-corpus diff)", () => {
    // Mutate one decision in each of three different runs (three different
    // seeds/kinds) so the diff must span the whole corpus.
    const targets = fixture.corpus
      .map((record, recordIndex) => ({ record, recordIndex, entryIndex: record.decisions.findIndex((entry) => entry.kind === "damage-charm" || entry.kind === "bonus-attack" || entry.kind === "knockout-pin") }))
      .filter((row) => row.entryIndex >= 0)
      .slice(0, 3);
    expect(targets).toHaveLength(3);
    const flippedHashes = new Map<string, string>();
    const mutated = JSON.parse(JSON.stringify(fixture)) as DecisionLogFixture;
    for (const { record, recordIndex, entryIndex } of targets) {
      const golden = record.decisions[entryIndex];
      const flipped = golden.hash === "00000000" ? "ffffffff" : "00000000";
      flippedHashes.set(golden.hash, flipped);
      mutated.corpus[recordIndex].decisions[entryIndex] = { ...mutated.corpus[recordIndex].decisions[entryIndex], hash: flipped };
    }

    const diff = diffCorpusFixture(mutated, selectFor(targets[0].record));
    expect(diff.clean).toBe(false);
    expect(diff.divergences).toHaveLength(3);
    expect(diff.runDivergences).toHaveLength(0);
    // Every mutated decision is reported with its exact seed, tick, and kind —
    // none is swallowed by the first failure.
    for (const { record, entryIndex } of targets) {
      const golden = record.decisions[entryIndex];
      const located = diff.divergences.find((entry) => entry.seed === record.config.seed && entry.tick === golden.tick && entry.kind === golden.kind);
      expect(located, `diff must locate seed ${record.config.seed} tick ${golden.tick} kind ${golden.kind}`).toBeDefined();
      expect(located!.golden?.hash).toBe(flippedHashes.get(golden.hash));
      expect(located!.actual?.hash).toBe(golden.hash);
      expect(located!.label).toBe(record.label);
    }
    // The fast-failing gate still throws on the first of the three.
    expect(() => verifyCorpusFixture(mutated, selectFor(targets[0].record))).toThrow(/seed \d+, tick \d+, kind \w+/);

    // The untouched fixture diffs clean.
    expect(diffCorpusFixture(fixture, selectFor(fixture.corpus[0])).clean).toBe(true);
  }, 120_000);
});
