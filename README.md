# Replay document fixtures

Versioned exports of the app's match-replay documents (`exportReplayDocument`),
used as canonical inputs for the drift verifier. Each file is a real replay of a
seeded fixture match played through the current engine:

- `ruthless-seed-1991-v2.json` — singles, seed 1991, AI difficulty `ruthless`
  (Atlas King vs Duke Vane). Replays to
  `c14n-fnv1a64-v1:43945f1cc482e0cd` — the same golden hash the M10 visual gate
  and the `tests/m10-ai.test.ts` golden pins assert.
- `tag-seed-1991-v2.json` — tag team, seed 1991, `standard` difficulty
  (Atlas King + Nova Hart vs Duke Vane + Rex Ransom). Replays to
  `c14n-fnv1a64-v1:1b26c32a342f08c8` — the tag-desktop gate pin.
- `title-shot-chain-v1.json` — the respond-title-shot event chain, the
  campaign-level companion to the match-replay documents. Derived from the
  canonical M13 tag-champion scenario (t1 holds the world-tag, top-ranked t2
  feuds at heat 60): the `roll-title-shot` grant, then the same offer resolved
  both ways — `respondToTitleShot` decline (candidate traversal may continue)
  and accept (schedules the mandatory world-tag defense). Pins the offer
  identity `title-shot-4c1632ac`, the consolidated roll line
  `6 -3 same side (tag) +3 feud heat 60 vs champion = 6`, the grant/decline/
  accept event details, the four campaign hashes that form the chain links
  (initial → rolled → declined and rolled → accepted), the respond events'
  pre/post state hashes, and the scheduled defense row.
- `feud-heat-chain-v1.json` — the feud-heat event chain, mirroring the
  title-shot chain design. Derived from the canonical M13 tag scenario with
  every title left vacant so the chain isolates the feud ledger: `startFeud`
  opens the t1 vs t2 rivalry at heat 60, a headless feud match resolves to a
  deterministic time-limit draw (heat 60 → 64, `reason "draw"`), and a cold
  February (no feud match) applies the -5 monthly decay (64 → 59). Pins the
  feud identity `feud-302eaae0`, the committed match outcome and `finalMatchHash`,
  the heat-movement row, the matched-month-never-cools invariant (heat 64 at
  Feb 1, one movement row), the decay row and its log line, the final feud
  state, and the six campaign hashes that form the chain links (initial →
  feuded → scheduled → committed → Feb 1 → Mar 1) with each transaction's
  pre/post hashes.

## Contract

Every replay document carries `replayVersion`, `rulesetVersion`, `dataHash`,
`config`, `inputs`, and `expectedStateHash`. `scripts/verify-replay.ts` checks
each exported replay against the **current** engine and reports schema drift:

- missing/type-wrong schema keys;
- `replayVersion` or `rulesetVersion` drift;
- data-pack drift (the re-derived `dataHash` no longer matches);
- replay divergence (the replayed state hash differs from `expectedStateHash`).

The title-shot chain fixture is a third owned kind (`schema`
`m13-title-shot-chain-v1`): its verifier re-derives the whole grant → decline /
grant → accept chain from the pinned derivation and fails on any drift in the
offer id, the graded roll terms, the event details, the campaign-hash chain
links, or the scheduled mandatory defense. Its `fixtureHash` is a canonical
64-bit hash over every pinned field and is asserted by the M9 clean-room gate
against the manifest's `deterministic_evidence` pin.

The feud-heat chain fixture is a fourth owned kind (`schema`
`m13-feud-heat-chain-v1`): its verifier re-derives the start-feud → committed
feud match → monthly decay chain from the pinned derivation and fails on any
drift in the feud identity, the match outcome and heat movement, the
matched-month-never-cools invariant, the decay row and log line, or the six
campaign-hash chain links. Its `fixtureHash` is asserted the same way against
the manifest's `m13_feud_heat_chain_fixture_hash` pin.

Regenerate the fixtures with `npm run replay:generate`; verify them (and any
other exported replay JSON) with `npm run replay:verify` or
`node scripts/run-typescript-module.mjs scripts/verify-replay.ts <paths...>`.
The verifier exits non-zero on any drift and is wired into `fixtures:verify`.
