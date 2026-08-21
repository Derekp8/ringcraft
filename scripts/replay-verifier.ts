import { REPLAY_VERSION, RULESET_VERSION, choosePolicyAction, fnv1a32, hashMatchState, replayFromInputLog } from "../src/core";
import { M10_DECISION_LOG_SCHEMA, collectCorpusDecisions, normalizeFixtureEol } from "./m10-ai-corpus";
import type { DecisionLogFixture } from "./m10-ai-corpus";
import { M13_CAPTURED_POLICY, M13_TITLE_SHOT_CHAIN_SCHEMA, buildTitleShotChainEvidence, fixtureContentHash } from "./m13-title-shot-chain";
import type { TitleShotChainFixture } from "./m13-title-shot-chain";
import { M13_FEUD_HEAT_CHAIN_SCHEMA, buildFeudHeatChainEvidence, fixtureContentHash as feudFixtureContentHash } from "./m13-feud-heat-chain";
import type { FeudHeatChainFixture } from "./m13-feud-heat-chain";
import type { MatchState } from "../src/core";

/** Top-level keys of the exported replay document (see `exportReplayDocument`). */
export const REPLAY_SCHEMA_KEYS = ["replayVersion", "rulesetVersion", "dataHash", "config", "inputs", "expectedStateHash"] as const;

export interface ReplayVerificationReport {
  replayVersion: number | null;
  rulesetVersion: string | null;
  dataHash: string | null;
  expectedStateHash: string | null;
  actualStateHash: string | null;
  derivedDataHash: string | null;
  schemaMissing: string[];
  schemaUnexpected: string[];
  schemaTypeErrors: string[];
  errors: string[];
  status: "verified" | "drift";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Verifies one exported replay document against the current engine and reports
 * schema drift. Never throws: every failure is reported in `errors` with a
 * `status` of `"drift"` (unparsable JSON, missing/typed-wrong schema keys,
 * `replayVersion`/`rulesetVersion` drift, data-pack drift via the re-derived
 * `dataHash`, and the replayed-state hash against `expectedStateHash`).
 */
export function verifyReplayFile(raw: string): ReplayVerificationReport {
  const report: ReplayVerificationReport = {
    replayVersion: null,
    rulesetVersion: null,
    dataHash: null,
    expectedStateHash: null,
    actualStateHash: null,
    derivedDataHash: null,
    schemaMissing: [],
    schemaUnexpected: [],
    schemaTypeErrors: [],
    errors: [],
    status: "verified",
  };

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    report.errors.push(`Unparsable JSON: ${String(error)}`);
    report.status = "drift";
    return report;
  }
  if (!isObject(document)) {
    report.errors.push("Replay document is not a JSON object.");
    report.status = "drift";
    return report;
  }

  for (const key of REPLAY_SCHEMA_KEYS) {
    if (!(key in document)) report.schemaMissing.push(key);
  }
  for (const key of Object.keys(document)) {
    if (!(REPLAY_SCHEMA_KEYS as readonly string[]).includes(key)) report.schemaUnexpected.push(key);
  }

  const declared = (key: string): unknown => document[key];

  if (typeof declared("replayVersion") !== "number") report.schemaTypeErrors.push("replayVersion must be a number.");
  else {
    report.replayVersion = declared("replayVersion") as number;
    if (report.replayVersion !== REPLAY_VERSION) {
      report.errors.push(`replayVersion drift: declared ${report.replayVersion}, engine supports ${REPLAY_VERSION}.`);
    }
  }
  if (typeof declared("rulesetVersion") !== "string") report.schemaTypeErrors.push("rulesetVersion must be a string.");
  else {
    report.rulesetVersion = declared("rulesetVersion") as string;
    if (report.rulesetVersion !== RULESET_VERSION) {
      report.errors.push(`rulesetVersion drift: declared ${report.rulesetVersion}, engine is ${RULESET_VERSION}.`);
    }
  }
  if (typeof declared("dataHash") !== "string") report.schemaTypeErrors.push("dataHash must be a string.");
  else report.dataHash = declared("dataHash") as string;
  if (typeof declared("expectedStateHash") !== "string") report.schemaTypeErrors.push("expectedStateHash must be a string.");
  else report.expectedStateHash = declared("expectedStateHash") as string;
  if (!isObject(declared("config"))) report.schemaTypeErrors.push("config must be an object.");
  if (!Array.isArray(declared("inputs"))) report.schemaTypeErrors.push("inputs must be an array.");

  if (report.schemaTypeErrors.length) report.errors.push(...report.schemaTypeErrors);

  // A foreign replay or ruleset version is not executable evidence for the
  // current engine. Report that compatibility drift without spending seconds
  // reconstructing a match whose semantics are explicitly unsupported (or
  // producing a misleading current-engine hash for it). Data-hash drift still
  // replays below because the current engine can derive and report that exact
  // mismatch.
  const incompatibleVersion = report.replayVersion !== null && report.replayVersion !== REPLAY_VERSION
    || report.rulesetVersion !== null && report.rulesetVersion !== RULESET_VERSION;

  if (isObject(declared("config")) && Array.isArray(declared("inputs")) && !incompatibleVersion && !report.errors.some((line) => line.startsWith("Unparsable"))) {
    try {
      // replayFromInputLog reads only `config` and `inputLog` from its source; the
      // exported document is that subset, so cast the partial to the full state type.
      const replayed = replayFromInputLog({ config: declared("config"), inputLog: declared("inputs") } as unknown as MatchState);
      report.actualStateHash = hashMatchState(replayed);
      report.derivedDataHash = replayed.dataHash;
      if (report.expectedStateHash !== null && report.actualStateHash !== report.expectedStateHash) {
        report.errors.push(`Replay hash drift: expected ${report.expectedStateHash}, replayed ${report.actualStateHash}.`);
      }
      if (report.dataHash !== null && report.derivedDataHash !== report.dataHash) {
        report.errors.push(`Data pack drift: declared dataHash ${report.dataHash}, current engine derives ${report.derivedDataHash}.`);
      }
    } catch (error) {
      report.errors.push(`Replay failed against the current engine: ${String(error)}`);
    }
  }

  report.status = report.errors.length ? "drift" : "verified";
  return report;
}

/** Result of checking one respond-title-shot event chain fixture (an `m13-title-shot-chain-v1` fixture). */
export interface TitleShotChainVerificationReport {
  schema: string | null;
  capturedPolicy: string | null;
  fixtureHash: string | null;
  offerId: string | null;
  rollLine: string | null;
  grantLine: string | null;
  extraGrantLine: string | null;
  errors: string[];
  status: "verified" | "drift";
}

/**
 * Checks a respond-title-shot event chain fixture against the current engine's
 * campaign replay contract: the grant → decline and grant → accept chains, plus
 * the manual-booking leg (play the mandatory defense → grant an extra title
 * shot), must reproduce byte-identically from the pinned derivation — the offer
 * identity, the consolidated roll line, the grant/decline/accept event details,
 * the campaign hashes that form the chain links, the respond events' pre/post
 * state hashes, the mandatory defense scheduled on accept, and the extra-shot
 * grant line, defense outcome, and pre/post hashes. Never throws: every
 * failure is reported in `errors` with `status` `"drift"`.
 */
export function verifyTitleShotChainFixture(raw: string): TitleShotChainVerificationReport {
  const report: TitleShotChainVerificationReport = {
    schema: null,
    capturedPolicy: null,
    fixtureHash: null,
    offerId: null,
    rollLine: null,
    grantLine: null,
    extraGrantLine: null,
    errors: [],
    status: "verified",
  };

  let fixture: TitleShotChainFixture;
  try {
    fixture = JSON.parse(raw) as TitleShotChainFixture;
  } catch (error) {
    report.errors.push(`Unparsable title-shot chain JSON: ${String(error)}`);
    report.status = "drift";
    return report;
  }
  if (!isObject(fixture) || !isObject(fixture.derivation) || !isObject(fixture.evidence)) {
    report.errors.push("Title-shot chain fixture must be an object with derivation and evidence objects.");
    report.status = "drift";
    return report;
  }
  report.schema = typeof fixture.schema === "string" ? fixture.schema : null;
  report.capturedPolicy = typeof fixture.capturedPolicy === "string" ? fixture.capturedPolicy : null;
  report.offerId = fixture.evidence?.offer?.id ?? null;
  report.rollLine = typeof fixture.evidence?.rollLine === "string" ? fixture.evidence.rollLine : null;
  report.grantLine = typeof fixture.evidence?.grantLine === "string" ? fixture.evidence.grantLine : null;
  report.extraGrantLine = typeof fixture.evidence?.extraGrantLine === "string" ? fixture.evidence.extraGrantLine : null;
  if (fixture.schema !== M13_TITLE_SHOT_CHAIN_SCHEMA) report.errors.push(`Title-shot chain schema drift: declared ${String(fixture.schema)}, expected ${M13_TITLE_SHOT_CHAIN_SCHEMA}.`);
  if (fixture.capturedPolicy !== M13_CAPTURED_POLICY) report.errors.push(`Title-shot chain policy drift: declared ${String(fixture.capturedPolicy)}, expected ${M13_CAPTURED_POLICY}.`);
  if (typeof fixture.fixtureHash !== "string") {
    report.errors.push("Title-shot chain fixtureHash must be a string.");
  } else {
    report.fixtureHash = fixture.fixtureHash;
    const derivedHash = fixtureContentHash(fixture);
    if (derivedHash !== fixture.fixtureHash) report.errors.push(`Title-shot chain fixture integrity hash diverged: pinned ${fixture.fixtureHash}, got ${derivedHash}.`);
  }

  let actual: ReturnType<typeof buildTitleShotChainEvidence> | null = null;
  try {
    actual = buildTitleShotChainEvidence(fixture.derivation);
  } catch (error) {
    report.errors.push(`Title-shot chain re-derivation failed against the current engine: ${String(error)}`);
  }
  if (actual) {
    const evidence = fixture.evidence;
    const offer = actual.offer;
    // The chain links that provably hold: the decline path has no follow-on
    // transaction, so its event's post-state hash IS the declined campaign hash;
    // the accept path schedules the mandatory defense in a second transaction,
    // so the accept event's post-state hash is the intermediate respond-only
    // state (pinned against the re-derivation below, not the final hash).
    if (evidence.declineEvent?.preStateHash !== evidence.rolledCampaignHash) report.errors.push("Decline pre-state hash does not equal the rolled campaign hash.");
    if (evidence.declineEvent?.postStateHash !== evidence.declinedCampaignHash) report.errors.push("Decline post-state hash does not equal the declined campaign hash.");
    if (evidence.acceptEvent?.preStateHash !== evidence.rolledCampaignHash) report.errors.push("Accept pre-state hash does not equal the rolled campaign hash.");
    if (JSON.stringify(evidence.declineEvent) !== JSON.stringify(actual.declineEvent)) report.errors.push("Decline event pre/post hashes drift from the re-derived chain.");
    if (JSON.stringify(evidence.acceptEvent) !== JSON.stringify(actual.acceptEvent)) report.errors.push("Accept event pre/post hashes drift from the re-derived chain.");
    const replayedRollLine = actual.rollLine;
    if (replayedRollLine !== evidence.rollLine) report.errors.push(`Title-shot roll line drift: pinned ${String(evidence.rollLine)}, re-derived ${replayedRollLine}.`);
    // The grant-event line is the shared titleShotGrantLine helper's output: the
    // log records it and the decisions panel surfaces it, so the pinned grantLine
    // must equal the re-derived helper output AND appear inside the recorded
    // grant detail — one helper feeds both surfaces, and both must stay in sync.
    const replayedGrantLine = actual.grantLine;
    if (replayedGrantLine !== evidence.grantLine) report.errors.push(`Grant line drift: pinned ${String(evidence.grantLine)}, re-derived ${replayedGrantLine}.`);
    if (evidence.grantLine && !Array.isArray(evidence.grantDetail)) report.errors.push("Grant detail must be an array.");
    else if (evidence.grantLine && !evidence.grantDetail.includes(evidence.grantLine)) report.errors.push("Grant line missing from the recorded grant event detail (log/panel sync drift).");
    const pinnedOffer = evidence.offer ?? {};
    if (pinnedOffer.id !== offer.id) report.errors.push(`Title-shot offer id drift: pinned ${String(pinnedOffer.id)}, re-derived ${offer.id}.`);
    if (pinnedOffer.candidateId !== offer.candidateId) report.errors.push(`Title-shot candidate drift: pinned ${String(pinnedOffer.candidateId)}, re-derived ${offer.candidateId}.`);
    if (pinnedOffer.rawRoll !== offer.rawRoll || pinnedOffer.modifiedRoll !== offer.modifiedRoll) report.errors.push("Title-shot roll drift: raw or modified roll differs from the re-derived offer.");
    const pinnedModifiers = JSON.stringify(pinnedOffer.modifiers);
    const actualModifiers = JSON.stringify(offer.modifiers);
    if (pinnedModifiers !== actualModifiers) report.errors.push("Title-shot modifiers drift: pinned terms differ from the re-derived terms.");
    // The event details and the four campaign hashes must match the re-derivation exactly.
    if (JSON.stringify(evidence.grantDetail) !== JSON.stringify(actual.grantDetail)) report.errors.push("Grant event detail drift.");
    if (JSON.stringify(evidence.declineDetail) !== JSON.stringify(actual.declineDetail)) report.errors.push("Decline event detail drift.");
    if (JSON.stringify(evidence.acceptDetail) !== JSON.stringify(actual.acceptDetail)) report.errors.push("Accept event detail drift.");
    for (const key of ["initialCampaignHash", "rolledCampaignHash", "declinedCampaignHash", "acceptedCampaignHash"] as const) {
      if (evidence[key] !== actual[key]) report.errors.push(`${key} drift: pinned ${String(evidence[key])}, re-derived ${actual[key]}.`);
    }
    if (evidence.declineEvent?.preStateHash !== actual.rolledCampaignHash) report.errors.push("Decline pre-state hash does not match the re-derived rolled campaign hash.");
    if (evidence.acceptEvent?.preStateHash !== actual.rolledCampaignHash) report.errors.push("Accept pre-state hash does not match the re-derived rolled campaign hash.");
    if (JSON.stringify(evidence.scheduledDefense) !== JSON.stringify(actual.scheduledDefense)) report.errors.push("Scheduled mandatory defense drift.");
    // The manual-booking leg: the champion must complete the obligation by
    // playing the accepted mandatory defense, then the extra-shot grant must
    // reproduce — the grant line, the schedule event detail, the committed
    // defense outcome, and the pre/post hashes all pinned like the rolled path.
    for (const key of ["defendedCampaignHash", "extraGrantCampaignHash"] as const) {
      if (evidence[key] !== actual[key]) report.errors.push(`${key} drift: pinned ${String(evidence[key])}, re-derived ${actual[key]}.`);
    }
    if (JSON.stringify(evidence.defense) !== JSON.stringify(actual.defense)) report.errors.push("Defense outcome drift: the committed mandatory-defense result does not match the re-derived chain.");
    if (JSON.stringify(evidence.extraShot) !== JSON.stringify(actual.extraShot)) report.errors.push("Extra-shot schedule row drift: the manual-booking leg's match does not match the re-derived chain.");
    // The extra-shot grant line is the shared titleShotExtraGrantLine helper's
    // output, recorded on the schedule event — the manual path's twin of the
    // rolled grant-line sync invariant.
    const replayedExtraGrantLine = actual.extraGrantLine;
    if (replayedExtraGrantLine !== evidence.extraGrantLine) report.errors.push(`Extra-shot grant line drift: pinned ${String(evidence.extraGrantLine)}, re-derived ${replayedExtraGrantLine}.`);
    if (evidence.extraGrantLine && !Array.isArray(evidence.extraGrantDetail)) report.errors.push("Extra-shot grant detail must be an array.");
    else if (evidence.extraGrantLine && !evidence.extraGrantDetail.includes(evidence.extraGrantLine)) report.errors.push("Extra-shot grant line missing from the schedule event detail (manual log/panel sync drift).");
    if (JSON.stringify(evidence.extraGrantDetail) !== JSON.stringify(actual.extraGrantDetail)) report.errors.push("Extra-shot grant event detail drift.");
    if (evidence.extraGrantEvent?.preStateHash !== evidence.defendedCampaignHash) report.errors.push("Extra-shot grant pre-state hash does not equal the defended campaign hash.");
    if (JSON.stringify(evidence.extraGrantEvent) !== JSON.stringify(actual.extraGrantEvent)) report.errors.push("Extra-shot grant event pre/post hashes drift from the re-derived chain.");
  }

  report.status = report.errors.length ? "drift" : "verified";
  return report;
}

/** Result of checking one feud-heat event chain fixture (an `m13-feud-heat-chain-v1` fixture). */
export interface FeudHeatChainVerificationReport {
  schema: string | null;
  capturedPolicy: string | null;
  fixtureHash: string | null;
  feudId: string | null;
  heatLine: string | null;
  decayLine: string | null;
  errors: string[];
  status: "verified" | "drift";
}

/**
 * Checks a feud-heat event chain fixture against the current engine's campaign
 * replay contract: start-feud → a committed feud match → a cold month's
 * monthly decay must reproduce byte-identically from the pinned derivation —
 * the feud identity and start event, the committed match outcome and heat
 * movement, the matched-month-never-cools invariant, the decay movement and
 * its log line, and the campaign hashes that form the chain links. Never
 * throws: every failure is reported in `errors` with `status` `"drift"`.
 */
export function verifyFeudHeatChainFixture(raw: string): FeudHeatChainVerificationReport {
  const report: FeudHeatChainVerificationReport = {
    schema: null,
    capturedPolicy: null,
    fixtureHash: null,
    feudId: null,
    heatLine: null,
    decayLine: null,
    errors: [],
    status: "verified",
  };

  let fixture: FeudHeatChainFixture;
  try {
    fixture = JSON.parse(raw) as FeudHeatChainFixture;
  } catch (error) {
    report.errors.push(`Unparsable feud-heat chain JSON: ${String(error)}`);
    report.status = "drift";
    return report;
  }
  if (!isObject(fixture) || !isObject(fixture.derivation) || !isObject(fixture.evidence)) {
    report.errors.push("Feud-heat chain fixture must be an object with derivation and evidence objects.");
    report.status = "drift";
    return report;
  }
  report.schema = typeof fixture.schema === "string" ? fixture.schema : null;
  report.capturedPolicy = typeof fixture.capturedPolicy === "string" ? fixture.capturedPolicy : null;
  report.feudId = fixture.evidence?.feud?.id ?? null;
  report.heatLine = typeof fixture.evidence?.heatLine === "string" ? fixture.evidence.heatLine : null;
  report.decayLine = typeof fixture.evidence?.decayLine === "string" ? fixture.evidence.decayLine : null;
  if (fixture.schema !== M13_FEUD_HEAT_CHAIN_SCHEMA) report.errors.push(`Feud-heat chain schema drift: declared ${String(fixture.schema)}, expected ${M13_FEUD_HEAT_CHAIN_SCHEMA}.`);
  if (fixture.capturedPolicy !== M13_CAPTURED_POLICY) report.errors.push(`Feud-heat chain policy drift: declared ${String(fixture.capturedPolicy)}, expected ${M13_CAPTURED_POLICY}.`);
  if (typeof fixture.fixtureHash !== "string") {
    report.errors.push("Feud-heat chain fixtureHash must be a string.");
  } else {
    report.fixtureHash = fixture.fixtureHash;
    const derivedHash = feudFixtureContentHash(fixture);
    if (derivedHash !== fixture.fixtureHash) report.errors.push(`Feud-heat chain fixture integrity hash diverged: pinned ${fixture.fixtureHash}, got ${derivedHash}.`);
  }

  let actual: ReturnType<typeof buildFeudHeatChainEvidence> | null = null;
  try {
    actual = buildFeudHeatChainEvidence(fixture.derivation);
  } catch (error) {
    report.errors.push(`Feud-heat chain re-derivation failed against the current engine: ${String(error)}`);
  }
  if (actual) {
    const evidence = fixture.evidence;
    // The chain links that provably hold: the start-feud event's pre-state IS
    // the initial campaign hash and its post-state IS the feuded hash; the
    // January advance starts from the committed hash and lands on the Feb 1
    // hash; the March advance starts from the Feb 1 hash and lands on Mar 1.
    if (evidence.startFeudEvent?.preStateHash !== evidence.initialCampaignHash) report.errors.push("Start-feud pre-state hash does not equal the initial campaign hash.");
    if (evidence.startFeudEvent?.postStateHash !== evidence.feudedCampaignHash) report.errors.push("Start-feud post-state hash does not equal the feuded campaign hash.");
    if (evidence.febAdvanceEvent?.preStateHash !== evidence.committedCampaignHash) report.errors.push("February advance pre-state hash does not equal the committed campaign hash.");
    if (evidence.febAdvanceEvent?.postStateHash !== evidence.feb1CampaignHash) report.errors.push("February advance post-state hash does not equal the Feb 1 campaign hash.");
    if (evidence.marAdvanceEvent?.preStateHash !== evidence.feb1CampaignHash) report.errors.push("March advance pre-state hash does not equal the Feb 1 campaign hash.");
    if (evidence.marAdvanceEvent?.postStateHash !== evidence.mar1CampaignHash) report.errors.push("March advance post-state hash does not equal the Mar 1 campaign hash.");
    if (JSON.stringify(evidence.startFeudEvent) !== JSON.stringify(actual.startFeudEvent)) report.errors.push("Start-feud event pre/post hashes drift from the re-derived chain.");
    if (JSON.stringify(evidence.febAdvanceEvent) !== JSON.stringify(actual.febAdvanceEvent)) report.errors.push("February advance event pre/post hashes drift from the re-derived chain.");
    if (JSON.stringify(evidence.marAdvanceEvent) !== JSON.stringify(actual.marAdvanceEvent)) report.errors.push("March advance event pre/post hashes drift from the re-derived chain.");
    // The feud identity and the start-feud detail must match the re-derivation.
    if (JSON.stringify(evidence.feud) !== JSON.stringify(actual.feud)) report.errors.push("Feud identity drift: the pinned feud row differs from the re-derived feud.");
    if (JSON.stringify(evidence.startFeudDetail) !== JSON.stringify(actual.startFeudDetail)) report.errors.push("Start-feud event detail drift.");
    // The committed feud match: outcome, heat movement, and the log line.
    if (JSON.stringify(evidence.feudMatch) !== JSON.stringify(actual.feudMatch)) report.errors.push("Feud match outcome drift: the committed match result does not match the re-derived chain.");
    if (JSON.stringify(evidence.heatMovement) !== JSON.stringify(actual.heatMovement)) report.errors.push("Feud heat movement drift: the movement row differs from the re-derived chain.");
    const replayedHeatLine = actual.heatLine;
    if (replayedHeatLine !== evidence.heatLine) report.errors.push(`Feud heat line drift: pinned ${String(evidence.heatLine)}, re-derived ${replayedHeatLine}.`);
    if (evidence.heatLine && !actual.heatLine.includes(evidence.heatLine)) {
      report.errors.push("Feud heat line missing from the recorded commit detail (log/panel sync drift).");
    }
    // The matched month never cools: the feud competed in January, so heat is
    // unchanged at Feb 1 and only one movement row exists.
    if (JSON.stringify(evidence.matchedMonthNoDecay) !== JSON.stringify(actual.matchedMonthNoDecay)) report.errors.push("Matched-month-no-decay invariant drift: heat changed or decay ran despite the January feud match.");
    // The cold month's monthly decay: movement row, its log line, and the final feud state.
    if (JSON.stringify(evidence.decayMovement) !== JSON.stringify(actual.decayMovement)) report.errors.push("Monthly-decay movement drift: the decay row differs from the re-derived chain.");
    const replayedDecayLine = actual.decayLine;
    if (replayedDecayLine !== evidence.decayLine) report.errors.push(`Feud decay line drift: pinned ${String(evidence.decayLine)}, re-derived ${replayedDecayLine}.`);
    if (JSON.stringify(evidence.finalFeud) !== JSON.stringify(actual.finalFeud)) report.errors.push("Final feud state drift: heat, status, or match count differs from the re-derived chain.");
    // The six campaign hashes must match the re-derivation exactly.
    for (const key of ["initialCampaignHash", "feudedCampaignHash", "scheduledCampaignHash", "committedCampaignHash", "feb1CampaignHash", "mar1CampaignHash"] as const) {
      if (evidence[key] !== actual[key]) report.errors.push(`${key} drift: pinned ${String(evidence[key])}, re-derived ${actual[key]}.`);
    }
  }

  report.status = report.errors.length ? "drift" : "verified";
  return report;
}

/** Result of checking one career replay corpus (an M10 decision-log fixture). */
export interface CorpusVerificationReport {
  schema: string | null;
  capturedPolicy: string | null;
  fixtureHash: string | null;
  runs: number;
  decisionsReplayed: number;
  ruthlessRunPresent: boolean;
  ruthlessFinalStateHash: string | null;
  errors: string[];
  status: "verified" | "drift";
}

/**
 * Checks a career replay corpus (an `m10-ai-decision-log-v1` fixture) against
 * the current engine's replay contract: every run's decision sequence and
 * terminal `finalStateHash` must reproduce byte-identically from the pinned
 * config and roster. The selector is difficulty-aware — standard runs replay
 * under the deterministic v1 path, the seeded ruthless run under the 2-ply
 * policy — so the whole ladder is covered. Never throws: failures are reported
 * in `errors` with the run label and both hashes, and the report carries
 * `status` `"drift"`. Mirrors `verifyCorpusFixture` but returns a report
 * (like `verifyReplayFile`) instead of throwing on the first divergence.
 */
export function checkCareerReplayCorpus(raw: string): CorpusVerificationReport {
  const report: CorpusVerificationReport = {
    schema: null,
    capturedPolicy: null,
    fixtureHash: null,
    runs: 0,
    decisionsReplayed: 0,
    ruthlessRunPresent: false,
    ruthlessFinalStateHash: null,
    errors: [],
    status: "verified",
  };
  let fixture: DecisionLogFixture;
  try {
    fixture = JSON.parse(raw) as DecisionLogFixture;
  } catch (error) {
    report.errors.push(`Unparsable corpus JSON: ${String(error)}`);
    report.status = "drift";
    return report;
  }
  if (!isObject(fixture) || !Array.isArray(fixture.corpus) || !isObject(fixture.rosters)) {
    report.errors.push("Corpus fixture must be an object with a corpus array and a rosters map.");
    report.status = "drift";
    return report;
  }
  report.schema = typeof fixture.schema === "string" ? fixture.schema : null;
  report.capturedPolicy = typeof fixture.capturedPolicy === "string" ? fixture.capturedPolicy : null;
  // Normalize line endings before hashing so the reported identity is the same
  // on LF and CRLF checkouts (see normalizeFixtureEol).
  report.fixtureHash = fnv1a32(normalizeFixtureEol(raw));
  report.runs = fixture.corpus.length;
  if (fixture.schema !== M10_DECISION_LOG_SCHEMA) report.errors.push(`Corpus schema drift: declared ${String(fixture.schema)}, expected ${M10_DECISION_LOG_SCHEMA}.`);

  const difficultyAwareSelect = (state: MatchState, decision: NonNullable<MatchState["decision"]>): ReturnType<typeof choosePolicyAction> =>
    choosePolicyAction(state, decision, state.config.aiDifficulty ?? "standard");

  for (const record of fixture.corpus) {
    const roster = fixture.rosters[record.config.rosterKey];
    if (!roster || !Array.isArray(roster)) {
      report.errors.push(`${record.label}: roster key ${record.config.rosterKey} is missing from the fixture rosters.`);
      continue;
    }
    let replayed;
    try {
      replayed = collectCorpusDecisions(record.config, roster, difficultyAwareSelect);
    } catch (error) {
      report.errors.push(`${record.label}: replay failed against the current engine: ${String(error)}`);
      continue;
    }
    report.decisionsReplayed += replayed.entries.length;
    if (replayed.finalStateHash !== record.finalStateHash) {
      report.errors.push(`${record.label}: final state hash drift — golden ${record.finalStateHash}, replayed ${replayed.finalStateHash}.`);
    }
    if (record.config.aiDifficulty === "ruthless") {
      report.ruthlessRunPresent = true;
      report.ruthlessFinalStateHash = record.finalStateHash;
    }
  }

  report.status = report.errors.length ? "drift" : "verified";
  return report;
}
