import { describe, expect, it } from "vitest";
import { REPLAY_VERSION, RULESET_VERSION } from "../src/core";
import { checkCareerReplayCorpus, verifyFeudHeatChainFixture, verifyReplayFile, verifyTitleShotChainFixture } from "../scripts/replay-verifier";
import ruthlessFixture from "../fixtures/replays/ruthless-seed-1991-v2.json";
import tagFixture from "../fixtures/replays/tag-seed-1991-v2.json";
import titleShotChainFixture from "../fixtures/replays/title-shot-chain-v1.json";
import feudHeatChainFixture from "../fixtures/replays/feud-heat-chain-v1.json";
import corpusFixture from "../fixtures/m10/ai-decision-log-v1.json";

function mutated(document: Record<string, unknown>, patch: (doc: Record<string, unknown>) => void): string {
  const copy = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
  patch(copy);
  return JSON.stringify(copy);
}

describe("replay verifier", () => {
  it("verifies the committed ruthless fixture replay end to end", () => {
    const report = verifyReplayFile(JSON.stringify(ruthlessFixture));
    expect(report.status).toBe("verified");
    expect(report.errors).toEqual([]);
    expect(report.replayVersion).toBe(REPLAY_VERSION);
    expect(report.rulesetVersion).toBe(RULESET_VERSION);
    expect(report.expectedStateHash).toBe("c14n-fnv1a64-v1:03e0fea1cb9c5be1");
    expect(report.actualStateHash).toBe(report.expectedStateHash);
    expect(report.derivedDataHash).toBe(report.dataHash);
    expect(report.schemaMissing).toEqual([]);
    expect(report.schemaUnexpected).toEqual([]);
  });

  it("reports replayVersion drift against the current engine", () => {
    const report = verifyReplayFile(mutated(ruthlessFixture as unknown as Record<string, unknown>, (doc) => { doc.replayVersion = REPLAY_VERSION + 1; }));
    expect(report.status).toBe("drift");
    expect(report.errors.some((line) => line.includes("replayVersion drift"))).toBe(true);
  });

  it("reports rulesetVersion drift against the current engine", () => {
    const report = verifyReplayFile(mutated(ruthlessFixture as unknown as Record<string, unknown>, (doc) => { doc.rulesetVersion = "9.9.9-future"; }));
    expect(report.status).toBe("drift");
    expect(report.errors.some((line) => line.includes("rulesetVersion drift"))).toBe(true);
  });

  it("reports data-pack drift when the declared dataHash no longer derives", () => {
    const report = verifyReplayFile(mutated(ruthlessFixture as unknown as Record<string, unknown>, (doc) => { doc.dataHash = "fnv1a32-drifted"; }));
    expect(report.status).toBe("drift");
    expect(report.errors.some((line) => line.includes("Data pack drift"))).toBe(true);
  });

  it("reports replay hash drift when the replayed state diverges from expectedStateHash", () => {
    const report = verifyReplayFile(mutated(ruthlessFixture as unknown as Record<string, unknown>, (doc) => { doc.expectedStateHash = "c14n-fnv1a64-v1:0000000000000000"; }));
    expect(report.status).toBe("drift");
    expect(report.errors.some((line) => line.includes("Replay hash drift"))).toBe(true);
  });

  it("reports missing schema keys and unexpected keys", () => {
    const report = verifyReplayFile(mutated(ruthlessFixture as unknown as Record<string, unknown>, (doc) => { delete doc.inputs; doc.extraField = true; }));
    expect(report.status).toBe("drift");
    expect(report.schemaMissing).toContain("inputs");
    expect(report.schemaUnexpected).toContain("extraField");
  });

  it("reports schema type errors for malformed fields", () => {
    const report = verifyReplayFile(mutated(ruthlessFixture as unknown as Record<string, unknown>, (doc) => { doc.inputs = "not-an-array"; doc.replayVersion = "two"; }));
    expect(report.status).toBe("drift");
    expect(report.schemaTypeErrors.some((line) => line.includes("inputs"))).toBe(true);
    expect(report.schemaTypeErrors.some((line) => line.includes("replayVersion"))).toBe(true);
  });

  it("reports unparsable JSON without throwing", () => {
    const report = verifyReplayFile("{not json");
    expect(report.status).toBe("drift");
    expect(report.errors.some((line) => line.includes("Unparsable JSON"))).toBe(true);
  });

  it("verifies the tag fixture replay independently", () => {
    const report = verifyReplayFile(JSON.stringify(tagFixture));
    expect(report.status).toBe("verified");
    expect(report.expectedStateHash).toBe("c14n-fnv1a64-v1:1b26c32a342f08c8");
  });

  // The corpus check replays all 12 runs (including the 2-ply ruthless run) on
  // every call, so it needs an explicit budget: under full-suite CPU contention
  // it exceeds vitest's 5000ms default. Same for the two corpus drift tests.
  it("verifies the committed career replay corpus end to end", { timeout: 60_000 }, () => {
    const report = checkCareerReplayCorpus(JSON.stringify(corpusFixture));
    expect(report.status).toBe("verified");
    expect(report.errors).toEqual([]);
    expect(report.schema).toBe("m10-ai-decision-log-v1");
    expect(report.capturedPolicy).toBe("asw91-ai-policy-v1");
    expect(report.runs).toBe(12);
    expect(report.decisionsReplayed).toBe(1058);
    expect(report.ruthlessRunPresent).toBe(true);
    expect(report.ruthlessFinalStateHash).toBe("c14n-fnv1a64-v1:2ee17eb5bdfecf38");
  });

  it("locates a corpus decision divergence by run label and both hashes", { timeout: 60_000 }, () => {
    const mutated = JSON.parse(JSON.stringify(corpusFixture)) as Record<string, unknown>;
    (mutated.corpus as Array<Record<string, unknown>>)[0].finalStateHash = "c14n-fnv1a64-v1:0000000000000000";
    const report = checkCareerReplayCorpus(JSON.stringify(mutated));
    expect(report.status).toBe("drift");
    const line = report.errors.find((entry) => entry.includes("final state hash drift"));
    expect(line).toBeTruthy();
    expect(line).toContain("standard-singles-1991-a");
    expect(line).toContain("c14n-fnv1a64-v1:0000000000000000");
  });

  it("reports corpus schema drift when the fixture declares a foreign schema", { timeout: 60_000 }, () => {
    const mutated = JSON.parse(JSON.stringify(corpusFixture)) as Record<string, unknown>;
    mutated.schema = "m10-ai-decision-log-v9";
    const report = checkCareerReplayCorpus(JSON.stringify(mutated));
    expect(report.status).toBe("drift");
    expect(report.errors.some((entry) => entry.includes("Corpus schema drift"))).toBe(true);
  });

  // This is the baseline full title-shot chain derivation used by the drift
  // tests below. It stays below 5s in isolation but measured 7.2s under the
  // complete suite's parallel CPU load, so give only this workload headroom.
  it("verifies the committed respond-title-shot event chain fixture end to end", { timeout: 15_000 }, () => {
    const report = verifyTitleShotChainFixture(JSON.stringify(titleShotChainFixture));
    expect(report.status).toBe("verified");
    expect(report.errors).toEqual([]);
    expect(report.schema).toBe("m13-title-shot-chain-v1");
    expect(report.offerId).toBe("title-shot-4c1632ac");
    expect(report.rollLine).toBe("6 -3 same side (tag) +3 feud heat 60 vs champion = 6");
    // The grant-event line is pinned as first-class deterministic evidence: the
    // shared titleShotGrantLine helper's output, recorded in the grant detail
    // and re-derived by the verifier on every run.
    expect(report.grantLine).toBe("t2 granted World Tag offer title-shot-4c1632ac; roll 6 -3 same side (tag) +3 feud heat 60 vs champion = 6.");
    expect(titleShotChainFixture.evidence.grantLine).toBe(report.grantLine);
    expect(titleShotChainFixture.evidence.grantDetail).toContain(titleShotChainFixture.evidence.grantLine);
    // The chain links hold inside the committed fixture: the decline path ends
    // at the declined hash, the accept event pre-state is the rolled hash, and
    // the final accepted hash includes the scheduled mandatory defense.
    expect(titleShotChainFixture.evidence.declineEvent.preStateHash).toBe(titleShotChainFixture.evidence.rolledCampaignHash);
    expect(titleShotChainFixture.evidence.declineEvent.postStateHash).toBe(titleShotChainFixture.evidence.declinedCampaignHash);
    expect(titleShotChainFixture.evidence.acceptEvent.preStateHash).toBe(titleShotChainFixture.evidence.rolledCampaignHash);
    expect(titleShotChainFixture.evidence.scheduledDefense).toMatchObject({ titleId: "world-tag", mandatoryDefense: true, entrantIds: ["t2", "t1"] });
    expect(report.fixtureHash).toBe(titleShotChainFixture.fixtureHash);
    // The manual-booking leg (grantExtraTitleShot), symmetric to the rolled
    // chain: the champion plays the accepted mandatory defense (retains by pin,
    // obligation 1/1 complete) and grants the top-ranked non-champion an extra
    // shot — the schedule event's consolidated grant line is pinned and synced
    // to the detail exactly like the rolled grant line.
    expect(report.extraGrantLine).toBe("t3 granted extra World Tag shot (mandatory defenses complete 1/1).");
    expect(titleShotChainFixture.evidence.extraGrantLine).toBe(report.extraGrantLine);
    expect(titleShotChainFixture.evidence.extraGrantDetail).toContain(titleShotChainFixture.evidence.extraGrantLine);
    expect(titleShotChainFixture.evidence.extraGrantEvent.preStateHash).toBe(titleShotChainFixture.evidence.defendedCampaignHash);
    expect(titleShotChainFixture.evidence.extraGrantEvent.postStateHash).toBe(titleShotChainFixture.evidence.extraGrantCampaignHash);
    expect(titleShotChainFixture.evidence.defense).toMatchObject({ method: "pin", winnerEntrantId: "t1", completedDefenses: 1, requiredDefenses: 1 });
    expect(titleShotChainFixture.evidence.extraShot).toMatchObject({ titleId: "world-tag", candidateId: "t3", mandatoryDefense: false });
  });

  it("locates a respond-title-shot chain divergence by pinned field", { timeout: 15_000 }, () => {
    const mutated = JSON.parse(JSON.stringify(titleShotChainFixture)) as Record<string, unknown>;
    (mutated.evidence as Record<string, unknown>).acceptedCampaignHash = "c14n-fnv1a64-v1:0000000000000000";
    const report = verifyTitleShotChainFixture(JSON.stringify(mutated));
    expect(report.status).toBe("drift");
    const line = report.errors.find((entry) => entry.includes("acceptedCampaignHash drift"));
    expect(line).toBeTruthy();
    expect(line).toContain("c14n-fnv1a64-v1:0000000000000000");
  });

  it("locates grant-line drift and log/panel sync drift by pinned field", { timeout: 15_000 }, () => {
    const mutated = JSON.parse(JSON.stringify(titleShotChainFixture)) as Record<string, unknown>;
    (mutated.evidence as Record<string, unknown>).grantLine = "t2 granted World Tag offer title-shot-4c1632ac; roll 6 = 6.";
    const report = verifyTitleShotChainFixture(JSON.stringify(mutated));
    expect(report.status).toBe("drift");
    const line = report.errors.find((entry) => entry.includes("Grant line drift"));
    expect(line).toBeTruthy();
    expect(line).toContain("t2 granted World Tag offer title-shot-4c1632ac; roll 6 = 6.");

    // The log/panel sync invariant: the pinned grant line must also appear in
    // the recorded grant event detail — if one surface stops using the shared
    // helper, the verifier names the sync break.
    const syncMutated = JSON.parse(JSON.stringify(titleShotChainFixture)) as Record<string, unknown>;
    const evidence = syncMutated.evidence as Record<string, unknown>;
    (evidence.grantDetail as string[]) = (evidence.grantDetail as string[]).filter((entry) => !entry.includes("granted World Tag offer"));
    const syncReport = verifyTitleShotChainFixture(JSON.stringify(syncMutated));
    expect(syncReport.status).toBe("drift");
    expect(syncReport.errors.some((entry) => entry.includes("log/panel sync drift"))).toBe(true);
  });

  // This test re-derives the complete title-shot campaign chain twice. It
  // measures at ~3s in isolation on the verified Node 24 host, but exceeded
  // Vitest's 5s default under full-suite GitHub runner contention. Keep the
  // budget scoped to this deterministic workload rather than weakening the
  // suite globally.
  it("locates manual-booking-leg drift by pinned field", { timeout: 15_000 }, () => {
    const mutated = JSON.parse(JSON.stringify(titleShotChainFixture)) as Record<string, unknown>;
    (mutated.evidence as Record<string, unknown>).defendedCampaignHash = "c14n-fnv1a64-v1:0000000000000000";
    const report = verifyTitleShotChainFixture(JSON.stringify(mutated));
    expect(report.status).toBe("drift");
    const line = report.errors.find((entry) => entry.includes("defendedCampaignHash drift"));
    expect(line).toBeTruthy();
    expect(line).toContain("c14n-fnv1a64-v1:0000000000000000");

    const outcomeMutated = JSON.parse(JSON.stringify(titleShotChainFixture)) as Record<string, unknown>;
    (outcomeMutated.evidence as Record<string, unknown>).defense = { ...(outcomeMutated.evidence as Record<string, unknown>).defense as Record<string, unknown>, finalMatchHash: "c14n-fnv1a64-v1:deadbeefdeadbeef" };
    const outcomeReport = verifyTitleShotChainFixture(JSON.stringify(outcomeMutated));
    expect(outcomeReport.status).toBe("drift");
    expect(outcomeReport.errors.some((entry) => entry.includes("Defense outcome drift"))).toBe(true);
  });

  // This verifier intentionally re-derives the complete M13 campaign chain
  // twice. It runs in ~3s alone and can exceed Vitest's 5s default only under
  // full-suite CPU contention, so give this measured deterministic workload an
  // explicit budget like the corpus replays above.
  it("locates extra-shot grant-line drift and manual log/panel sync drift by pinned field", { timeout: 15_000 }, () => {
    const mutated = JSON.parse(JSON.stringify(titleShotChainFixture)) as Record<string, unknown>;
    (mutated.evidence as Record<string, unknown>).extraGrantLine = "t3 granted extra World Tag shot (mandatory defenses complete 0/1).";
    const report = verifyTitleShotChainFixture(JSON.stringify(mutated));
    expect(report.status).toBe("drift");
    const line = report.errors.find((entry) => entry.includes("Extra-shot grant line drift"));
    expect(line).toBeTruthy();
    expect(line).toContain("t3 granted extra World Tag shot (mandatory defenses complete 0/1).");

    // The manual-path sync invariant mirrors the rolled path: the pinned extra
    // grant line must also appear in the schedule event detail.
    const syncMutated = JSON.parse(JSON.stringify(titleShotChainFixture)) as Record<string, unknown>;
    const evidence = syncMutated.evidence as Record<string, unknown>;
    (evidence.extraGrantDetail as string[]) = (evidence.extraGrantDetail as string[]).filter((entry) => !entry.includes("granted extra World Tag shot"));
    const syncReport = verifyTitleShotChainFixture(JSON.stringify(syncMutated));
    expect(syncReport.status).toBe("drift");
    expect(syncReport.errors.some((entry) => entry.includes("manual log/panel sync drift"))).toBe(true);
  });

  it("reports title-shot chain schema drift and offer-id drift", { timeout: 15_000 }, () => {
    const mutated = JSON.parse(JSON.stringify(titleShotChainFixture)) as Record<string, unknown>;
    mutated.schema = "m13-title-shot-chain-v9";
    const report = verifyTitleShotChainFixture(JSON.stringify(mutated));
    expect(report.status).toBe("drift");
    expect(report.errors.some((entry) => entry.includes("schema drift"))).toBe(true);

    const offerMutated = JSON.parse(JSON.stringify(titleShotChainFixture)) as Record<string, unknown>;
    (offerMutated.evidence as Record<string, unknown>).offer = { ...(offerMutated.evidence as Record<string, unknown>).offer as Record<string, unknown>, id: "title-shot-deadbeef" };
    const offerReport = verifyTitleShotChainFixture(JSON.stringify(offerMutated));
    expect(offerReport.status).toBe("drift");
    expect(offerReport.errors.some((entry) => entry.includes("offer id drift"))).toBe(true);
  });

  it("verifies the committed feud-heat event chain fixture end to end", { timeout: 15_000 }, () => {
    const report = verifyFeudHeatChainFixture(JSON.stringify(feudHeatChainFixture));
    expect(report.status).toBe("verified");
    expect(report.errors).toEqual([]);
    expect(report.schema).toBe("m13-feud-heat-chain-v1");
    expect(report.feudId).toBe("feud-302eaae0");
    // The chain links hold inside the committed fixture: the start-feud event's
    // pre-state is the initial campaign hash and its post-state the feuded hash;
    // the January advance starts at the committed hash (the feud matched in
    // January, so no decay) and the March advance starts at the Feb 1 hash (the
    // cold February applies the -5 monthly decay).
    expect(feudHeatChainFixture.evidence.startFeudEvent.preStateHash).toBe(feudHeatChainFixture.evidence.initialCampaignHash);
    expect(feudHeatChainFixture.evidence.startFeudEvent.postStateHash).toBe(feudHeatChainFixture.evidence.feudedCampaignHash);
    expect(feudHeatChainFixture.evidence.febAdvanceEvent.preStateHash).toBe(feudHeatChainFixture.evidence.committedCampaignHash);
    expect(feudHeatChainFixture.evidence.febAdvanceEvent.postStateHash).toBe(feudHeatChainFixture.evidence.feb1CampaignHash);
    expect(feudHeatChainFixture.evidence.marAdvanceEvent.preStateHash).toBe(feudHeatChainFixture.evidence.feb1CampaignHash);
    expect(feudHeatChainFixture.evidence.marAdvanceEvent.postStateHash).toBe(feudHeatChainFixture.evidence.mar1CampaignHash);
    // The feud-heat movement is pinned as first-class deterministic evidence:
    // the committed time-limit draw moves heat +4 (60 → 64) with reason "draw",
    // the matched month never cools (heat 64 at Feb 1, one movement row), and
    // the cold February decays -5 (64 → 59) with reason "monthly-decay".
    expect(report.heatLine).toBe("Feud championship tag grudge (t1 vs t2): heat 60 → 64 (+4); 1 feud match(es).");
    expect(feudHeatChainFixture.evidence.heatMovement).toMatchObject({ delta: 4, from: 60, to: 64, reason: "draw" });
    expect(feudHeatChainFixture.evidence.matchedMonthNoDecay).toEqual({ heat: 64, movementCount: 1 });
    expect(report.decayLine).toBe("Feud championship tag grudge cooled 64 → 59 (no match in 1991-02).");
    expect(feudHeatChainFixture.evidence.decayMovement).toMatchObject({ delta: -5, from: 64, to: 59, reason: "monthly-decay" });
    expect(feudHeatChainFixture.evidence.finalFeud).toMatchObject({ heat: 59, status: "active", matchCount: 1, lastMatchDate: "1991-01-01" });
    expect(report.fixtureHash).toBe(feudHeatChainFixture.fixtureHash);
  });

  it("locates a feud-heat chain divergence by pinned field", { timeout: 15_000 }, () => {
    const mutated = JSON.parse(JSON.stringify(feudHeatChainFixture)) as Record<string, unknown>;
    (mutated.evidence as Record<string, unknown>).mar1CampaignHash = "c14n-fnv1a64-v1:0000000000000000";
    const report = verifyFeudHeatChainFixture(JSON.stringify(mutated));
    expect(report.status).toBe("drift");
    const line = report.errors.find((entry) => entry.includes("mar1CampaignHash drift"));
    expect(line).toBeTruthy();
    expect(line).toContain("c14n-fnv1a64-v1:0000000000000000");
  });

  // Three complete feud-chain derivations measure at ~3.3s in isolation and
  // can exceed the 5s default only when the full clean-room suite competes for
  // CPU. Match the adjacent chain-verifier budget without hiding hangs behind
  // a large global timeout.
  it("locates heat-line and decay-line drift by pinned field", { timeout: 15_000 }, () => {
    const mutated = JSON.parse(JSON.stringify(feudHeatChainFixture)) as Record<string, unknown>;
    (mutated.evidence as Record<string, unknown>).heatLine = "Feud championship tag grudge (t1 vs t2): heat 60 → 64 (+9); 1 feud match(es).";
    const report = verifyFeudHeatChainFixture(JSON.stringify(mutated));
    expect(report.status).toBe("drift");
    const line = report.errors.find((entry) => entry.includes("Feud heat line drift"));
    expect(line).toBeTruthy();
    expect(line).toContain("+9");

    // The log/panel sync invariant: the pinned heat line must also appear in
    // the recorded commit-match-result detail.
    const syncMutated = JSON.parse(JSON.stringify(feudHeatChainFixture)) as Record<string, unknown>;
    const evidence = syncMutated.evidence as Record<string, unknown>;
    (evidence.heatMovement as Record<string, unknown>).delta = 9;
    const syncReport = verifyFeudHeatChainFixture(JSON.stringify(syncMutated));
    expect(syncReport.status).toBe("drift");
    expect(syncReport.errors.some((entry) => entry.includes("Feud heat movement drift"))).toBe(true);

    const decayMutated = JSON.parse(JSON.stringify(feudHeatChainFixture)) as Record<string, unknown>;
    (decayMutated.evidence as Record<string, unknown>).decayLine = "Feud championship tag grudge cooled 64 → 55 (no match in 1991-02).";
    const decayReport = verifyFeudHeatChainFixture(JSON.stringify(decayMutated));
    expect(decayReport.status).toBe("drift");
    expect(decayReport.errors.some((entry) => entry.includes("Feud decay line drift"))).toBe(true);
  });

  it("reports feud-heat chain schema drift and matched-month invariant drift", { timeout: 15_000 }, () => {
    const mutated = JSON.parse(JSON.stringify(feudHeatChainFixture)) as Record<string, unknown>;
    mutated.schema = "m13-feud-heat-chain-v9";
    const report = verifyFeudHeatChainFixture(JSON.stringify(mutated));
    expect(report.status).toBe("drift");
    expect(report.errors.some((entry) => entry.includes("schema drift"))).toBe(true);

    const invariantMutated = JSON.parse(JSON.stringify(feudHeatChainFixture)) as Record<string, unknown>;
    (invariantMutated.evidence as Record<string, unknown>).matchedMonthNoDecay = { heat: 59, movementCount: 2 };
    const invariantReport = verifyFeudHeatChainFixture(JSON.stringify(invariantMutated));
    expect(invariantReport.status).toBe("drift");
    expect(invariantReport.errors.some((entry) => entry.includes("Matched-month-no-decay invariant drift"))).toBe(true);
  });
});
