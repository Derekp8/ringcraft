# M9 Private Handoff and External QA Evidence — Design

**Project:** Project Ringcraft 1.2.0 M8 accessibility-hardening candidate  
**Status:** Approved design, implemented  
**Date:** 2026-08-13

## Goal

Produce a clean, reproducible private handoff archive and an external evidence record for the completed M5–M8 candidate. M9 is packaging and verification work; it does not add runtime behavior or change campaign compatibility.

## Archive Identity

The canonical archive name is:

```text
asw91-project-ringcraft-m9-private-handoff-1.2.0.zip
```

The final archive SHA-256 is recorded externally in the evidence file. It is not inserted into the archive’s own manifest because that would change the archive bytes and invalidate the checksum.

## Compatibility Boundary

M9 must not modify:

- `src/core/campaign.ts`
- `src/core/campaign-rules.ts`
- `src/core/campaign-serialization.ts`
- `src/core/hash.ts`
- Campaign schema `asw91-campaign-v1`
- M5 rules/data versions, data hash, PRNG behavior, fixtures, or replay formats

The archive must contain the current M7/M8 presentation and QA work without adding dependencies, telemetry, network behavior, accounts, or cloud persistence.

## Archive Builder

Add `scripts/build-m9-handoff.mjs` using Node built-ins and existing package tools.

The builder creates a temporary staging directory and copies only the allowlisted payload:

- `package.json`, `package-lock.json`, TypeScript/Vite configuration, and `index.html`
- `src/`
- `tests/`
- `scripts/`
- `fixtures/m5/`
- `docs/`
- `reference/`
- `README.md`, `FREEBUFF-HANDOFF.md`, `HANDOFF-MANIFEST.json`, and `.gitignore`
- Reviewed screenshots explicitly named by the manifest evidence list

The builder excludes and rejects:

- `node_modules/`
- `dist/`
- `.freebuff/`
- `output/qa/browser-cache/`
- `output/qa/browser-runtime/`
- Temporary files, editor locks, test artifacts, and unreviewed/generated output

It must fail if an unexpected path enters the staging tree. Archive entries must use stable forward-slash paths and deterministic ordering. The builder reports the archive path, byte size, and SHA-256.

## Clean-Room Verifier

Add `scripts/verify-m9-handoff.mjs`.

The verifier:

1. Creates a fresh temporary extraction directory.
2. Extracts the M9 archive and confirms the expected project root.
3. Verifies no excluded path exists.
4. Runs `npm ci` with the included lockfile.
5. Runs `npm run check`.
6. Runs `npm run fixtures:verify` and compares the known completed campaign, replay, and recovered continuation hashes.
7. Runs `npm run visual:qa` using Linux portable Chromium as the canonical browser target.
8. Captures command, runtime, exit code, duration, and relevant output.
9. Removes temporary extraction and dependency directories after evidence capture.

Windows Edge results remain local development evidence and must be labeled separately from canonical Linux clean-room QA.

## Evidence Record

Add `docs/m9-handoff-evidence.md` documenting:

- Archive name, byte size, and external SHA-256 procedure.
- Allowlist and exclusion policy.
- Clean-room runtime and commands.
- Test/build/fixture/visual-QA results.
- Campaign and replay hashes.
- Windows-versus-Linux browser distinction.
- Human accessibility review items still pending.
- Independent source transcription/adjudication and playtest balance/pacing gates still pending.

The verifier writes machine-readable evidence outside the archive, such as `output/m9/m9-verification.json`. That output must be ignored or excluded from the handoff payload unless explicitly selected as reviewed evidence.

## Tests

Add `tests/m9-packaging.test.ts` for UI-independent packaging contracts:

- Required archive name.
- Required allowlisted roots and files.
- Rejection of `.freebuff`, `node_modules`, `dist`, browser runtimes, caches, temporary files, and unreviewed output.
- Required evidence files and manifest entries.
- Stable normalized archive path format.

Existing application tests remain unchanged at 104 tests. Packaging tests must not import or mutate campaign state.

## Failure Handling

- Unexpected archive paths fail before installation.
- Lockfile changes during clean-room verification fail the run.
- Any test, build, fixture, browser-QA, or hash mismatch fails the verifier.
- Human-review items are recorded as `pending`, never as automated passes.
- Temporary directories are cleaned after success or failure where possible.
- Archive creation never regenerates or rewrites deterministic fixtures.

## Verification

Existing gates remain:

```text
npm.cmd run check
npm.cmd run fixtures:verify
npm.cmd run visual:qa
```

M9-specific commands are:

```text
node scripts/build-m9-handoff.mjs
node scripts/verify-m9-handoff.mjs <archive-path>
```

Canonical clean-room verification is expected on Linux with portable Chromium. No commit is created unless explicitly requested.
