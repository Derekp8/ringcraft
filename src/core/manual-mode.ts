import type { CampaignConfig, CampaignState, MatchSetup, MatchState } from "./types";

export const STRICT_MANUAL_PROFILE_ID = "strict-manual-derived-v1" as const;

export interface StrictManualViolation {
  field: string;
  detail: string;
}

function violation(field: string, detail: string): StrictManualViolation {
  return { field, detail };
}

/**
 * Strict Manual Mode is deliberately derived from already-persisted settings.
 * No campaign/save schema field is added: existing extension-off campaigns
 * remain byte-identical, while the profile can still be recomputed after every
 * save/import from the authoritative persisted configuration.
 */
export function strictManualCampaignConfigViolations(config: CampaignConfig): StrictManualViolation[] {
  const violations: StrictManualViolation[] = [];
  if (config.postMatchInjuryPolicy && config.postMatchInjuryPolicy !== "off") {
    violations.push(violation("postMatchInjuryPolicy", "Optional post-match D20 injuries are an adjudicated extension."));
  }
  if (config.variety && config.variety !== "standard") {
    violations.push(violation("variety", "Cage/ladder varieties are digital-only adjudicated extensions."));
  }
  if (config.financePolicy) violations.push(violation("financePolicy", "Contracts/finance/popularity are an adjudicated extension."));
  if (config.contracts?.length) violations.push(violation("contracts", "Starting contracts require the finance extension."));
  if (config.chemistry?.length) violations.push(violation("chemistry", "Chemistry pairs are an adjudicated extension."));
  if (config.negotiationPolicy) violations.push(violation("negotiationPolicy", "Contract negotiation is an adjudicated extension."));
  if (config.renewalStrategy && config.renewalStrategy !== "expiring-salary") {
    violations.push(violation("renewalStrategy", "Curve-fair renewal is an adjudicated extension."));
  }
  if (config.bookingPolicy) violations.push(violation("bookingPolicy", "Feud/booking policy is an adjudicated extension."));
  if (config.feuds?.length) violations.push(violation("feuds", "Starting feuds require the booking extension."));
  return violations;
}

export function strictManualCampaignStateViolations(state: CampaignState): StrictManualViolation[] {
  const violations: StrictManualViolation[] = [];
  if (state.postMatchInjuryPolicy && state.postMatchInjuryPolicy !== "off") {
    violations.push(violation("postMatchInjuryPolicy", "Optional post-match D20 injuries are enabled."));
  }
  if (state.variety && state.variety !== "standard") violations.push(violation("variety", "A non-standard match variety is enabled."));
  if (state.financePolicy || state.finance) violations.push(violation("financePolicy", "Finance/popularity extension state is present."));
  if (state.negotiationPolicy || state.negotiation) violations.push(violation("negotiationPolicy", "Negotiation extension state is present."));
  if (state.renewalStrategy && state.renewalStrategy !== "expiring-salary") violations.push(violation("renewalStrategy", "Curve-fair renewal strategy is enabled."));
  if (state.bookingPolicy || state.booking) violations.push(violation("bookingPolicy", "Feud/booking extension state is present."));
  return violations;
}

export function strictManualMatchSetupViolations(setup: MatchSetup): StrictManualViolation[] {
  return setup.variety && setup.variety !== "standard"
    ? [violation("variety", "Strict Manual Mode permits only the standard match variety.")]
    : [];
}

export function strictManualMatchStateViolations(state: MatchState): StrictManualViolation[] {
  return state.config.variety && state.config.variety !== "standard"
    ? [violation("config.variety", "Strict Manual Mode permits only the standard match variety.")]
    : [];
}

export function isStrictManualCampaign(state: CampaignState): boolean {
  return strictManualCampaignStateViolations(state).length === 0;
}

export function isStrictManualMatch(state: MatchState): boolean {
  return strictManualMatchStateViolations(state).length === 0;
}

export function assertStrictManualCampaignConfig(config: CampaignConfig): void {
  const violations = strictManualCampaignConfigViolations(config);
  if (violations.length) throw new Error(`Strict Manual Mode rejected configuration: ${violations.map((entry) => `${entry.field}: ${entry.detail}`).join(" | ")}`);
}

export function assertStrictManualMatchSetup(setup: MatchSetup): void {
  const violations = strictManualMatchSetupViolations(setup);
  if (violations.length) throw new Error(`Strict Manual Mode rejected match setup: ${violations.map((entry) => `${entry.field}: ${entry.detail}`).join(" | ")}`);
}
