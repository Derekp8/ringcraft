import { describe, expect, it } from "vitest";
import {
  autoAllocateCreationPoints,
  createCampaign,
  createCreationSession,
  finalizeCreationSession,
  rollCreationHistory,
  rollCreationStature,
  setCreationIdentity,
  setCreationSide,
} from "../src/core";
import type { CampaignState, WrestlerCareerRecord } from "../src/core";
import {
  CAMPAIGN_SAVE_PREFIX,
  SAVE_BUNDLE_SCHEMA,
  createSave,
  planSaveBundleImport,
  readSave,
} from "../src/ui/save-manager";
import type { CampaignSave, SaveStorage } from "../src/ui/save-manager";

const T1 = "2099-01-01T00:00:00.000Z";

function storage(): SaveStorage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    getItem(key: string) { return map.get(key) ?? null; },
    setItem(key: string, value: string) { map.set(key, value); },
    removeItem(key: string) { map.delete(key); },
    key(index: number) { return [...map.keys()][index] ?? null; },
  };
}

function record(seed: number, index: number): WrestlerCareerRecord {
  let session = createCreationSession(seed + index);
  session = setCreationIdentity(session, { name: `PWA-C1 Wrestler ${index}`, epithet: "QA", affiliation: "PWA-C1" });
  session = setCreationSide(session, index % 2 ? "rulebreaker" : "fan-favorite");
  session = rollCreationStature(session);
  session = rollCreationHistory(session);
  session = autoAllocateCreationPoints(session);
  return finalizeCreationSession(session).finalized!;
}

function campaign(): CampaignState {
  const seed = 73191;
  const roster = Array.from({ length: 4 }, (_, index) => record(seed, index));
  return createCampaign({
    name: "PWA-C1 Remote Validation",
    seed,
    startDate: "1991-01-01",
    roster,
    playerEntrantId: roster[0].id,
    playerDivision: "singles",
  });
}

function validSave(): CampaignSave {
  const source = storage();
  const meta = createSave(campaign(), "Remote validation", source);
  const saved = readSave(meta.saveId, source)!;
  return {
    ...saved,
    saveId: "remote-validation",
    createdAt: T1,
    updatedAt: T1,
  };
}

function rejectionReason(save: CampaignSave): string {
  const plan = planSaveBundleImport(JSON.stringify({
    schema: SAVE_BUNDLE_SCHEMA,
    exportedAt: T1,
    saves: [{ key: `${CAMPAIGN_SAVE_PREFIX}${save.saveId}`, value: JSON.stringify(save) }],
  }), storage());
  expect(plan.totals).toEqual({ imported: 0, merged: 0, keptLocal: 0, skipped: 1 });
  expect(plan.rows).toHaveLength(1);
  expect(plan.rows[0].outcome).toBe("skipped");
  return plan.rows[0].reason;
}

describe("PWA-C1 remote conflict validation diagnostics", () => {
  it("reports malformed campaignJson precisely", () => {
    const save = { ...validSave(), campaignJson: "{" };
    expect(rejectionReason(save)).toMatch(/Campaign payload failed validation:.*corrupt or truncated/i);
  });

  it("reports wrapper/inner campaignId mismatch precisely", () => {
    const save = { ...validSave(), campaignId: "foreign-campaign" };
    expect(rejectionReason(save)).toMatch(/does not match inner campaign/i);
  });

  it("reports an unsupported inner Campaign schema precisely", () => {
    const save = validSave();
    const inner = JSON.parse(save.campaignJson) as Record<string, unknown>;
    inner.schemaVersion = "pwa-c1-foreign-schema";
    save.campaignJson = JSON.stringify(inner);
    expect(rejectionReason(save)).toMatch(/unsupported schema pwa-c1-foreign-schema/i);
  });

  it("reports malformed save timestamps precisely", () => {
    const save = { ...validSave(), updatedAt: "not-a-timestamp" };
    expect(rejectionReason(save)).toMatch(/timestamps are malformed or non-canonical/i);
  });

  it("reports invalid Campaign state precisely", () => {
    const save = validSave();
    const inner = JSON.parse(save.campaignJson) as Record<string, unknown>;
    inner.playerEntrantId = "";
    save.campaignJson = JSON.stringify(inner);
    expect(rejectionReason(save)).toMatch(/playerEntrantId: required non-empty string/i);
  });
});
