# M14 manual compliance and Strict Manual Mode

M14 adds a machine-readable provenance layer without changing the match rules, dice probabilities, save schema, replay schema, data-pack identity, or AI policy.

## Compliance registry

`docs/manual-compliance/registry.json` maps stable rule/extension IDs to implementation paths and automated tests. Run:

```bash
npm run compliance:verify
```

The verifier fails for duplicate IDs, missing required metadata, missing implementation/test paths, adjudicated extensions without adjudication references, or a source record claiming verification without source provenance and automated coverage.

The present source gate remains deliberately conservative. The historical authoritative source tables have not received independent second-human transcription/sign-off, and the two source PDFs named by older handoff material are not present in repository history. Core manual-derived entries are therefore classified `unverified-source`; no page numbers or section citations are invented. Completion of the external review should promote records to `source-rule`, `source-table`, `source-example`, or `source-edge-case` only after the exact source reference is recorded.

## Strict Manual Mode

`src/core/manual-mode.ts` defines `strict-manual-derived-v1`. It is a **derived compatibility profile**, not a new save field. That is intentional: existing extension-off campaign documents remain byte-identical and the profile can be recomputed after save/import from persisted settings.

A campaign is strict-manual compatible only when all adjudicated gameplay extensions are absent/off and match variety is standard. The current guard rejects:

- post-match D20 injury checks;
- cage/ladder match variety;
- contracts/finance/popularity state;
- chemistry pairs;
- contract negotiation;
- curve-fair renewals;
- feud/booking policy and feud setup.

AI difficulty is allowed because the AI policy selects among legal visible-state actions and does not alter rules dice or outcome probabilities.

The M14 helper is currently a core enforcement/diagnostic boundary. A dedicated UI badge/toggle that calls the guard before creating a configured campaign is still a follow-up UI integration task; the underlying compatibility decision is already deterministic and save-neutral.

## Readiness commands

M14 introduces verification tiers:

```bash
npm run compliance:verify
npm run e2e
npm run check:fast
npm run check:full
npm run release:verify
```

`check:fast` is intended for development feedback. `check:full` retains the existing full unit/build/fixture evidence. `release:verify` adds visual QA and clean-room packaging verification and writes `output/readiness/release-verification.json`.

Passing automation does not complete the external source, accessibility, or human-playtest gates. See `docs/qa/m14-human-qa.md`.
