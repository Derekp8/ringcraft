# M15 release-candidate human review

This is an execution checklist, not evidence that human review has occurred. Fill it only against an identified release-candidate commit and attach reproducible evidence for failures.

## Build identity

- Commit SHA:
- Package version:
- Release verification report:
- Clean-room archive SHA-256:
- Reviewer:
- Date:

## Rules reviewer matrix

Complete one row for every source-derived rule in `docs/manual-compliance/registry.json`.

| Rule ID | Source document/page/section | Implemented behavior inspected | Expected | Observed | Result | Discrepancy / adjudication |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | PASS / FAIL / AMBIGUOUS | |

Rules-review requirements:

- Never infer a missing page/table reference.
- `unverified-source` remains unverified until an independent reviewer locates the authoritative source and signs the row.
- Record source ambiguity rather than inventing a digital rule.
- Any implementation/source disagreement requires a separate defect with the rule ID, code path, test path, and deterministic reproduction where possible.

## Accessibility reviewer

Record browser, OS, screen reader/assistive technology, zoom level, and result for every case.

| Case | Procedure | Expected | Result / evidence |
| --- | --- | --- | --- |
| A11Y-01 Keyboard navigation | Use only Tab, Shift+Tab, Enter, Space, arrows, Escape through Exhibition, Career, save/import, and match decisions. | Every primary action is reachable; order is logical; no unintended trap. | |
| A11Y-02 Focus visibility | Traverse every actionable control. | Visible focus is always apparent. | |
| A11Y-03 Screen-reader structure | Navigate headings, main/nav/regions, forms, match board, Career dashboard. | Useful names/roles/landmarks; no unlabeled actionable controls. | |
| A11Y-04 Dynamic announcements | Trigger match decisions/results, Career updates, save/import errors, compatibility status. | Important changes are announced without unusable repetition. | |
| A11Y-05 Dialogs | Exercise overwrite/restore/import conflict dialogs. | Focus enters dialog, remains contained, and returns appropriately. | |
| A11Y-06 Error association | Trigger validation/import errors. | Error is understandable and associated with the failed operation/control. | |
| A11Y-07 200% zoom | Exercise setup, match, Career, save/recovery. | No essential content/action is lost. | |
| A11Y-08 400% reflow | Repeat critical paths at 400%. | Required actions remain reachable without two-dimensional page scrolling for ordinary text. | |
| A11Y-09 Forced colors | Exercise statuses and actions in forced/high-contrast colors. | Meaning never depends on color alone. | |
| A11Y-10 Reduced motion | Enable reduced motion. | Information remains complete and motion preference is respected. | |

Automated DOM/visual checks support this review but do not constitute screen-reader certification.

## Human playtest sessions

For every session record: commit, mode, AI difficulty, seed/replay identity, duration, finish/result, blocker/major/minor observations, unclear rules/prompts, AI-quality observations, and save/recovery confidence.

### PT-01 Novice singles

- Start a normal-random Exhibition singles match at Novice.
- Complete an official finish.
- Replay the match and compare result/identity.
- Record whether mistakes feel intentional rather than illegal or broken.

### PT-02 Standard singles

- Complete a Standard singles match.
- Record decision clarity, pacing, finish clarity, and any apparent AI rule advantage.

### PT-03 High-difficulty singles

- Complete at least one Veteran or Ruthless singles match.
- Record tactical quality, pathological loops, ignored obvious finishes, and any indication that difficulty altered dice/probabilities.

### PT-04 Tag

- Complete a tag match.
- Exercise at least one legal tag and, when available, partner/interference/double-team state.
- Confirm the legal wrestler and outside-partner state remain understandable.

### PT-05 Career

- Create a new Strict Manual Career.
- Confirm compatibility presentation.
- Schedule/accept and complete the first match.
- Commit the result once and inspect record/progression/title information.
- Create and load a named save.

### PT-06 Recovery/save

- Begin a deterministic Career match and record seed/campaign identity.
- Make several player decisions and create the supported recovery checkpoint.
- Reload/reopen the application and continue.
- Compare final replay identity to an uninterrupted reference execution using the same setup and choices.

## Strict Manual review

- Strict Manual control is visible during Career setup.
- With Strict Manual selected, post-match D20 injury, cage/ladder, finance/contracts/popularity, chemistry, negotiation/renewal, feud/booking controls cannot be enabled for the new campaign.
- AI difficulty remains selectable and is described as action-selection policy only.
- Loaded extension-enabled campaigns are not silently rewritten; every incompatibility is listed.
- Existing extension-off saves remain compatible without migration or a persisted `strictManual` flag.

## Defect record

- ID:
- Severity: blocker / major / minor / cosmetic
- Commit SHA:
- Browser / OS / assistive technology:
- Mode / difficulty:
- Seed:
- Replay hash:
- Campaign hash:
- Rule ID, if applicable:
- Preconditions:
- Exact steps:
- Expected:
- Observed:
- Reproducible: yes / no
- Screenshot/log/save/replay evidence:
- Resolution / accepted risk:

## Acceptance boundary

Human/external QA is not complete until an independent source reviewer signs the applicable source-derived registry entries, actual assistive-technology review is executed, the six playtest sessions are completed with reproducible evidence, and blocker defects are resolved or explicitly accepted. Automated release-candidate gates passing must be reported separately from full human/external approval.
