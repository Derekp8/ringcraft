# M13 implementation audit — Feuds and Title Booking Layer

## Verdict

M13 adds a feud-and-title-booking layer to the campaign core: roster-level rivalry pairs with a
deterministic 0–100 heat track, a feud term on title-shot rolls, and deterministic month-end
booking suggestions, per `docs/superpowers/specs/2026-08-17-m13-feud-title-booking-design.md`.
The 1991 manual contains no feud, heat, or booking mechanics (only storyline flavor prose), and
the audited GDD defines no such subsystem, so the milestone is a documented digital-only
extension recorded in `docs/adjudication-register.md` (M13-ADJ-01/02/03), mirroring the
M10-ADJ / M11-ADJ / M12-ADJ opt-in extension pattern. **M13-ADJ-01** defines the feud pair and
heat track (moved only by the official results of the pair's own matches, never dice);
**M13-ADJ-02** defines the advisory month-end booking card; **M13-ADJ-03** makes an active feud
with the title holder the draw on the shot roll without touching the M12-ADJ-04 gates.
Campaigns that never enable the extension serialize and hash byte-identically to pre-M13 — every
existing save, fixture, replay hash, and the M10/M11/M12 corpora remain valid.

## Implemented surfaces

| Area | Evidence |
|---|---|
| Policy model | `BookingPolicy = "feuds"` and `BOOKING_POLICY_VERSION = "classic-1991-feud-booking-v1"`; optional `CampaignState.bookingPolicy` / `bookingVersion` / `booking` — all three `undefined` when off and dropped by `canonicalSerialize`, exactly like `financePolicy` / `aiDifficulty` / `variety`; config gains `bookingPolicy` and `feuds` (entrant pair, label, initialHeat) |
| Booking state | `BookingState` in `src/core/types.ts`: `policyVersion`, `feuds`, `feudHistory`, `monthSuggestions`; `Feud` (id, unordered entrant pair, label, heat 0–100, `active`/`cooling` status, startedAt, lastMatchDate, matchCount), `FeudHeatMovement` (dated from/to/delta/reason, optional matchId), `MonthBookingSuggestion` (month, playerEntrantId, priority 1/2/3 items with kind/opponentId/titleId/feudId/basis) |
| Rules tables | `FEUD_HEAT_TABLE` (clean win +3 / DQ-countout win +5 / loss +2 / draw +4 / title-match +1 extra, 0–100 clamp), `FEUD_DECAY_TABLE` (monthlyDecay 5, coolingThreshold 20), `FEUD_TITLE_SHOT_TERM` (M13-ADJ-03: step 20 → `floor(heat/20)` bonus per step) in `src/core/campaign-rules.ts`, with `BOOKING_TABLE_HASH` covering all three; pure helpers `feudHeatDelta` and `feudTitleShotTerm` |
| Creation | `createCampaign` builds the booking ledger when `bookingPolicy: "feuds"`: config `feuds` validated (distinct entrants, existing roster/team members, no duplicate pair), created at `startDate` with `heat = initialHeat ?? 50` clamped to 0–100, status `active`, stable `feud-` IDs from the sorted entrant pair |
| Feud heat | In `commitScheduledMatchResult`, when the two entrants of a feud faced each other, `applyFeudHeat` moves the shared heat by the official result's deterministic delta (title matches +1 extra), sets status `active`, updates `lastMatchDate` / `matchCount`, appends a `FeudHeatMovement` with the clamped from→to and the committing match ID, and adds a human-readable detail line; **zero dice consumed** |
| Monthly decay | At month-end finalization, `applyFeudMonthlyDecay` (called with the **closing** month) decays any feud with no match in the month being closed by 5 and flips to `cooling` at or below 20; a cooling feud still decays and is revived (status `active`) by its next match regardless of the outcome |
| Title-shot feud term (M13-ADJ-03) | In `rollTitleShot`, a candidate in an **active** feud with the title holder gains `feudTitleShotTerm(heat)` recorded in the offer's `modifiers` and the traversal's detail lines; the term stacks with the M12 popularity heat term, never bypasses the ranking start or the M12-ADJ-04 popularity floor, and a cooling feud contributes nothing |
| Month-end booking card (M13-ADJ-02) | `generateMonthBookingSuggestions` runs at month-end finalization for the player entrant: (1) required title defense due this month (highest hierarchy first, highest-ranked available contender, popularity floor when finance is on), (2) the player's hottest **active** feud rival (ties by heat, then rank, then ID), (3) an optional most-popular available ranked opponent (M12-ADJ-04 draw rule) or highest-ranked when finance is off. Every item records priority/kind/opponentId/titleId/feudId/basis; **advisory state only** — nothing is auto-scheduled |
| Booking preference | `suggestPlayerMatch` prefers the player's hottest active feud rival for optional bookings (overriding the finance popularity draw); cooling rivals are not booked ahead of the field |
| Transactions | `startFeud(state, entrantIds, { label?, initialHeat? })` — validates the extension, distinct existing entrants, **the same entrant kind (M13-ADJ-04)**, and a not-already-feuding pair; no dice consumed; events use the standard `transact` envelope (pre/post hashes, dice, detail). `createCampaign`'s `config.feuds` builder applies the same kind check |
| Validation | `validateCampaignState` rejects: wrong `bookingVersion` for the policy, version/ledger present without the policy, policy without the ledger, duplicate feud IDs, same-entrant feuds, unknown feud entrants, **mixed-entrant feuds (M13-ADJ-04)**, heat outside 0–100, invalid status/matchCount/lastMatchDate, and malformed month suggestions (player mismatch, bad month, duplicate priorities, unknown opponents/titles); `validateCampaignSave` requires `booking` (when present) to be an object with `feuds`/`feudHistory`/`monthSuggestions` arrays. Month-end booking defensively skips any feud rival that cannot resolve in the player's division, so a hand-edited mixed feud fails validation with a targeted message instead of crashing mid-finalization |
| Summary | `campaignSummary` adds `feudCount`, `bookingSuggestions`, and (only when the player has a feud) `feudHeat` when the extension is enabled |
| Determinism | All values derive from campaign state and official match results — no new dice, no wall-clock; `hashCampaignState` covers the booking ledger, so atomic save/reload round-trips byte-identically |

## Verification

- **Full regression gate:** `npm run check` green — 342 pre-M13 tests plus the M13 suite
  (`tests/m13-feud-booking.test.ts`), which grew from 21 to 29 tests when tag-team feud rivals
  were added, to 33 with the M13-ADJ-04 mixed-entrant hardening, and to 36 with the tag
  heat/booking extensions: creation/validation of
  team feuds, pinned seed-1991 tag heat movement (t1 vs t2,
  t2 pin, heat 50 → 52), the tag title-match bonus (seed 7, world-tag, heat 50 → 53), tag
  month-end decay (22 → 17 cooling) plus revival on the next tag match, the month-end booking
  card naming the player team's feud rival (priority-2 feud item, no defense due), the
  optional-booking preference for the hottest tag feud rival (t3 over top-ranked t2/t4) with
  cooling rivals skipped, tag determinism/round-trip/tamper checks — all 413 tests across 25
  files pass, and `npm run fixtures:verify` remains green.
- **Default identity:** a campaign without `bookingPolicy` carries no `booking*` fields in state
  or export JSON, `validateCampaignSave` is clean, `campaignSummary` has no feud keys, and the
  round trip is byte-identical; all pre-M13 pinned hashes (fixtures, corpora) replay unchanged.
- **Rules pinning:** the policy version, table hash, heat bands/deltas, decay table,
  title-shot-term grading (`floor(heat/20)`), and the `feudHeatDelta` outcome mapping (win +3 /
  DQ win +5 / loss +2 / draw +4 / title-match +1 extra) are asserted directly.
- **Feud heat:** the pinned seed-2000 singles match (records[0] wins by pin) moves the pair's
  heat 50 → 53 with a `win` movement carrying the committing match ID; the pinned seed-7
  Television title match adds the +1 title bonus; the commit event detail names the feud.
- **Decay and revival:** a feud that had no match in the closing month decays 22 → 17 and flips
  to `cooling` at the January→February boundary; the next feud match (any outcome) revives it to
  `active` with the result's deterministic delta. A feud that DID match in the closing month is
  not decayed (heat 80 → 83 via the title-match loss, no decay movement).
- **Booking card (M13-ADJ-02):** seed-2000 campaign where the player is the world champion with
  one January defense completed yields a February card with exactly priorities 1/2/3 —
  required-defense (world-heavyweight, highest-ranked available contender), feud (the heat-80
  rival), and optional — with the month-end event detail naming the card.
- **Booking preference:** the player's hottest active feud rival (heat 90, ranked #2) is booked
  over the top-ranked available opponent; a `cooling` feud rival is not booked ahead of the
  field.
- **Feud title-shot term (M13-ADJ-03):** a rank-1 feud rival at heat 60 converts with a
  `feud heat 60 vs champion` +3 modifier in the offer and its detail lines; cooling feuds and
  absent feuds contribute no term; the term stacks with the M12 popularity heat term (+4 + 3);
  an unranked entrant at heat 100 is never made a candidate (the term cannot bypass the ranking
  limit), and a below-floor roster with the extension on still throws naming the popularity
  floor. **Surfaced in the month-end booking banner:** `buildMonthEndSummary` renders the
  whole booking card in priority order — required defense (`World Heavyweight defense vs …`),
  the feud draw, and the optional opponent — so the card is readable from the banner without
  opening the panel. When the feud rival holds a title in the player's division, the feud
  segment carries the same graded term the decisions panel renders
  (e.g. `feud vs Team 2 (heat 85; title-shot +4 feud heat 85 vs champion); optional vs Team 3.`),
  derived from the same `feudTitleShotTerm` rule so the banner and the panel cannot drift
  apart; presenter tests pin the exact line for tag and singles champions (required-defense
  first when the player champion survives to the boundary, optional always present when a
  ranked opponent is available, and the optional item surfacing even when the card has no
  feud item), and the visual QA gate plays the January world-tag defense so the champion
  survives the Feb 1 strip and the banner shows the feud term plus the optional opponent. The
  QA gate additionally pins the seeded world-tag defense match's replay identity
  (`WORLD_TAG_DEFENSE_REPLAY_HASH = c14n-fnv1a64-v1:0707c852c4025914`): the latest-official-
  result card must surface that exact hash, and the committed match's stored replay
  (`replayConfig` + 244 inputs, read from the autosave snapshot) is replayed externally and
  must re-derive to the same identity — so the defense outcome (a time-limit draw; the
  champion retains) is asserted deterministically, not just via the banner text.
- **Transactions:** `startFeud` creates a validated feud (70 heat, active) as a `start-feud`
  event and rejects duplicates, same-entrant pairs, unknown entrants, mixed wrestler-vs-team
  pairs (M13-ADJ-04), and campaigns without the extension.
- **Tag heat outcome extensions:** a pinned seed-1 tag match resolving as a time-limit draw
  moves the feud +4 (50 → 54, `reason: "draw"`) with the commit detail line pinned; the
  seed-7 world-tag title match is pinned absolutely (t1 loses by pin + the +1 title bonus ⇒
  heat 53, movement −3 loss) instead of a computed delta.
- **Tag title-shot feud term (M13-ADJ-03):** the world-tag champion (t1) feuding with the
  top-ranked t2 at heat 60 yields a shot offer naming t2 with the `feud heat 60 vs champion`
  +3 modifier and the `+3 feud heat 60 vs champion` detail line; a cooling tag feud
  contributes no term.
- **Title-shot roll auditability:** the roll breakdown is now recorded in the
  `respond-title-shot` event detail — the exact line the decisions panel renders
  (`6 -3 same side (tag) +3 feud heat 60 vs champion = 6`), pinned for both the accept and
  decline branches, **and on the `roll-title-shot` grant event itself** (`t2 granted World
  Tag offer title-shot-…; roll … = 6.`) so the log shows the terms from the moment the
  offer exists, before any decision.  `titleShotRollLine` is the core single source of truth
  (re-exported by the presenter), and the QA gate asserts the grant line renders and then
  declines the seeded world-tag shot and asserts the feud term survives in the event log.
  The grant-event line itself now surfaces on the decisions card too: `titleShotGrantLine`
  (core, alongside `titleShotRollLine`) feeds both the `roll-title-shot` event detail (raw
  entrant id) and the panel (human label), so the card's grant line and the log's are the
  same helper's output by construction — the QA gate asserts the offer card carries
  "Career Team 3 granted World Tag offer …; roll 6 -3 same side (tag) +2 feud heat 50 vs
  champion = 5." and the log carries the raw-id twin, keeping the two surfaces visibly in
  sync.
  The manual path got the same treatment: `titleShotExtraGrantLine` (core, sibling helper)
  records the consolidated extra-shot grant line — `"{candidate} granted extra {title} shot
  (mandatory defenses complete {completed}/{required})"` — on `grantExtraTitleShot`'s
  `schedule-match` event itself, so a champion-granted extra shot is auditable from the log
  exactly like a rolled shot's grant event.  Pinned by tests in both `m5` (singles
  world-heavyweight) and `m13` (tag world-tag, challenger picked from the tag rankings).
  The change is data-hash-safe: events are excluded from `hashCampaignState`, so the respond
  event's pre/post hashes chain exactly (only the offer-status mutation moves the post
  hash), and the appended extra-shot detail line moves no campaign hash either.
- **Title-shot chain fixture evidence:** the accept/decline resolution is now pinned as
  fixture evidence in the replay-verifier corpus — `fixtures/replays/title-shot-chain-v1.json`
  (schema `m13-title-shot-chain-v1`, `fixtureHash c14n-fnv1a64-v1:3e154f113603bba6`), derived
  from the same canonical scenario the tests pin (t1 world-tag champion, top-ranked t2 at feud
  heat 60). The fixture records the grant → decline and grant → accept chains: the offer
  identity `title-shot-4c1632ac`, the consolidated roll line
  `6 -3 same side (tag) +3 feud heat 60 vs champion = 6`, the grant-event line pinned as a
  first-class `grantLine` evidence field (the shared `titleShotGrantLine` helper's output —
  `t2 granted World Tag offer title-shot-4c1632ac; roll 6 -3 same side (tag) +3 feud heat 60
  vs champion = 6.` — re-derived by the verifier and asserted to appear inside the recorded
  grant detail, so the log and the decisions panel provably cannot drift), the
  grant/decline/accept event details, the four campaign hashes that form the chain links
  (initial → rolled → declined and rolled → accepted), the respond events' pre/post state
  hashes (the decline post-state IS the declined campaign hash; the accept post-state is the
  intermediate respond-only state before the mandatory-defense `schedule-match` transaction),
  the scheduled defense row, and the **manual-booking leg** symmetric to the rolled chain:
  the champion plays the accepted mandatory defense (retains by pin, obligation 1/1 complete)
  and grants the top-ranked non-champion an extra shot via `grantExtraTitleShot` — the
  committed defense outcome (`match-60052598`, pin, `finalMatchHash
  c14n-fnv1a64-v1:11b115985c980250`), the extra-shot grant line as a first-class
  `extraGrantLine` field (`t3 granted extra World Tag shot (mandatory defenses complete
  1/1).`, the shared `titleShotExtraGrantLine` helper's output, asserted inside the schedule
  event detail so the manual path's log and panel cannot drift either), the extra-shot
  schedule row (`match-144343ed`, non-mandatory, t3 vs t1), and the extra grant event's
  pre/post hashes (pre-state = the defended campaign hash, post-state = the extra-grant
  campaign hash).
  `scripts/verify-replay.ts` owns the kind and re-derives the whole chain from the pinned
  derivation on every `fixtures:verify` run, and the M9 clean-room gate asserts the re-derived
  `fixtureHash` against the manifest's `m13_title_shot_chain_fixture_hash` deterministic
  evidence pin — so a change to the offer id derivation, the graded feud term, the roll
  breakdown, or the scheduling rule fails the canonical gate.
- **Feud-heat event chain fixture evidence:** the feud ledger's full lifecycle is now pinned
  as fixture evidence too — `fixtures/replays/feud-heat-chain-v1.json` (schema
  `m13-feud-heat-chain-v1`, `fixtureHash c14n-fnv1a64-v1:9d6510b827550cb5`), mirroring the
  title-shot chain design. Derived from the canonical M13 tag scenario with every title left
  vacant (so the chain isolates feud mechanics — no title-strip, defense, or obligation noise
  can shift the pinned hashes): `startFeud` opens the t1 vs t2 rivalry at heat 60 (the
  start-feud transaction is its own chain link with pre/post hashes), a headless feud match
  resolves deterministically to a **time-limit draw** (heat 60 → 64, `reason "draw"` — the
  draw branch of `feudHeatDelta`, pinned as `heatMovement` with the commit detail line
  `Feud championship tag grudge (t1 vs t2): heat 60 → 64 (+4); 1 feud match(es).`), the
  January advance provably never cools the matched month (`matchedMonthNoDecay`: heat 64,
  one movement row), and the cold February applies the monthly decay (64 → 59,
  `reason "monthly-decay"`, log line `Feud championship tag grudge cooled 64 → 59 (no match
  in 1991-02).`). Pins the feud identity `feud-302eaae0`, the committed match outcome and
  `finalMatchHash c14n-fnv1a64-v1:6ab6b17466e0a491`, the heat and decay movement rows, the
  final feud state (59, active, 1 match, last 1991-01-01), and the six campaign hashes that
  form the chain links (initial → feuded → scheduled → committed → Feb 1 → Mar 1) with each
  transaction's pre/post hashes. `scripts/verify-replay.ts` owns the kind and re-derives the
  whole chain from the pinned derivation on every `fixtures:verify` run, and the M9
  clean-room gate asserts the re-derived `fixtureHash` against the manifest's
  `m13_feud_heat_chain_fixture_hash` deterministic evidence pin — so a change to the heat
  tables, the decay rule, the match engine outcome, or the campaign hashing fails the
  canonical gate.
- **Mixed-entrant hardening (M13-ADJ-04):** a mixed pair is rejected at `startFeud` (both
  orders) and at `config.feuds` creation with targeted "same kind" errors; a tampered mixed
  feud pushed into the ledger no longer crashes month-end finalization with
  `wrestlerIdsForEntrant`'s "Unknown wrestler entrant" — the booking guard skips the
  unresolvable rival and validation names the exact "mixed-entrant feud" problem; a
  same-kind team-vs-team feud still starts and advances cleanly (regression pinned).
- **Determinism:** identical seeds produce identical state hashes, feud histories, and
  month-end suggestion cards across advances and headless matches.
- **Round trip:** enabled campaigns serialize → import → serialize byte-identically
  (`verifyCampaignRoundTrip`), preserving `hashCampaignState` and the booking ledger.
- **Validation:** tampered version, orphaned/missing ledger, heat 101, duplicate feud IDs, and
  unknown feud entrants are all rejected with targeted messages.

## Remaining external gates

The feud-and-title-booking rules are a documented digital-only extension (M13-ADJ-01/02/03,
human sign-off pending like every M4–M12 adjudication). No source transcription is claimed for
the feud layer; independent review of the extension decisions — including the heat bands, the
closing-month decay semantics, the advisory booking card, and the feud title-shot term — remains
an external handoff gate.
The booking ledger has no campaign UI wiring yet: feuds are configured at campaign creation (or
via `startFeud` in the core), and month-end cards are core state that the existing
`suggestPlayerMatch` / `scheduleCampaignMatch` flow can offer item-by-item. Nothing is
auto-scheduled in v1.
