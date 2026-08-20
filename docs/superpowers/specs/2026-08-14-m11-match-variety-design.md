# M11 Match Variety — Steel Cage and Ladder Matches — Design

**Project:** Project Ringcraft 1.2.0 M10 handoff candidate
**Status:** Proposed design, not implemented
**Date:** 2026-08-14

## Goal

Add the first match-variety milestone: steel cage and ladder matches as first-class engine configurations, with deterministic replays and pinned fixtures, without disturbing the canonical singles/tag match path. Today every match is exactly singles or two-person tag under `classic-1991-vertical-slice`, and `docs/known-limitations.md` records "cages, ladders … are out of scope." M11 brings cage and ladder in as **documented digital-only rules** with their own adjudications; it replaces none of the M0–M5 rules for standard matches and keeps every existing save, fixture, replay hash, and the entire M10 corpus valid.

The variety is a visible, stored configuration (like `aiDifficulty`), part of the replay contract through `hashMatchState`. A standard match with `variety` absent must serialize and hash byte-identically to today.

## Source Authority and the GDD 18.2 Revisit

This milestone must be flagged as a product decision, not a transcription:

- The **1991 manual** contains no cage or ladder match rules. A full-text search of the manual finds only a single storyline blurb mentioning a steel cage; there is no ladder content at all.
- The **audited GDD (section 18.2)** explicitly lists cage/ladder among "Out of scope for v1" (a post-launch dream sheet), and the project's authority chain is manual → audited GDD → implementation with adjudications recorded in `docs/adjudication-register.md`.

M11 therefore **revisits GDD 18.2** with digital-only rules that reuse the manual's established dice conventions (D20 checks against AV/DV, Charm spends, the exploding-D10 referee, seeded xorshift PRNG). A new adjudication entry (M11-ADJ-01) records the revisit and the rule text; M11-ADJ-02/03 record the win-condition formulas. These entries do not claim source authority — they are the documented extension decision, mirroring the M10-ADJ extension pattern.

## Compatibility Boundary

M11 must not modify:

- `src/core/campaign-rules.ts` (M5 rules tables, versions, `M5_DATA_HASH`)
- `src/core/hash.ts` semantics
- `src/core/prng.ts`
- M0–M5 rules, dice expressions, legality, creation, progression, or campaign serialization
- The behavior, serialization, or hashes of standard (variety-absent) matches — byte for byte
- The M10 corpus, its pinned per-decision hashes, or the AI policy dispatch for standard matches

M11 intentionally modifies:

- `src/core/types.ts` — `MatchVariety`, optional `variety` on `MatchConfiguration`, new intent variants, `ladder` runtime state, new result methods
- `src/core/engine.ts` — variety validation, cage/ladder gating (no countout, no DQ result, cage boundary), escape/retrieval resolution, ladder state lifecycle, match-start event text
- `src/core/validator.ts` — the new legal turn actions for cage/ladder matches
- `src/core/ai.ts` — scoring and positional evaluation for the new win conditions (standard difficulty behavior for standard matches untouched)
- `src/core/campaign.ts` — optional `variety` passthrough on `ScheduledMatch`/`CampaignConfig` (absent = standard; hash-safe), plus `winCategory` handling for the new methods
- `src/core/progression.ts` — `MatchWpInput.method` union widened; WP formula treats escape/retrieval as plain wins (no DQ/countout penalty, no title bonus)
- Fixtures: new `fixtures/m11/` with a generator/verifier, packaging allowlist, and manifest refresh

## Determinism and Replay Contract (design rule)

The same load-bearing rule as M10 applies. `replayFromInputLog` rebuilds a match from `MatchConfiguration`; the `variety` field lives on that configuration and is hashed, so replays of cage/ladder matches are fully deterministic. AI decisions are re-derived during replay, so the AI scoring must branch on `state.config.variety` — never on module-level state, clocks, or unseeded randomness.

Hash-safety rule (the reason this works): `canonicalSerialize` drops `undefined` properties at every level. Therefore:

1. `MatchConfiguration.variety` is optional; standard matches leave it `undefined`, so `hashMatchState` output for standard matches is byte-identical to pre-M11.
2. `MatchState.ladder` is optional **and never assigned `null`** — it is `undefined` until a ladder is actually set up, and `undefined` again after retrieval or a knock-down. Standard and cage matches always leave it `undefined`.
3. The search clone (`cloneMatchStateForSearch`) copies the ladder object when present so a lookahead clone can never mutate the live ladder through a shared reference.

## Match Variety Model

```ts
export const MATCH_VARIETIES = ["standard", "cage", "ladder"] as const;
export type MatchVariety = (typeof MATCH_VARIETIES)[number];
```

`MatchConfiguration.variety?: MatchVariety` — `undefined` equals `"standard"`, mirroring `aiDifficulty`.

### Shared gating (both cage and ladder, v1)

- **Singles only.** `createMatch` rejects `variety: "cage" | "ladder"` with `mode: "tag"`. Tag teams, corner men, tag ropes, double teams, and interference never appear.
- **No disqualification result.** The referee still performs checks for illegal moves and rope use, and the cumulative alert still rises, but the 31+ band never ends the match — the referee "lets it go" (event detail recorded). This keeps the referee-dice stream unchanged in kind.
- **No countout.** `processCountouts` skips non-standard matches. In a ladder match a thrown-out wrestler may simply be out as long as needed and re-enter (floor/re-enter mechanics are unchanged); in a cage the boundary is closed so nobody reaches the floor at all.
- **Win by pin or submission** works exactly as today (knockout pins, critical hold 100, interference-free singles flow).

### Cage (`variety: "cage"`)

- **Closed boundary.** A Throw Out of Ring result (`throwsOut` moves) converts to a **cage slam**: the move lands normally and deals its damage, but the defender remains in the ring and no countout begins; the event detail says the cage wall stops the throw. `RingLocation` never becomes `"floor"` in a cage match.
- **Escape win.** New turn action `cage-escape` (Charm 0–3), **legal only once the defender has taken `ESCAPE_LEGALITY_THRESHOLD` (15) damage** — a fresh opponent can haul the climber back down, so the escape is the late-match finish, not an opening move:

  ```
  target = AV(actor) + Charm bonus − DV(defender) − ESCAPE_DIFFICULTY(5)
           + floor(damage taken by defender / 10) − floor(damage taken by actor / 10)
  ```

  Roll 1D20; success (1, or ≤ target and not 20) = both feet hit the floor → win by `"escape"`. Failure consumes the active phase (activation ends; no countout, no extra penalty). Shape rationale: escape is modeled like a pin check — the defender's DV resists — while the flat climb-difficulty penalty keeps a fresh, healthy opponent from being climbed out on, the defender's *taken* damage makes escape *easier* (they cannot haul the climber back), and the climber's own *taken* damage makes the climb *harder*. Charm uses the standard `charmCheckBonus`. *(Tuned by the M11 seeded playtest balance report, which found the initial formula produced degenerate ~1-minute insta-escapes; see `docs/superpowers/specs/2026-08-14-m11-playtest-balance-design.md` and M11-ADJ-02.)*

### Ladder (`variety: "ladder"`)

- **Ladder runtime state.** `MatchState.ladder?: { setById: WrestlerId; setAtTick: number }` — `undefined` when no ladder is set up.
- **Set up the ladder.** Turn action `set-up-ladder` (no check, consumes the phase) when no ladder is set. Anyone may set it.
- **Climb and retrieve.** Turn action `climb-retrieve` (Charm 0–3) when a ladder is set (by either wrestler — both may climb the same ladder). Same D20 formula and softening requirement as the cage escape; success retrieves the hanging object → win by `"retrieval"` (ladder state cleared). Failure = knocked off the ladder: the phase ends, the ladder stays up, and the opponent gets the next chance to climb.
- **Knock the ladder down.** Turn action `knock-ladder` (no check, consumes the phase) when a ladder the opponent set is up — the counterplay that denies their win condition.

## New Intents and Result Methods

```ts
// Intent additions
| { type: "cage-escape"; charm: number }
| { type: "set-up-ladder" }
| { type: "climb-retrieve"; charm: number }
| { type: "knock-ladder" }

// MatchResult.method / MatchWpInput.method additions
| "escape"
| "retrieval"
```

No new decision kinds are required — the new actions are ordinary turn actions resolved immediately through `performDecision`, so `DecisionState.kind` is unchanged.

## Engine Resolution

Four new resolvers in `engine.ts` (each mirrors `resolvePinNow`'s shape: validate, spend Charm, roll from `state.rng`, `recordEvent`, `completeActivation` on failure, `setResult` on success):

- `resolveCageEscape(state, actorId, charm)`
- `resolveSetUpLadder(state, actorId)` — sets `state.ladder`; no RNG
- `resolveClimbRetrieve(state, actorId, charm)` — clears `state.ladder` on success
- `resolveKnockLadder(state, actorId)` — clears `state.ladder`; no RNG

Dispatch cases are added to `performDecision`. Gating edits: `finalizeAttackDamage` throws-out path branches on `variety === "cage"`; `processCountouts` early-returns for non-standard; `refereeCheck`'s 31+ band branches on `variety === "standard"`.

## Validator

`enumerateTurnActions` gains, for a legal in-ring singles actor in a non-standard match (appended after the standard action lists):

- Cage: `cage-escape:${charm}` actions for `charm ∈ 0..min(3, charmRemaining)`.
- Ladder: `ladder:set-up` when `state.ladder` is absent; `ladder:climb:${charm}` (Charm range) when a ladder is set; `ladder:knock` when a ladder the *opponent* set is up.

## AI Policy

- `scoreAction`: `cage-escape`/`climb-retrieve` score as `clampProbability(target) * 10_000` (win chance, matching the pin/submission branch, minus nothing extra — escape cannot be broken up in singles); `set-up-ladder` scores a moderate constant with a small positional term; `knock-ladder` scores a denial constant (higher when the opponent set it).
- `evaluateState`: ladder set by me adds a fixed positive term; set by the opponent subtracts it. Cage/escape has no persistent state, so nothing to evaluate. Standard matches see zero change.
- `standard` difficulty takes exactly the pre-M11 scoring path for standard matches (byte-identical decisions, zero RNG consumed). All four difficulties automatically cover the new actions because they share the one legality enumeration.

## Campaign Wiring

- `CampaignConfig.variety?`, `CampaignState.variety?`, and `ScheduledMatch.variety?` — all optional and spread only when non-standard, exactly like `aiDifficulty` (hash-safe for existing saves).
- `beginScheduledMatch` passes `variety` into `createMatch`.
- `winCategory` (campaign-rules) maps `escape`/`retrieval` to the clean-win category alongside pin/submission.
- The campaign commit flow treats the new methods like pin/submission for result recording, but **titles do not change hands** on escape/retrieval (`titleCanChange` stays pin/submission-only), consistent with M5-ADJ-06's DQ/countout precedent.
- The WP formula: escape/retrieval wins are plain wins (+5 base; stronger/weaker modifiers apply; no −1, no title bonus). Losses are plain losses (+2). No formula change beyond the widened union.

## Fixtures

`fixtures/m11/` with two replay fixtures (schema `asw91-match-variety-replay-v1`):

- `cage-replay.json` — a seeded singles cage match driven headlessly to an escape win; pins `matchConfig`, `inputLog`, `expectedFinalMatchHash`, `expectedWinMethod: "escape"`.
- `ladder-replay.json` — a seeded singles ladder match driven headlessly to a retrieval win; pins the same fields with `expectedWinMethod: "retrieval"`.

`scripts/generate-m11-fixtures.ts` builds them (deterministic seeded construction using the same headless driver as the M10 corpus, with crafted rosters so the escape/retrieval win is reachable and stable). `scripts/verify-m11-fixtures.ts` replays each fixture and asserts the final hash and win method reproduce exactly; it also asserts the **default-identity contract**: a standard match created with the same seed/roster serializes without any `ladder` or `variety` key. `package.json` gains `fixtures:m11`; `fixtures:verify` runs the new verifier. `scripts/m9-packaging-contracts.ts` allowlists `fixtures/m11` (the `fixtures/m5`/`fixtures/m10` precedent), and `HANDOFF-MANIFEST.json` pins are refreshed by the M9 builder.

## Tests (`tests/m11-match-variety.test.ts`)

1. **Default identity**: standard matches serialize/hash with no `variety`/`ladder` keys; a standard match's `hashMatchState` equals its pre-variety value (byte-identity contract).
2. **Validation**: cage/ladder with `mode: "tag"` throws; unknown variety throws; replay config round-trips.
3. **Cage replay determinism**: seeded cage match → escape win; `replayFromInputLog` reproduces the identical final hash and method.
4. **Ladder replay determinism**: seeded ladder match → retrieval win; replay reproduces the hash and method.
5. **Cage gates**: a `throwsOut` move lands but leaves the defender in the ring; a scripted countout 10 never fires; a scripted 31+ referee check warns but does not end the match.
6. **Ladder gates**: a thrown-out wrestler plus scripted countout 10 does not lose; knock-down clears the ladder and retrieval after re-setup still wins.
7. **AI coverage**: the new actions appear in `enumerateTurnActions`; `scoreAction` ranks a winning escape/retrieval first; `evaluateState` reflects ladder ownership.
8. **Fixtures**: the m11 verifier output is reproduced by the test suite (fixture replays pin the same hashes).

## Acceptance

- `npm run check` green (full test suite + typecheck + build), including the existing M10 corpus tests and all pinned replay hashes.
- `npm run fixtures:verify` green: m5, m10, and m11 fixtures all verify.
- `HANDOFF-MANIFEST.json` pins refreshed and consistent with the tree.
- Every standard match hash in fixtures/m5, fixtures/m10, tests, and the M10 corpus is unchanged.
- Known-limitations updated (cage/ladder moved from out-of-scope to the new digital-only rules), adjudication register gains M11-ADJ-01/02/03, and an M11 implementation audit records the milestone.
