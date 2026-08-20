import completedFixture from "../../fixtures/m5/example-career-save.json";
import inProgressFixture from "../../fixtures/m5/example-in-progress-save.json";
import { importCampaignJson } from "../core";
import type { CampaignState } from "../core";

function loadFixture(value: unknown): CampaignState {
  return importCampaignJson(JSON.stringify(value)).state;
}

export function loadCompletedM5Fixture(): CampaignState {
  return loadFixture(completedFixture);
}

export function loadInProgressM5Fixture(): CampaignState {
  return loadFixture(inProgressFixture);
}
