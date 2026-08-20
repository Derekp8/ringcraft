export type TeamId = "player" | "ai";
export type WrestlerId = string;
export type Side = "fan-favorite" | "rulebreaker";
export type Pool = "damage" | "endurance";
export type MatchMode = "singles" | "tag";
export type ManeuverKind = "hold" | "strike";
export type RingLocation = "ring" | "apron" | "floor";

/** Visible AI opposition difficulty. `undefined`/absent is equivalent to `"standard"`. */
export type AiDifficulty = "novice" | "standard" | "veteran" | "ruthless";

/** Match variety (M11). `undefined`/absent is equivalent to `"standard"` and hashes byte-identically to pre-M11 matches. */
export const MATCH_VARIETIES = ["standard", "cage", "ladder"] as const;
export type MatchVariety = (typeof MATCH_VARIETIES)[number];

/**
 * M11 escape/retrieval tuning (balance-gate amendment, M11-ADJ-02): a fresh
 * opponent can haul a climber back down, so the cage escape and ladder
 * retrieval checks are legal only once the defender has taken at least
 * `ESCAPE_LEGALITY_THRESHOLD` damage, and each check carries a flat
 * `ESCAPE_DIFFICULTY` climb penalty. Damage-taken terms use the *taken* pool
 * (starting minus remaining), so a beaten defender helps the climb and a
 * beaten climber hurts it.
 */
export const ESCAPE_DIFFICULTY = 5;
export const ESCAPE_LEGALITY_THRESHOLD = 15;

/** Runtime ladder state; `undefined` while no ladder is set up (never `null`, so standard matches hash unchanged). */
export interface LadderState {
  setById: WrestlerId;
  setAtTick: number;
}

export interface DiceExpression {
  dice: number;
  sides: number;
  flat: number;
}

export interface ManeuverDefinition {
  id: string;
  name: string;
  kind: ManeuverKind;
  minAttribute: number;
  damage: DiceExpression;
  endCost: number;
  listedCost: number;
  usesDamageBonus: boolean;
  breakRating?: number;
  submission?: boolean;
  illegal?: boolean;
  whipEligible?: boolean;
  finisher?: boolean;
  throwsOut?: boolean;
  custom?: boolean;
  sourcePage?: number;
}

export interface Attributes {
  pow: number;
  agi: number;
  qui: number;
  tec: number;
  end: number;
}

export interface SkillLevels {
  breakHold: number;
  distractReferee: number;
  dodge: number;
  escapePin: number;
  illegalPin: number;
  irishWhip: number;
  pinInterference: number;
  tagTeam: number;
  charm: number;
}

export type DrawbackDefinition =
  | { type: "egotist"; damageThreshold: 15 | 20 | 25; rollThreshold: 9 | 12 | 15; awardedPoints?: number }
  | { type: "glass-jaw"; damageThreshold: 20 | 25 | 30; rollThreshold: 9 | 12 | 15; awardedPoints?: number }
  | { type: "old-injury"; damageThreshold: 20 | 25 | 30; rollThreshold: 9 | 12 | 15; awardedPoints?: number }
  | { type: "stupid-moves"; intervalMinutes: 1 | 2 | 5; rollThreshold: 9 | 12 | 15; awardedPoints?: number };

export interface WrestlerDefinition {
  id: WrestlerId;
  teamId: TeamId;
  name: string;
  epithet: string;
  side: Side;
  weight: number;
  attributes: Attributes;
  maneuverLevels: Record<string, number>;
  skills: SkillLevels;
  drawbacks: DrawbackDefinition[];
  fame: number;
  heightInches?: number;
  age?: number;
  careerWp?: number;
  sourceRecordId?: string;
  customManeuvers?: Record<string, ManeuverDefinition>;
}

export type RosterRegistry = Record<WrestlerId, WrestlerDefinition>;

export interface PriorTitle {
  id: string;
  label: string;
  category: "world-heavyweight" | "world-tag" | "singles" | "tag";
  fame: number;
  lightHeavyweight: boolean;
  circuitId: string;
}

export interface PreviousExperienceRoll {
  federationRoll: number;
  circuitId: string | null;
  circuitLabel: string;
  championshipRoll?: number;
  championshipTotal?: number;
  rerolls: number[];
  title?: PriorTitle;
}

export interface CareerHistory {
  debutAge: number;
  currentAge: number;
  previousExperience: PreviousExperienceRoll[];
  debutRoll: number;
  debutTotal: number;
  debutResult: "loss-pin-submission" | "loss-dq" | "double-dq" | "win-dq" | "win-pin-submission";
  priorTitles: PriorTitle[];
}

export interface WrestlerCareerRecord {
  schemaVersion: "asw91-wrestler-v1";
  rulesetVersion: string;
  id: string;
  name: string;
  epithet: string;
  side: Side;
  affiliation: string;
  heightInches: number;
  weight: number;
  attributes: Attributes;
  maneuverLevels: Record<string, number>;
  customManeuvers: Record<string, ManeuverDefinition>;
  skills: SkillLevels;
  drawbacks: DrawbackDefinition[];
  history: CareerHistory;
  fame: number;
  careerWp: number;
  creation: {
    seed: number;
    physicalPointTotal: number;
    baseAttributes: Attributes;
    baseSkillPoints: number;
    priorTitlePoints: number;
    drawbackPoints: number;
    spentSkillPoints: number;
  };
}

export interface CreationEvent {
  sequence: number;
  type: string;
  input: Record<string, unknown>;
  summary: string;
  detail: string[];
  dice: DieRoll[];
  preStateHash: string;
  postStateHash: string;
}

export interface CreationSession {
  schemaVersion: "asw91-creation-session-v1";
  rulesetVersion: string;
  seed: number;
  rng: RngState;
  name: string;
  epithet: string;
  affiliation: string;
  side: Side;
  physicalPointTotal: number;
  attributes: Attributes;
  heightInches: number | null;
  weight: number | null;
  history: CareerHistory | null;
  maneuverLevels: Record<string, number>;
  customManeuvers: Record<string, ManeuverDefinition>;
  skills: SkillLevels;
  drawbacks: DrawbackDefinition[];
  events: CreationEvent[];
  finalized: WrestlerCareerRecord | null;
}

export type ProgressionIntent =
  | { type: "award-match-wp"; award: MatchWpInput }
  | { type: "increase-attribute"; attribute: keyof Attributes }
  | { type: "increase-skill"; skill: keyof SkillLevels }
  | { type: "increase-maneuver"; maneuverId: string }
  | { type: "reduce-drawback"; drawbackType: DrawbackDefinition["type"]; replacement: DrawbackDefinition | null };

export interface ProgressionEvent {
  sequence: number;
  type: ProgressionIntent["type"];
  intent: ProgressionIntent;
  summary: string;
  detail: string[];
  preStateHash: string;
  postStateHash: string;
}

export interface ProgressionState {
  schemaVersion: "asw91-progression-v1";
  initialRecord: WrestlerCareerRecord;
  record: WrestlerCareerRecord;
  events: ProgressionEvent[];
}

export interface MatchWpInput {
  result: "win" | "loss" | "draw";
  method: "pin" | "submission" | "disqualification" | "countout" | "time-limit-draw" | "escape" | "retrieval";
  ownWp: number | number[];
  opponentWp: number | number[];
  titleCategory?: "world-heavyweight" | "international" | "world-tag" | "american-tag" | "television";
  titleWonOrRetained?: boolean;
}

export interface MatchWpAward {
  amount: number;
  ownComparisonWp: number;
  opponentComparisonWp: number;
  relation: "stronger" | "weaker" | "even";
  formula: string;
}

export interface ManeuverDraft {
  id: string;
  name: string;
  kind: ManeuverKind;
  minAttribute: number;
  damageDice: number;
  damageFlat: number;
  endCost: number;
  usesDamageBonus: boolean;
  breakRating?: number;
  submission?: boolean;
  illegal?: boolean;
  whipEligible?: boolean;
  finisher?: boolean;
  throwsOut?: boolean;
}

export interface WrestlerRuntime {
  id: WrestlerId;
  currentDamage: number;
  currentEndurance: number;
  charmRemaining: number;
  matchAvModifier: number;
  matchDvModifier: number;
  halfDvForMatch: boolean;
  stunnedUntilTick: number;
  knockedOutUntilTick: number | null;
  knockedOutForMatch: boolean;
  skipActivePhases: number;
  nextAttackAvBonus: number;
  nextAttackAvBonusReadyTick: number;
  nextDefenseDvPenalty: number;
  nextDefenseDvPenaltyReadyTick: number;
  injuryWeeks: number;
  location: RingLocation;
  thrownOutAtTick: number | null;
  damageTakenThisPhase: number;
  dodgingUntilTick: number;
  egotistPosing: boolean;
  stupidMovesActive: boolean;
  lastStupidMovesCheckMinute: number;
  outsideActionUsedTick: number | null;
  actedTick: number | null;
}

export interface TeamRuntime {
  id: TeamId;
  members: WrestlerId[];
  legalInRingId: WrestlerId;
  illegalEntrantId: WrestlerId | null;
  entryEligibleId: WrestlerId | null;
  exitDeadlineTick: number | null;
}

export interface HoldState {
  holderId: WrestlerId;
  defenderId: WrestlerId;
  maneuverId: string;
  failedEscapes: number;
  criticalEscapePenalty: number;
}

export interface MomentumState {
  ownerId: WrestlerId;
  sourceWhipperId: WrestlerId;
  expiresAtTick: number;
}

export interface RefereeState {
  level: number;
  cumulativeModifier: number;
  distractedUntilTick: number;
  knockedOutUntilTick: number;
  rollPenalty: number;
  rollPenaltyUntilTick: number;
}

export interface RngState {
  algorithm: "xorshift32-v1";
  initialSeed: number;
  state: number;
  scriptedRolls: number[];
  scriptedIndex: number;
}

export interface DieRoll {
  label: string;
  sides: number;
  result: number;
}

export interface MatchResult {
  winnerTeamId: TeamId | null;
  winnerId: WrestlerId | null;
  method: "pin" | "submission" | "disqualification" | "countout" | "time-limit-draw" | "escape" | "retrieval";
  summary: string;
}

export type DoubleTeamSequence = "two-strikes" | "shared-whip" | "hold-strike";

export type Intent =
  | { type: "attack"; maneuverId: string; attackCharm: number; releaseHold?: boolean; useMomentum?: boolean }
  | { type: "irish-whip"; strikeManeuverId: string; attackCharm: number; releaseHold?: boolean }
  | { type: "choose-damage-charm"; charm: number }
  | { type: "escape-hold"; charm: number }
  | { type: "maintain-hold"; useRopes: boolean }
  | { type: "recover"; pool: Pool; charm: number; free?: boolean; outside?: boolean }
  | { type: "pin"; illegal: boolean; automatic?: boolean }
  | { type: "submission"; automatic?: boolean }
  | { type: "dodge-commit"; dodge: boolean }
  | { type: "tag"; charm: number }
  | { type: "double-team"; sequence: DoubleTeamSequence; firstManeuverId: string; secondManeuverId: string }
  | { type: "distract-referee"; charm: number }
  | { type: "pin-interference"; target: "pin" | "hold"; charm: number }
  | { type: "enter-ring" }
  | { type: "exit-ring" }
  | { type: "reenter"; attackManeuverId?: string }
  | { type: "decline-followup" }
  | { type: "decline-interference" }
  | { type: "cage-escape"; charm: number }
  | { type: "set-up-ladder" }
  | { type: "climb-retrieve"; charm: number }
  | { type: "knock-ladder" };

export interface LegalAction {
  key: string;
  label: string;
  detail: string;
  intent: Intent;
  estimatedUtility?: number;
}

export interface DecisionState {
  actorId: WrestlerId;
  completesActivationFor: WrestlerId;
  kind:
    | "turn"
    | "dodge-commit"
    | "damage-charm"
    | "hold-escape"
    | "pin-followup"
    | "submission-followup"
    | "interference"
    | "bonus-attack"
    | "knockout-pin"
    | "tag-double-team"
    | "universal-recovery"
    | "outside-recovery";
  prompt: string;
  actions: LegalAction[];
}

export interface CriticalEffectState {
  additionalDamageDice: number;
  damageMultiplier: number;
  bonusAttack: boolean;
  bonusAttackAv: number;
  nextActivationAvBonus: number;
  automaticSubmission: boolean;
  knockoutPin: boolean;
}

export type PendingAction =
  | {
      kind: "attack-damage";
      actorId: WrestlerId;
      defenderId: WrestlerId;
      maneuverId: string;
      preStateHash: string;
      dice: DieRoll[];
      detail: string[];
      critical: CriticalEffectState;
      bonusDamageDice: number;
      consumeMomentum: boolean;
      useRopes: boolean;
      completesActivationFor: WrestlerId;
      suppressFollowups: boolean;
    }
  | {
      kind: "pin";
      pinnerId: WrestlerId;
      defenderId: WrestlerId;
      completesActivationFor: WrestlerId;
      illegal: boolean;
      automatic: boolean;
      recentDamage: number;
    }
  | {
      kind: "submission";
      attackerId: WrestlerId;
      defenderId: WrestlerId;
      completesActivationFor: WrestlerId;
      automatic: boolean;
      recentDamage: number;
    };

export interface ResolvedEvent {
  sequence: number;
  tick: number;
  minute: number;
  phase: number;
  actorId: WrestlerId | "system";
  type: string;
  summary: string;
  detail: string[];
  dice: DieRoll[];
  preStateHash: string;
  postStateHash: string;
}

export interface MatchConfiguration {
  seed: number;
  timeLimitMinutes: number;
  mode: MatchMode;
  titleModifier: 0 | 1 | 3 | 5;
  playerRecoveryPolicy: "lowest-percent" | "damage" | "endurance";
  aiRecoveryPolicy: "lowest-percent" | "damage" | "endurance";
  scenarioId: string | null;
  scriptedRolls?: number[];
  /** Visible AI opposition difficulty; part of the replay contract via `hashMatchState`. Absent equals `standard`. */
  aiDifficulty?: AiDifficulty;
  /** Match variety (M11); absent equals `standard` and hashes byte-identically to pre-M11 matches. */
  variety?: MatchVariety;
  roster: RosterRegistry;
  teamMembers: Record<TeamId, WrestlerId[]>;
}

export type MatchSetup = Partial<Omit<MatchConfiguration, "roster" | "teamMembers">> & {
  roster?: RosterRegistry;
  teamMembers?: Partial<Record<TeamId, WrestlerId[]>>;
};

export interface MatchState {
  rulesetId: "classic-1991-vertical-slice";
  rulesetVersion: string;
  dataHash: string;
  roster: RosterRegistry;
  maneuvers: Record<string, ManeuverDefinition>;
  config: MatchConfiguration;
  rng: RngState;
  minute: number;
  phase: number;
  tick: number;
  activeWrestlerIds: WrestlerId[];
  initiative: WrestlerId[];
  phaseQueue: WrestlerId[];
  freeRecoveryQueue: WrestlerId[];
  phaseEndProcessed: boolean;
  processedThisPhase: WrestlerId[];
  currentActorId: WrestlerId | null;
  wrestlers: Record<WrestlerId, WrestlerRuntime>;
  teams: Record<TeamId, TeamRuntime>;
  hold: HoldState | null;
  momentum: MomentumState | null;
  /** M11 ladder runtime state; `undefined` unless a ladder match has a ladder set up (never `null`). */
  ladder?: LadderState;
  referee: RefereeState;
  dodgeWindowResolved: boolean;
  decision: DecisionState | null;
  pendingAction: PendingAction | null;
  result: MatchResult | null;
  events: ResolvedEvent[];
  inputLog: Intent[];
  nonCanonical: boolean;
}

export type CampaignDivision = "singles" | "tag";
export type CampaignTitleId = "world-heavyweight" | "international" | "television" | "world-tag" | "american-tag";
export type CampaignEntrantId = string;

export interface PersistentTeam {
  id: CampaignEntrantId;
  name: string;
  memberIds: [string, string];
  side: Side;
  active: boolean;
  careerWp: number;
  currentRank: number | null;
  titleIds: CampaignTitleId[];
  titleShotHistory: Array<{ titleId: CampaignTitleId; month: string; accepted: boolean; matchId?: string }>;
  matchHistory: string[];
}

export interface RankingEntry {
  entrantId: CampaignEntrantId;
  rank: number;
  priorRank: number;
  matchPoints: number;
  priorRankBonus: number;
  totalPoints: number;
  totalWp: number;
  tiebreakRolls: number[];
}

export interface RankingTable {
  id: string;
  month: string;
  division: CampaignDivision;
  championId: CampaignEntrantId | null;
  entries: RankingEntry[];
  finalizedAt: string;
  formula: string;
}

export interface TitleState {
  id: CampaignTitleId;
  name: string;
  division: CampaignDivision;
  hierarchy: number;
  holderId: CampaignEntrantId | null;
  status: "active" | "vacant";
  wonDate: string | null;
  lastDefenseDate: string | null;
  obligationMonth: string;
  requiredDefenses: number;
  completedDefenses: number;
  shotsReceived: Record<string, CampaignEntrantId[]>;
  history: Array<{ date: string; type: "won" | "retained" | "vacated" | "stripped" | "created"; entrantId: CampaignEntrantId | null; matchId?: string; detail: string }>;
}

export interface CampaignInjury {
  id: string;
  wrestlerId: string;
  sourceMatchId: string;
  occurredDate: string;
  weeks: number;
  returnDate: string;
  active: boolean;
  detail: string;
}

export interface CampaignMatchResult {
  winnerEntrantId: CampaignEntrantId | null;
  loserEntrantId: CampaignEntrantId | null;
  method: MatchResult["method"];
  summary: string;
  appliedEventId: string;
  finalMatchHash: string;
}

export interface ScheduledMatch {
  id: string;
  date: string;
  mode: MatchMode;
  entrantIds: [CampaignEntrantId, CampaignEntrantId];
  wrestlerIds: [string[], string[]];
  playerControlled: boolean;
  titleId: CampaignTitleId | null;
  vacancyTitleId: CampaignTitleId | null;
  vacancyCompetitionId: string | null;
  vacancyRound: "semifinal" | "final" | null;
  mandatoryDefense: boolean;
  status: "scheduled" | "in-progress" | "completed" | "cancelled";
  matchSeed: number;
  timeLimitMinutes: number;
  /** AI opposition difficulty, pinned at schedule time from the campaign default (or a per-match override). */
  aiDifficulty?: AiDifficulty;
  /** Match variety (M11), pinned at schedule time. Absent equals `standard`. */
  variety?: MatchVariety;
  result: CampaignMatchResult | null;
  replayConfig: MatchConfiguration | null;
  replayInputs: Intent[];
  finalMatchState: MatchState | null;
}

export interface VacancyCompetition {
  id: string;
  titleId: CampaignTitleId;
  method: "ranked-contenders" | "tournament";
  entrantIds: CampaignEntrantId[];
  matchIds: string[];
  advancingEntrantIds: CampaignEntrantId[];
  status: "active" | "completed";
  createdDate: string;
  detail: string[];
}

export interface TitleShotOffer {
  id: string;
  titleId: CampaignTitleId;
  month: string;
  candidateId: CampaignEntrantId;
  candidateRank: number;
  rawRoll: number;
  modifiers: Array<{ label: string; amount: number }>;
  modifiedRoll: number;
  status: "offered" | "accepted" | "declined";
  detail: string[];
}

export interface CampaignEvent {
  sequence: number;
  id: string;
  date: string;
  type: string;
  input: Record<string, unknown>;
  summary: string;
  detail: string[];
  dice: DieRoll[];
  preStateHash: string;
  postStateHash: string;
}

export interface CampaignState {
  schemaVersion: "asw91-campaign-v1";
  rulesetVersion: string;
  campaignRulesetVersion: string;
  dataPackVersion: string;
  dataHash: string;
  campaignId: string;
  name: string;
  seed: number;
  rng: RngState;
  createdAt: string;
  updatedAt: string;
  startDate: string;
  currentDate: string;
  playerEntrantId: CampaignEntrantId;
  playerDivision: CampaignDivision;
  vacancyMethod: "ranked-contenders" | "tournament";
  /** Optional post-match injury extension. Absent/undefined means off and hashes exactly like pre-extension saves. */
  postMatchInjuryPolicy?: "off" | "d20-check";
  postMatchInjuryVersion?: string;
  /** Career default AI opposition difficulty. Absent/undefined means standard and hashes exactly like pre-M10 saves. */
  aiDifficulty?: AiDifficulty;
  /** Career default match variety (M11). Absent/undefined means standard and hashes exactly like pre-M11 saves. */
  variety?: MatchVariety;
  /** Optional contracts-and-finance extension (M12). Absent/undefined means off and hashes exactly like pre-M12 saves. */
  financePolicy?: FinancePolicy;
  financeVersion?: string;
  finance?: FinanceState;
  /** Optional feud-and-title-booking extension (M13). Absent/undefined means off and hashes exactly like pre-M13 saves. */
  bookingPolicy?: BookingPolicy;
  bookingVersion?: string;
  booking?: BookingState;
  /** Optional contract-negotiation extension (M12 amendment). Absent/undefined means off and hashes exactly like pre-amendment saves. */
  negotiationPolicy?: NegotiationPolicy;
  negotiationVersion?: string;
  negotiation?: NegotiationState;
  /** Expiry renewal strategy (M12-ADJ-09). Absent/undefined (or "expiring-salary") means the pre-amendment renewal at the expiring salary and hashes exactly as before. */
  renewalStrategy?: RenewalStrategy;
  roster: Record<string, WrestlerCareerRecord>;
  teams: Record<CampaignEntrantId, PersistentTeam>;
  rankings: Record<CampaignDivision, RankingTable>;
  rankingHistory: RankingTable[];
  monthlyRatingPoints: Record<CampaignDivision, Record<CampaignEntrantId, number>>;
  titles: Record<CampaignTitleId, TitleState>;
  schedule: ScheduledMatch[];
  titleShotOffers: TitleShotOffer[];
  vacancies: VacancyCompetition[];
  injuries: CampaignInjury[];
  matchHistory: string[];
  appliedMatchIds: string[];
  activeMatchId: string | null;
  activeMatch: MatchState | null;
  events: CampaignEvent[];
}

export interface CampaignConfig {
  name: string;
  seed: number;
  startDate: string;
  roster: WrestlerCareerRecord[];
  teams?: Array<Pick<PersistentTeam, "id" | "name" | "memberIds" | "side">>;
  playerEntrantId: CampaignEntrantId;
  playerDivision: CampaignDivision;
  champions?: Partial<Record<CampaignTitleId, CampaignEntrantId | null>>;
  vacancyMethod?: "ranked-contenders" | "tournament";
  postMatchInjuryPolicy?: "off" | "d20-check";
  aiDifficulty?: AiDifficulty;
  variety?: MatchVariety;
  financePolicy?: FinancePolicy;
  /** Contracts signed at campaign start; requires financePolicy (M12). */
  contracts?: Array<{ wrestlerId: string; weeklySalary: number; termWeeks: number; signingBonus?: number }>;
  /** Roster-level chemistry pairs (M12). */
  chemistry?: Array<{ memberIds: [string, string]; label: string }>;
  /** Rivalry pairs created at campaign start; requires bookingPolicy (M13). */
  feuds?: Array<{ entrantIds: [string, string]; label?: string; initialHeat?: number }>;
  bookingPolicy?: BookingPolicy;
  /** Deterministic contract negotiation (M12 amendment); requires financePolicy (M12-ADJ-06). */
  negotiationPolicy?: NegotiationPolicy;
  /** Expiry renewal strategy (M12-ADJ-09); requires negotiationPolicy "offers". Defaults to the expiring salary. */
  renewalStrategy?: RenewalStrategy;
}

/** Contracts-and-finance extension policy (M12). Only "contracts" is implemented. */
export type FinancePolicy = "contracts";

/** Per-wrestler guaranteed contract (M12). Term runs from the signing date. */
export interface WrestlerContract {
  wrestlerId: string;
  weeklySalary: number;
  termWeeks: number;
  startDate: string;
  signingBonus: number;
}

/** Roster-level chemistry pairing (M12). */
export interface ChemistryPair {
  memberIds: [string, string];
  label: string;
}

/** One payout event (M12). `weekIndex` 0 marks a signing-bonus payment. */
export interface PayoutRecord {
  date: string;
  weekIndex: number;
  entries: Array<{ wrestlerId: string; amount: number }>;
  total: number;
}

/** One dated popularity movement (M12). */
export interface PopularityMovement {
  date: string;
  wrestlerId: string;
  delta: number;
  from: number;
  to: number;
  reason: string;
}

/** The M12 finance ledger; present iff financePolicy is enabled. */
export interface FinanceState {
  policyVersion: string;
  nextPayoutDate: string;
  contracts: Record<string, WrestlerContract>;
  chemistry: ChemistryPair[];
  ledgers: Record<string, number>;
  payouts: PayoutRecord[];
  popularity: Record<string, number>;
  popularityHistory: PopularityMovement[];
}

/** Contract-negotiation extension policy (M12 amendment). Only "offers" is implemented. */
export type NegotiationPolicy = "offers";

/**
 * Expiry renewal strategy (M12-ADJ-09). "expiring-salary" offers the renewal
 * at the expiring contract's rate (the pre-amendment behavior, byte-identical);
 * "curve-fair" is a campaign-AI action that preemptively matches the
 * salary-curve expectation when a wrestler's popularity outgrew their salary,
 * so hot wrestlers re-sign instead of walking.
 */
export type RenewalStrategy = "expiring-salary" | "curve-fair";

/** One deterministic contract offer and the wrestler's recorded response (M12 amendment). */
export interface ContractOffer {
  id: string;
  wrestlerId: string;
  weeklySalary: number;
  termWeeks: number;
  signingBonus: number;
  offeredAt: string;
  /** The salary-curve expectation at offer time (M12-ADJ-07). */
  expectedSalary: number;
  status: "offered" | "accepted" | "rejected";
  /** "player" offers come from offerContract; "renewal" offers are expiry re-signings. */
  reason: "player" | "renewal";
  /** Human-readable acceptance basis (verdict, expectation, die when rolled). */
  basis: string;
  resolvedAt?: string;
}

/** One dated negotiation record (M12 amendment). */
export interface NegotiationRecord {
  date: string;
  wrestlerId: string;
  type: "accepted" | "rejected";
  offerId: string;
  weeklySalary: number;
  expectedSalary: number;
  basis: string;
}

/** The M12 negotiation ledger; present iff negotiationPolicy is enabled. */
export interface NegotiationState {
  policyVersion: string;
  offers: ContractOffer[];
  history: NegotiationRecord[];
}

/** Feud-and-title-booking extension policy (M13). Only "feuds" is implemented. */
export type BookingPolicy = "feuds";

/** One rivalry pair with its deterministic 0-100 heat track (M13). */
export interface Feud {
  id: string;
  entrantIds: [CampaignEntrantId, CampaignEntrantId];
  label: string;
  heat: number;
  status: "active" | "cooling";
  startedAt: string;
  lastMatchDate: string | null;
  matchCount: number;
}

/** One dated feud heat movement (M13). */
export interface FeudHeatMovement {
  date: string;
  feudId: string;
  delta: number;
  from: number;
  to: number;
  reason: string;
  matchId?: string;
}

/** One month's deterministic booking card for the player entrant (M13). */
export interface MonthBookingSuggestion {
  month: string;
  playerEntrantId: CampaignEntrantId;
  items: Array<{
    priority: number;
    kind: "required-defense" | "feud" | "optional";
    opponentId: CampaignEntrantId;
    titleId?: CampaignTitleId;
    feudId?: string;
    basis: string;
  }>;
}

/** The M13 booking ledger; present iff bookingPolicy is enabled. */
export interface BookingState {
  policyVersion: string;
  feuds: Feud[];
  feudHistory: FeudHeatMovement[];
  monthSuggestions: MonthBookingSuggestion[];
}

export interface CampaignAiDecision {
  type: "title-shot" | "optional-match" | "vacancy";
  actorId: CampaignEntrantId;
  legalAlternatives: Array<{ id: string; label: string; score: number; basis: string }>;
  selectedId: string;
  tiebreakRolls: DieRoll[];
  explanation: string;
}
