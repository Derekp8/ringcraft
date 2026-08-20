# Checkpoint 0.1 implementation audit

## Verdict

Checkpoint 0.1 is a credible playable foundation, not the completed first vertical slice. It proves the highest-risk architectural claims - shared legality, seeded resolution, replay identity, persistent Hold timing, visible arithmetic, and an AI operating through player-legal actions. It does not yet prove rules completeness because major singles action families and all tag play remain absent.

## GDD traceability

| Implemented behavior | GDD reference | Verification |
|---|---|---|
| Integer conventions, D20 success, exploding referee D10 | 2.2 | Unit and transaction tests |
| Base/current separation and purchased-level distinction | 2.3, 17.3 | Derived tests and referee test |
| Ordered transaction and event explanation | 2.4, 15.2 | Resolution log and event hashes |
| DAM PTS, END, REC, BODY, phase schedule | 3.3-3.5, 7 | Derived, recovery, damage, and movement tests |
| Persistent Hold, escape, maintenance, release | 4.2, 6.2-6.4 | Transaction tests plus 50-seed batch |
| Strike/pin and Hold/submission windows | 4.3, 8.1-8.2 | Pin-window, target, and batch tests |
| Referee checks and availability | 9 | Arithmetic tests and chart runtime |
| Attack-check Charm spend | 10.9 | Shared action enumeration and runtime spend |
| Critical and fumble result bands | 12 | Critical Hold 100 golden test and batch execution |
| Fair shared-validator AI | 14.1-14.4 | AI choice log and legality-by-construction |
| Seed, event hash, replay input log | 17.4 | Replay golden test and 50-seed replay batch |

## Test result at handoff

- 10 automated tests passed.
- 50 two-minute seeded matches reached a legal match result or time-limit draw.
- Every one of those 50 input logs replayed to the identical final state hash.
- Production TypeScript and Vite build passed.
- Desktop 1440x1100 and narrow 390x844 browser checks passed with no runtime console error, horizontal overflow, or missing action controls.

## Defect found and fixed during QA

The initial implementation left the original Hold decision object alive after a player selected voluntary release and the follow-up Strike missed. The Hold itself had correctly ended, but the stale action menu still offered Hold maintenance and a second release. The 50-seed batch reproduced it on seed 1. Resolution now consumes the open decision before each transaction; the batch and replay suite pass afterward.

## Known correctness limitations

1. The source Rules Data Pack is a seven-maneuver representative subset, not the required dual-transcribed full catalog.
2. AI utility is deliberately shallow. It uses visible expected damage, current pools, finish probability, END cost, and referee risk, but not deep multi-phase search.
3. AI action-family acceptance is incomplete because the unimplemented action families cannot yet be made uniquely optimal.
4. Player Charm supports pre-roll attack spend only. Damage and recovery Charm windows remain absent.
5. Countout resolution exists in the GDD but no throw-out action has been implemented, so the branch is unreachable in this checkpoint.
6. Full status-order golden fixtures, manual worked examples, property-based state generation, and cross-platform hash comparison remain required M0/M1 work.
7. The current FNV-1a state hash is deterministic but not cryptographic. Release replays should use a versioned canonical serializer plus a stronger content/state hash.

## Recommended next checkpoint

Checkpoint 0.2 should finish the singles action surface before expanding presentation:

1. Build the dual-entry data-pack pipeline and encode every Appendix B singles golden fixture.
2. Add Irish Whip/momentum, Dodge commitment, ropes, full Charm windows, drawbacks, and throw-out/countout initiation.
3. Replace ad hoc fixture simulations with property-generated legal states and per-action AI acceptance scenarios.
4. Add a Rules Lab scenario loader that can supply scripted dice without marking ordinary matches canonical.
5. Only then promote the shell from "playable checkpoint" to "singles vertical slice candidate."
