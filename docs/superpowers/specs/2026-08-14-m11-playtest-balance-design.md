# M11 Seeded Playtest Balance Report — Design

**Project:** Project Ringcraft 1.2.0 M11 handoff candidate
**Status:** Proposed design, not implemented
**Date:** 2026-08-14

## Goal

Close the external pacing/balance evidence gate with a deterministic seeded playtest balance report: win-share, match-length, and finish-method analytics across the match varieties the engine now supports (standard singles, standard tag, cage, ladder). Today `docs/known-limitations.md` records that "playtest-led balance/pacing work remain deferred" and that the twelve-month runs "are not balance or pacing evidence." M11 adds a reproducible measurement artifact — a seeded batch report — that becomes that evidence, replacing none of the rules, PRNG behavior, engine, or replay contract.

This is a measurement milestone, not a rules milestone: the report changes no gameplay, consumes no hidden state, and every match it contains is a fully deterministic, replayable engine run.

## Authority and Framing

The balance report is a **deterministic behavioral measurement**, the same evidence class as the M10 difficulty-ladder corpus and the M11 replay fixtures. It is not a balance claim in the human-playtest sense: the report's numbers are pinned, reproducible engine outputs over a fixed seeded corpus. It closes the *pacing/balance evidence gate* — the docs' deferred-work line — while human playtest sign-off remains the external human gate (framed explicitly in `docs/known-limitations.md`).

No new adjudication is required: the report measures existing, adjudicated behavior (M10-ADJ difficulty ladder, M11-ADJ cage/ladder rules).

## Compatibility Boundary

M11 balance reporting must not modify:

- `src/core/*` engine, rules, PRNG, hash, or campaign behavior — this milestone is scripts, fixtures, tests, and docs only
- Any pinned hash, existing fixture, replay format, or the M10 corpus
- `M5_DATA_HASH`, `asw91-ai-policy-v1`, or the `asw91-campaign-v1` schema

M11 balance reporting intentionally adds:

- `scripts/m11-playtest-batch.ts` — the shared seeded corpus, headless driver, and analytics builder
- `scripts/generate-m11-playtest.ts` / `scripts/verify-m11-playtest.ts` — fixture writer and exact-replay verifier
- `fixtures/m11/playtest-balance-report-v1.json` — the pinned report (committed)
- `output/playtest/` — the per-match detail artifact (gitignored, regenerated each run)
- `tests/m11-playtest.test.ts` — invariant + determinism tests
- `package.json` — `fixtures:m11:playtest` script and a `fixtures:verify` extension
- Docs: `known-limitations.md`, the M7 audit's remaining-gates line, and the M11 implementation audit

## Corpus

The batch reuses the **committed M10 corpus rosters** (`fixtures/m10/ai-decision-log-v1.json` → `rosters`) so no roster construction code is duplicated and the corpus data is already approved and pinned:

| Batch | Roster | Variety | Difficulty | Seeds |
|---|---|---|---|---|
| `underdog-novice/standard/veteran/ruthless` | `m10-underdog` (the M10 ladder-corpus profile: fast/tough wrestler vs slower small-pool challenger, AI on the weak side) | standard | each rung | 32 |
| `equal-standard` / `equal-ruthless` | `equal-singles` | standard | standard / ruthless | 32 |
| `underdog-cage-standard` / `underdog-cage-ruthless` | `dominant-singles` (strong player vs jobber AI) | cage | standard / ruthless | 32 |
| `underdog-ladder-standard` / `underdog-ladder-ruthless` | `dominant-singles` | ladder | standard / ruthless | 32 |
| `tag-standard` | `standard-tag` | standard | standard | 16 |

The difficulty sweep uses the **M10 underdog profile** (extracted from the M10 ladder-corpus test into `scripts/m11-playtest-batch.ts` as `makeUnderdogRecord`/`underdogSetup`, which the M10 test now imports) rather than `dominant-singles`, because the playtest probe showed the jobber AI loses to the all-rounder at every difficulty (win share ≈ 0 even for ruthless) — the lopsided roster cannot measure difficulty separation. The underdog profile is the corpus on which the M10 win-share ordering is already pinned, so the report's difficulty analytics are structurally consistent with M10.

336 matches total, each with a fixed `timeLimitMinutes: 8` for cross-batch comparability (the time-limit-draw rate is itself a pacing metric). Seeds are `batchIndex * 1000 + seed` so no two matches share a seed stream.

## Driver

Each match is played headless exactly like the M10/M11 corpus drivers:

- Player-side decisions are resolved with `chooseDeterministicPolicyAction` (the v1 baseline, "the human at standard").
- AI-side decisions are resolved inside `advanceUntilPlayerDecision` via `chooseAiAction`, which reads the batch's `aiDifficulty` from the match configuration.
- The match ends when `advanceUntilPlayerDecision` produces a result (or a time-limit draw).
- No wall-clock, no module state, no unseeded randomness anywhere.

Per match the driver records: `seed`, `winnerTeam` (`"player"` / `"ai"` / `null`), `method`, `minutes` (terminal `state.minute`), `ticks` (terminal `state.tick`), and `finalHash` (`hashMatchState`). The full input logs are not stored in the report — like the M10 corpus, the matches are re-derived from their configuration during verification, and `replayFromInputLog` is additionally exercised on a sampled subset.

## Report Schema (`asw91-playtest-balance-report-v1`)

```ts
{
  schema: "asw91-playtest-balance-report-v1",
  policy: "asw91-ai-policy-v1",
  ruleset: "classic-1991-vertical-slice",
  timeLimitMinutes: 8,
  batches: [{
    label: string, rosterKey: string, variety: "standard" | "cage" | "ladder",
    difficulty: AiDifficulty, playerSide: "v1", seedBase: number,
    matches: [{ seed, winnerTeam, method, minutes, ticks, finalHash }]
  }],
  analytics: {
    winShare: {
      byDifficulty: Record<AiDifficulty, number>,          // AI wins / decisive matches, underdog sweep only
      byBatch: Record<string, number>,
    },
    matchLength: {
      byVariety: Record<"standard" | "cage" | "ladder", {
        meanMinutes, medianMinutes, minMinutes, maxMinutes, meanTicks, drawRate,
      }>,
    },
    finishMethods: {
      byVariety: Record<"standard" | "cage" | "ladder", Partial<Record<method, number>>>,
    },
  },
  reportHash: "c14n-fnv1a64-v1:…",                        // canonical hash of everything except itself
}
```

`winShare` excludes draws (time-limit draws are not wins), matching the M10 ladder-corpus convention. `matchLength` and `finishMethods` pool all batches of a variety so the cage/ladder rules' pacing and method mixes are directly comparable to standard matches.

## Verification

`verify-m11-playtest.ts` (wired into `fixtures:verify`) re-derives **every** batch match from its recorded configuration and asserts:

1. Each row's `finalHash` reproduces exactly.
2. Every aggregate (`winShare`, `matchLength`, `finishMethods`) reproduces exactly.
3. The `reportHash` matches the recomputed canonical hash.
4. The method-set invariants hold: cage matches only ever produce `pin | submission | escape | time-limit-draw`; ladder matches only `pin | submission | retrieval | time-limit-draw` (the M11 gates guarantee no countout/DQ — the report makes the analytics assert it).

## Tests (`tests/m11-playtest.test.ts`)

1. **Report invariants on the committed fixture**: schema, policy, the win-share ordering `novice < standard < veteran < ruthless` with the pinned margins, the variety method-set rules above, and sane length bounds (e.g., every mean within `[1, timeLimitMinutes]`, median ≤ max).
2. **Live difficulty sweep**: re-derive the underdog sweep (32 × 4 matches) in-process and assert the same ordering holds with margins — the M10 precedent's live-evidence style.
3. **Determinism spot check**: `replayFromInputLog` on a sampled match from each variety reproduces its `finalHash`.
4. **Default identity**: the report and its matches add no `variety`/`ladder` state to standard matches (already pinned by M11 tests; asserted again at the report level).

## Acceptance

- `npm run check` green; `npm run fixtures:verify` green (M5 + M10 corpus + M11 fixtures + the balance report).
- The report fixture is committed and its `reportHash` reproducible.
- All 45 manifest pins match the tree after the docs/package refreshes.
- `known-limitations.md` moves balance/pacing out of the deferred list (with the honest framing above), and the M7 audit's remaining-gates line and the M11 implementation audit record the milestone.
- **Rule finding folded in:** the report's first run exposed that the initial M11 escape/retrieval formula produced degenerate ~1-minute insta-escapes; the softening gate (`ESCAPE_LEGALITY_THRESHOLD = 15`) and climb-difficulty penalty (`ESCAPE_DIFFICULTY = 5`) were added and the damage terms corrected to the taken pool, then the M11 replay fixtures and this report were regenerated around the amended rule (M11-ADJ-02).
