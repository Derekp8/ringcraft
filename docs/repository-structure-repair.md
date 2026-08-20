# Repository structure repair report

## Scope

The August 20, 2026 `Add files via upload` commits flattened Project Ringcraft's source, test, script, fixture, documentation, workflow, hook, and reviewed-image paths. This repair restores the canonical paths established by imports, npm scripts, `HANDOFF-MANIFEST.json`, the M9 packaging contract, and the pre-upload repository history. It does not change match rules, probabilities, campaign schemas, data-pack identities, replay formats, or fixture contents.

## Reconstructed tree

| Restored path | Contents |
|---|---|
| `src/core/` | Rules, engine, AI, campaign, serialization, hashes, PRNG, roster, creation, and progression |
| `src/ui/` | React application, panels, presentation, save/sync, playtest dashboard, styles, and retained onboarding components |
| `tests/` | 28 discovered Vitest suites |
| `scripts/` | Generators, verifiers, visual QA, clean-room packaging, replay tooling, and mock sync server |
| `fixtures/m5/` | Completed/in-progress campaigns and compact replay |
| `fixtures/m10/` | AI corpus and ruthless campaign |
| `fixtures/m11/` | Cage/ladder replays and playtest reports |
| `fixtures/saves/` | Save-manager determinism evidence |
| `fixtures/replays/` | Ruthless/tag replay documents and M13 title-shot/feud chains |
| `docs/` | Audits, matrices, limitations, save policy, and design specifications |
| `.github/workflows/` | Typecheck, manifest-pin, clean-room, and visual-stability workflows |
| `.githooks/pre-commit` | LF-pinned TypeScript pre-commit typecheck hook |
| `output/qa/` | Reviewed screenshots |

The upload artifacts `download` and `download (1)` were identified by content as `.gitattributes` and the newer `.gitignore`. Their canonical content was restored before the mislabeled files were removed. The `m5` root file was a concatenation artifact superseded by the individual project files and was removed. The older root-level onboarding handoff documents predate the flattening and remain at their historical paths.

## Narrow compatibility repairs

- Renamed `useOnboardingPhaseGuard.ts` to `.tsx` because it contains JSX.
- Corrected the retained onboarding test imports to `src/ui/onboarding`.
- Removed a nonexistent context-property destructure from `GuidedAction` without changing its behavior.
- Adapted the secure-random `getRandomValues` call to the locked TypeScript DOM typed-array signature; entropy and PRNG behavior are unchanged.

## Verification record

Environment: Linux, Node.js 24.19.0, npm lockfile unchanged.

| Command | Result |
|---|---|
| `npm ci` | Passed; 74 packages installed. The first workspace attempt failed only because `/root/.npm` was unwritable; rerun with an isolated cache passed. |
| `npm run typecheck` | Passed. |
| `npm run test` | Failed: 28 files, 460 tests, 448 passed and 12 failed. |
| `npm run build` | Passed; 45 modules, JS 668.90 kB (173.57 kB gzip), CSS 32.29 kB (7.49 kB gzip). |
| `npm run fixtures:verify` | Failed in the final replay-document verifier; all preceding fixture verifiers completed. |
| `npm run visual:qa` | Failed at `scripts/visual-qa.mjs:662`, timing out while the tag profile waited for `Nova Hart`. The partially regenerated screenshot was discarded. |
| `npm run check` | Failed in the test phase: 28 files, 460 tests, 447 passed and 13 failed; the thirteenth failure was a five-second replay-verifier timeout that passed in the standalone test run. |

## Unresolved mixed-snapshot evidence

The uploaded files are not one internally consistent verified snapshot:

1. The M10 corpus fixture replays internally as 1,058 decisions with FNV-1a pin `35dd5b20`, but tests, `HANDOFF-MANIFEST.json`, and historical handoff evidence expect 1,050 decisions and `64e1f4af`.
2. The ruthless replay document pins `c14n-fnv1a64-v1:43945f1cc482e0cd`; the uploaded engine/AI code derives `c14n-fnv1a64-v1:95955a3dd0688411`.
3. The uploaded M11 trend report contains `c14n-fnv1a64-v1:84e05a2da0502ee6`, while its test expects `c14n-fnv1a64-v1:bf866d8e3a3d8b97`.
4. The M11 dashboard test requires ladder mean duration to be below cage duration, while the uploaded report records both as `2.546875` minutes.
5. Two randomized-play assertions expect newly created match/campaign RNG state to remain at its initial seed, although creation records required dice and advances that same deterministic RNG.
6. The novice hint test requires the exact phrase `suboptimal move`; the uploaded UI copy describes `strategic mistakes`.
7. The visual tag profile expects `Nova Hart`, but the uploaded surface never reaches that text within the 30-second gate.
8. The historical manifest names two required `reference/` PDFs that are absent from every commit in this GitHub repository.

No fixture was regenerated, no deterministic pin was changed, and no gameplay logic was altered to hide these conflicts. The authoritative source snapshot or an explicit decision about which evidence generation is canonical is required before the branch can honestly be called fully verified.
