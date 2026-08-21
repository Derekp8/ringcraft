# M14 human QA package

Automation cannot certify the remaining external gates. Use this package for controlled review; record every discrepancy with the build commit, save/replay identity, exact reproduction steps, expected behavior, observed behavior, and severity.

## A. Independent manual-rules review

For each authoritative manual/table entry:

1. Record the exact document, page, section/table name, and verbatim-identifying label (do not copy long copyrighted passages into the repository).
2. Locate or create the matching `ruleId` in `docs/manual-compliance/registry.json`.
3. Confirm the registry implementation paths actually encode the rule.
4. Confirm the listed tests exercise the rule, boundaries, and exceptions.
5. Classify the result:
   - `MATCH` — source, implementation, and test agree.
   - `SOURCE-AMBIGUOUS` — source wording/table is unclear; do not invent a rule.
   - `IMPLEMENTATION-DRIFT` — code differs from source.
   - `TEST-GAP` — implementation appears correct but automated coverage is missing/inadequate.
   - `ADJUDICATION-REQUIRED` — digital behavior needs an explicit documented decision.
   - `REGISTRY-ERROR` — compliance metadata is wrong/incomplete.
6. Only after independent sign-off promote an `unverified-source` entry to a source classification and record its exact provenance.

Reviewer: __________  Date: __________  Commit: __________

## B. Accessibility review

Run each item with the same release-candidate build and capture blocking defects separately from polish.

- Keyboard-only: reach every primary action, setup field, save control, dialog, and navigation target without a mouse.
- Focus order: confirm logical order and no focus traps except intentional modal containment.
- Visible focus: verify focus indicator remains visible on all interactive surfaces.
- Screen reader: confirm controls, headings, landmarks, status changes, dialogs, validation messages, and match/campaign updates have useful names/announcements.
- Dialogs: initial focus enters, Tab/Shift+Tab cycle correctly, Escape behavior is appropriate, and focus returns to the invoker.
- Live updates: important match/campaign changes are announced without flooding.
- Zoom/reflow: test at 200% and 400%; no essential content/action becomes unreachable.
- Forced colors/high contrast: status meaning remains available without relying only on color.
- Reduced motion: confirm motion preference is respected and does not remove information.
- Text/status: no clipped, ellipsized, or color-only critical status.

Assistive technology/browser: __________  Reviewer: __________  Commit: __________

## C. Human playtest sessions

### Session 1 — Singles exhibition

- Start a normal-random singles match.
- Record displayed seed/replay identity if surfaced.
- Make normal player decisions through an official finish.
- Export/replay the completed match and confirm the result is identical.
- Record: unclear rule prompts, impossible/empty decisions, AI mistakes, pacing problems, finish clarity.

### Session 2 — Tag exhibition

- Complete a tag match.
- Exercise legal tags and team-state changes.
- Confirm legal wrestler/team state is always understandable.
- Replay and compare final result/hash.

### Session 3 — Career

- Create/import a career.
- Accept or schedule a legal match.
- Complete and commit it exactly once.
- Confirm record/progression/title/injury information is understandable.
- Save, reload, and verify the campaign resumes unchanged.

### Session 4 — Save/resume and recovery

- Save before a match, during a supported checkpoint, and after a completed match.
- Reload each supported checkpoint.
- Confirm no duplicated result commit, changed next dice, missing event, or altered campaign identity.

### Session 5 — AI difficulty

- Play representative matches at novice, standard, veteran, and ruthless.
- Judge action quality only; report any suspicion that difficulty changed dice/probabilities as a blocker.
- Record obvious winning actions ignored, nonsensical tags, irrational defensive choices, or repeated loops.

### Session 6 — Strict Manual compatibility

- Use a campaign/configuration with every adjudicated gameplay extension disabled.
- Confirm standard match variety only.
- Confirm no finance, negotiation, popularity/chemistry mechanical effect, feud/booking effect, or optional post-match D20 injury roll appears.
- Any extension-only event/modifier/roll is a blocker.

## D. Defect record

For each issue capture:

- ID:
- Severity: blocker / major / minor / cosmetic
- Commit:
- Browser/OS:
- Mode: singles / tag / career / recovery / strict-manual
- Seed:
- Replay hash / campaign hash:
- Steps:
- Expected:
- Observed:
- Screenshot/log/save/replay attachment:
- Source rule ID (if applicable):
- Reproducible: yes/no

## Acceptance boundary

Human QA is complete only when blocker defects are resolved or explicitly accepted, the independent source review has signed every source-derived registry entry in scope, the accessibility checklist has been executed with actual assistive technology, and the playtest sessions have recorded reproducible evidence. Automated green checks alone do not satisfy this package.
