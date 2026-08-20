# M8 Accessibility and Acceptance Hardening — Design

**Project:** Project Ringcraft 1.2.0 M7 playtest-readiness candidate  
**Status:** Approved design, implemented  
**Date:** 2026-08-13

## Goal

Improve keyboard operation and semantic accessibility across every application surface while making the automated acceptance boundary explicit. M8 is UI and QA hardening only; it does not change campaign behavior or claim to replace human assistive-technology review.

## Compatibility Boundary

M8 must not modify:

- `src/core/campaign.ts`
- `src/core/campaign-rules.ts`
- `src/core/campaign-serialization.ts`
- `src/core/hash.ts`
- Campaign schema `asw91-campaign-v1`
- M5 rules/data versions, data hash, PRNG behavior, fixtures, or replay formats

Changes are limited to React UI semantics, CSS focus treatment, browser QA, tests for UI-independent contracts, and review documentation. Existing M7 local notes and report formats remain unchanged.

## Audit Architecture

Extend `scripts/visual-qa.mjs` with shared native Playwright helpers:

- `assertAccessibleNameCoverage(profile)`: visible buttons, inputs, selects, textareas, and links must have accessible names.
- `assertLandmarkAndHeadingStructure(profile)`: the page has one main landmark, labeled major regions, and useful non-empty headings.
- `assertKeyboardTraversal(profile, selector)`: focus moves through the selected surface, remains visible, and does not unexpectedly leave the surface.
- `assertDialogAccessibility(profile, selector)`: verifies dialog role, `aria-modal`, title labeling, initial focus, Tab containment, Escape dismissal, and return focus.
- `assertLiveRegion(profile, selector)`: status and validation updates use a live region where appropriate.
- `assertNoColorOnlyStatus(profile)`: status elements expose visible text in addition to visual styling.

The helpers run across:

- Exhibition
- Creator
- Progression
- Career setup and dashboard
- Active Career match and recovery
- Onboarding dialog
- M7 Playtest panel
- Existing accessibility, narrow, and high-contrast profiles

The helpers should report profile-specific failures without hiding the existing visual, overflow, console-error, or required-control checks.

## UI Remediation

Apply only targeted fixes found by the acceptance checks:

- Add or correct `aria-label`, `aria-labelledby`, and `aria-describedby` where accessible names or descriptions are missing.
- Give major surfaces meaningful labeled regions.
- Preserve a logical heading hierarchy without changing intended visual hierarchy.
- Add or strengthen `:focus-visible` treatment where focus is difficult to track.
- Announce validation, save, import, recovery, and playtest status updates with `aria-live`.
- Preserve onboarding focus containment and return-focus behavior.
- Make keyboard order predictable across navigation, accessibility options, forms, action grids, Career controls, fixture shortcuts, playtest notes, and exports.
- Preserve large-text, high-contrast, reduced-motion, responsive, and text-based status behavior.

No new accessibility dependency, network behavior, telemetry, or browser service is introduced.

## Human Review Boundary

Add `docs/m8-accessibility-review-checklist.md` documenting manual review items that automated Playwright checks cannot establish:

- Keyboard-only completion of representative workflows.
- Screen-reader landmarks, reading order, names, descriptions, and announcements.
- 200% zoom and text reflow.
- High contrast and forced-colors behavior.
- Reduced-motion behavior in the target browsers.
- Focus visibility and focus restoration after confirmations and downloads.
- Playtest panel usability during an active match.

The checklist must distinguish verified automated checks from pending human review and must not claim formal accessibility certification.

## Testing

Add `tests/m8-accessibility.test.ts` only for UI-independent contracts that need regression coverage. Browser behavior remains in `scripts/visual-qa.mjs`.

The browser suite must cover:

- Accessible names for all visible interactive controls on each surface.
- Landmark and heading structure.
- Keyboard traversal and visible focus.
- Onboarding dialog focus containment, Escape, and return focus.
- Live-region presence for validation, save, recovery, and playtest status.
- Text-based status cues rather than color-only meaning.
- Narrow and accessibility-mode variants.

Existing M7 fixture shortcuts and playtest report flows must remain reachable and functional.

## Verification

```text
npm.cmd run check
npm.cmd run fixtures:verify
npm.cmd run visual:qa
```

All existing 104 tests and all campaign/replay hashes must remain unchanged and passing. After verification, update the M8 audit, README, handoff, known-limitations record, and manifest counts/hashes. Do not commit unless explicitly requested.
