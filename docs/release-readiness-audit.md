# Final release-readiness audit

Audit date: 2026-08-21

Starting point: `repair/reconcile-verification-evidence` at `7d9ace1129e8e07cbdfb2aad9b4fc33d4eab5e17`

Working branch: `fix/final-playability-readiness`

## Executive verdict

Ringcraft is a runnable, review-ready private release candidate for a local solo-versus-AI game. It is not a formally manual-certified or human-accessibility-certified release. Automated evidence covers installation, production build, random normal-play entry points, deterministic replay, legal and live-RNG-isolated AI, singles and tag completion, campaign persistence, fixture reproduction, browser flows, and package integrity. The remaining gates require people and source material: an authorized second reader must compare the private manual/GDD to the encoded rules, human players must accept pacing, and human assistive-technology testing must be recorded.

## Scope and compatibility

This phase changes no manual-derived rule, die type, probability, table value, maneuver value, result procedure, PRNG algorithm, AI policy, rules/data-pack version, save/replay schema, deterministic fixture identity, or lockfile. Cage, ladder, finance/contracts, popularity/chemistry, negotiation, feud, and booking remain opt-in Ringcraft extensions.

## Capability assessment

| Capability | Evidence | Result |
|---|---|---|
| Fresh normal-play dice | `generateRandomSeed`, `createRandomMatch`, `createRandomCampaign`; unit and browser-path assertions | Automated pass; platform entropy selects a nonzero 32-bit start seed |
| Exact replay | replay fixtures, corpus verifier, input-log replay and state hashes | Automated pass |
| Singles/tag play | core stress tests, seeded batch fixtures, browser profiles | Automated pass; human pacing acceptance pending |
| AI fairness | all four difficulties choose enumerated legal actions; hidden live RNG mutation does not change a decision | Automated pass |
| Career and persistence | campaign, migration, active-match checkpoint, autosave, named-save, bundle and sync tests | Automated pass |
| Production delivery | locked install, typecheck, tests, Vite build, preview/browser QA, M9 archive | Verification table in the final PR description/run record |
| Manual compliance | existing rules audit and traceability plus this phase's closure packet | Internal match; independent source sign-off pending |
| Accessibility | automated semantics, keyboard, focus, layout and preference profiles | Automated pass; human AT/zoom/forced-colors sign-off pending |

## Defects found and disposition

1. Replay-verifier mutation tests performed legitimate full event-chain reconstructions and the two reported cases took about 3.0–3.4 seconds in isolation, leaving too little margin under Vitest's five-second default on a contended GitHub runner. The verifier also reconstructed each M13 chain twice, and replayed matches even after detecting an incompatible replay/ruleset version. Duplicate M13 derivations were removed, incompatible versions now stop before execution, and only the remaining M13 chain cases receive a scoped 15-second budget. All exact-field diagnostics remain asserted; no global timeout or game/replay identity changed.
2. The visual workflow installed/asserted DejaVu for every family, but the committed canonical Linux pins were rendered with `Arial Narrow` resolving to URW Nimbus Sans Narrow and generic monospace resolving to DejaVu Sans Mono. Consecutive generated runs were stable but differed from all pins through narrow-face metrics and page height. CI now installs and asserts both canonical families instead of re-baselining screenshots.
3. Random constructors were unit-tested, but the ordinary Exhibition and Career buttons lacked an explicit browser-level seed-path assertion. Visual QA now deterministically stubs only platform entropy for that assertion and verifies that each ordinary button stores the supplied random seed. The game PRNG remains unchanged.
4. `IMPLEMENTATION_CHECKLIST.md` was a historical M6 scaffold that incorrectly looked authoritative. It now points to the current implementation audits and human acceptance checklists.

## Product decisions

- Manual seeds, hashes, fixture shortcuts, and Rules Lab remain available in clearly advanced/QA-oriented surfaces for reproducibility. Moving them behind a build flag would make private debugging harder and is not required for this private candidate. A public consumer build should revisit that decision.
- Existing deterministic pacing evidence does not justify modifying source rules or AI values. Draw-heavy samples are concentrated in intentionally short time limits and high-END/equal-strength fixtures. Human playtesting remains the acceptance authority.
- Browser-local persistence requires deliberate JSON or save-bundle export for durable backup; no account-backed cloud save is configured.

## External blockers

- The source PDFs are not present in the repository and were not reconstructed. Independent private page-by-page transcription and adjudication initials are absent.
- No human pacing/playability sign-off has been recorded.
- No human screen-reader, 200%/400% zoom, or forced-colors acceptance has been recorded.
- Rights clearance, public distribution, installers, storefront work, localization, telemetry, marketing, and commercial release are out of scope.

Recommendation: **review-ready but blocked** from a “fully certified” label by the three human gates above.
