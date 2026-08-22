import { describe, expect, it } from "vitest";
import { loadCompletedM5Fixture } from "../src/ui/playtest-fixtures";
import {
  CAMPAIGN_SAVE_PREFIX,
  applySaveBundlePlan,
  createSave,
  planSaveBundleImport,
  readSave,
} from "../src/ui/save-manager";
import type { CampaignSave, SaveStorage } from "../src/ui/save-manager";

class MemoryStorage implements SaveStorage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
}

function bundle(record: CampaignSave): string {
  return JSON.stringify({
    schema: "asw91-campaign-save-bundle-v1",
    exportedAt: "2099-01-02T00:00:00.000Z",
    saves: [{ key: `${CAMPAIGN_SAVE_PREFIX}${record.saveId}`, value: JSON.stringify(record) }],
  });
}

describe("M16 save/recovery closure", () => {
  it("fails closed when a validated merge target disappears before apply", () => {
    const campaign = loadCompletedM5Fixture();
    const local = new MemoryStorage();
    const remote = new MemoryStorage();

    const localMeta = createSave(campaign, "Local merge target", local);
    const remoteMeta = createSave(campaign, "Incoming snapshot", remote);
    const incoming: CampaignSave = {
      ...readSave(remoteMeta.saveId, remote)!,
      createdAt: "2099-01-01T00:00:00.000Z",
      updatedAt: "2099-01-02T00:00:00.000Z",
    };

    // Normalize the local timestamp so the incoming snapshot is unambiguously newer.
    const localRecord = readSave(localMeta.saveId, local)!;
    local.setItem(`${CAMPAIGN_SAVE_PREFIX}${localMeta.saveId}`, JSON.stringify({
      ...localRecord,
      createdAt: "2099-01-01T00:00:00.000Z",
      updatedAt: "2099-01-01T00:00:00.000Z",
    }));

    const plan = planSaveBundleImport(bundle(incoming), local);
    expect(plan.totals).toEqual({ imported: 0, merged: 1, keptLocal: 0, skipped: 0 });

    // Simulate the local merge target being deleted after the user reviewed the preview.
    local.removeItem(`${CAMPAIGN_SAVE_PREFIX}${localMeta.saveId}`);
    const result = applySaveBundlePlan(plan, local);

    expect(result).toEqual({ imported: 0, merged: 0, keptLocal: 0, skipped: 1 });
    expect(local.length).toBe(0);
    expect(local.getItem(`${CAMPAIGN_SAVE_PREFIX}${incoming.saveId}`)).toBeNull();
  });
});
