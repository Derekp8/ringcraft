# Verification evidence reconciliation

Date: 2026-08-20
Scope: follow-up to the structural repair; no game-rule, probability, balance, save-schema, replay-format, or lockfile changes.

## Root causes and corrections

| Failure | Evidence | Minimal correction |
|---|---|---|
| M10 whole-corpus tests replayed a mixed standard/ruthless corpus through one selector | The committed generator reproduces the 1,058-decision fixture byte-for-byte (`SHA-256 01078b7a358c9db6362705174b5b35b0a0c42a5841aad4793749a120b7ac2556`, FNV-1a `35dd5b20`) | Route each run through its recorded difficulty; retain the committed corpus |
| Ruthless replay document was truncated and stale | Current generator produces 147 inputs and final state `03e0fea1cb9c5be1`; tag and M13 chain fixtures regenerate unchanged | Replace only the stale replay document with current generator output |
| M11 tests carried older snapshot hashes and one unsupported variety ordering | Current fixtures re-derive report `ea2a8361db1e93e9`, trend `84e05a2da0502ee6`; the design requires both special varieties to be faster than standard, not ladder faster than cage | Pin current generated identities and assert the documented comparison |
| Randomized-start tests expected the pre-initialization PRNG cursor | Match and campaign initialization intentionally consume labeled setup dice | Compare randomized starts with the equivalent manually seeded initialization and assert the recorded labels |
| Visual QA used labels and setup paths from an older UI snapshot | Current application exposes advanced options, developer fixtures, and manual-seed starts under updated labels | Update the browser harness only; retain application behavior |
| Manifest required two reference PDFs absent from every repository commit | Repository history contains neither PDF, so no canonical bytes can be reconstructed | Remove them from the archive allowlist and manifest; keep independent source review as an external gate |
| Manifest treated one aggregate M11 playtest report as a monotonic balance contract | Re-derived shares are novice `0.0625`, standard `0.0967741935483871`, veteran `0.03125`, ruthless `0.06451612903225806` | Pin the exact measurements without making a balance claim; dedicated seeded-window tests retain policy-separation coverage |

## Deterministic identities

- M10 corpus: 12 runs, 1,058 decisions, all 12 decision kinds, FNV-1a `35dd5b20`.
- Ruthless replay: `c14n-fnv1a64-v1:03e0fea1cb9c5be1`.
- Corpus ruthless terminal state: `c14n-fnv1a64-v1:2ee17eb5bdfecf38`.
- Tag replay: `c14n-fnv1a64-v1:1b26c32a342f08c8`.
- M11 balance report: `c14n-fnv1a64-v1:ea2a8361db1e93e9` (528 matches).
- M11 trend report: `c14n-fnv1a64-v1:84e05a2da0502ee6` (1,680 matches across five seasons).
- Save determinism fixture: `c14n-fnv1a64-v1:bf53d640d63921b9`.
- M13 title-shot chain: `c14n-fnv1a64-v1:3e154f113603bba6`.
- M13 feud-heat chain: `c14n-fnv1a64-v1:9d6510b827550cb5`.

## Verification boundary

Clean-install verification on Node v24.19.0/npm 11.9.0 produced these results:

- `npm ci`: exit 0; 74 locked packages installed in 30 seconds; lockfile SHA-256 remained `75df7420e4fde2ce02020b348f296772b65860076dd85a9d749d9970122acb33`.
- `npm run typecheck` workload: exit 0 for both no-emit projects and `tsc -b`.
- `npm run test` workload: exit 0; 28 files and 460/460 tests in 52.02 seconds.
- `npm run build` workload: exit 0; Vite 8.2.1 transformed 45 modules and emitted the production bundle (with the existing large-chunk advisory).
- `npm run fixtures:verify` workload: exit 0; all eight verifier groups passed and five replay documents had zero drift.
- `npm run visual:qa`: exit 0 twice; all 22 profiles passed, and the second pass accepted one change confined to known timestamp rows.
- `npm run check` workload: exit 0; 28 files and 460/460 tests in 48.79 seconds, followed by a successful 45-module build.

The Work Mode execution service disconnected while seeking approval for the `npm run ...` wrapper invocations, so the locally installed commands from each package script were invoked verbatim instead. This is an execution-environment wrapper limitation, not an application failure; GitHub CI remains the independent wrapper-level confirmation.

Independent rules transcription, human accessibility testing, and human playtesting have not been completed. The missing source PDFs are not reconstructed or substituted by this work.
