import { CAMPAIGN_RULESET_VERSION, CAMPAIGN_SCHEMA_VERSION, M5_DATA_HASH, M5_DATA_PACK_VERSION } from "./campaign-rules";
import { canonicalSerialize } from "./hash";
import { hashCampaignState, validateCampaignState } from "./campaign";
import type { CampaignState } from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface CampaignMigrationResult {
  state: CampaignState;
  fromVersion: string;
  toVersion: string;
  notices: string[];
}

export const CAMPAIGN_MIGRATIONS = Object.freeze({
  [CAMPAIGN_SCHEMA_VERSION]: (state: CampaignState): CampaignMigrationResult => ({
    state: structuredClone(state),
    fromVersion: CAMPAIGN_SCHEMA_VERSION,
    toVersion: CAMPAIGN_SCHEMA_VERSION,
    notices: [],
  }),
});

export function validateCampaignSave(value: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(value)) return ["campaign: expected JSON object."];
  if (value.schemaVersion !== CAMPAIGN_SCHEMA_VERSION) errors.push(`schemaVersion: unsupported ${String(value.schemaVersion)}; expected ${CAMPAIGN_SCHEMA_VERSION}.`);
  if (value.campaignRulesetVersion !== CAMPAIGN_RULESET_VERSION) errors.push(`campaignRulesetVersion: incompatible ${String(value.campaignRulesetVersion)}; expected ${CAMPAIGN_RULESET_VERSION}.`);
  if (value.dataPackVersion !== M5_DATA_PACK_VERSION) errors.push(`dataPackVersion: incompatible ${String(value.dataPackVersion)}; expected ${M5_DATA_PACK_VERSION}.`);
  if (value.dataHash !== M5_DATA_HASH) errors.push(`dataHash: incompatible ${String(value.dataHash)}; expected ${M5_DATA_HASH}. No silent recomputation is allowed.`);
  for (const key of ["campaignId", "name", "startDate", "currentDate", "playerEntrantId", "playerDivision"] as const) if (typeof value[key] !== "string" || !value[key]) errors.push(`${key}: required non-empty string.`);
  for (const key of ["roster", "teams", "rankings", "monthlyRatingPoints", "titles", "rng"] as const) if (!isObject(value[key])) errors.push(`${key}: expected object.`);
  for (const key of ["rankingHistory", "schedule", "titleShotOffers", "vacancies", "injuries", "matchHistory", "appliedMatchIds", "events"] as const) if (!Array.isArray(value[key])) errors.push(`${key}: expected array.`);
  if (value.finance !== undefined && !isObject(value.finance)) errors.push("finance: expected object.");
  const booking = value.booking;
  if (booking !== undefined && !isObject(booking)) errors.push("booking: expected object.");
  if (booking !== undefined && isObject(booking)) {
    if (!Array.isArray(booking.feuds)) errors.push("booking.feuds: expected array.");
    if (!Array.isArray(booking.feudHistory)) errors.push("booking.feudHistory: expected array.");
    if (!Array.isArray(booking.monthSuggestions)) errors.push("booking.monthSuggestions: expected array.");
  }
  const negotiation = value.negotiation;
  if (negotiation !== undefined && !isObject(negotiation)) errors.push("negotiation: expected object.");
  if (negotiation !== undefined && isObject(negotiation)) {
    if (!Array.isArray(negotiation.offers)) errors.push("negotiation.offers: expected array.");
    if (!Array.isArray(negotiation.history)) errors.push("negotiation.history: expected array.");
  }
  if (errors.length) return errors;
  try { errors.push(...validateCampaignState(value as unknown as CampaignState)); }
  catch (error) { errors.push(`campaign: structural validation failed: ${String(error)}`); }
  return errors;
}

export function serializeCampaign(state: CampaignState, pretty = true): string {
  const errors = validateCampaignSave(state);
  if (errors.length) throw new Error(`Cannot export invalid campaign:\n${errors.join("\n")}`);
  return pretty ? JSON.stringify(state, null, 2) : canonicalSerialize(state);
}

export function importCampaignJson(json: string): CampaignMigrationResult {
  let parsed: unknown;
  try { parsed = JSON.parse(json); }
  catch (error) { throw new Error(`Campaign JSON is corrupt or truncated: ${String(error)}`); }
  if (!isObject(parsed)) throw new Error("Campaign import rejected: expected an object.");
  const version = String(parsed.schemaVersion ?? "missing");
  const migration = CAMPAIGN_MIGRATIONS[version as keyof typeof CAMPAIGN_MIGRATIONS];
  if (!migration) throw new Error(`Campaign import rejected: unsupported schema ${version}.`);
  const errors = validateCampaignSave(parsed);
  if (errors.length) throw new Error(`Campaign import rejected:\n${errors.join("\n")}`);
  const result = migration(parsed as unknown as CampaignState);
  const afterErrors = validateCampaignSave(result.state);
  if (afterErrors.length) throw new Error(`Campaign migration produced invalid state:\n${afterErrors.join("\n")}`);
  return result;
}

export function verifyCampaignRoundTrip(state: CampaignState): { valid: boolean; beforeHash: string; afterHash: string; bytes: number } {
  const json = serializeCampaign(state, false);
  const imported = importCampaignJson(json).state;
  const beforeHash = hashCampaignState(state);
  const afterHash = hashCampaignState(imported);
  return { valid: beforeHash === afterHash && serializeCampaign(imported, false) === json, beforeHash, afterHash, bytes: new TextEncoder().encode(json).length };
}
