# Human accessibility acceptance checklist

Automated Playwright checks cover semantics, accessible names, focus visibility/containment, live regions, narrow layouts, large text, contrast styling, and reduced-motion profiles. They do not certify real assistive technology. Complete this checklist on the exact release commit.

## Navigation and communication

- [ ] Complete all primary surfaces keyboard-only; no trap except intentional modal containment.
- [ ] Confirm visible focus and logical order; focus returns to the invoker after dialogs close.
- [ ] With at least one desktop screen reader, verify names, roles, headings, landmarks, instructions, errors, live match updates, results, and save/import announcements.
- [ ] Dismiss and restart onboarding; verify keyboard and screen-reader behavior.
- [ ] Complete match setup, player decisions, match completion, Career scheduling, progression spending, and save/restore/import/export without a pointer.
- [ ] Trigger blocked actions, invalid/truncated saves, and recovery flows; confirm the correction is announced and focus remains useful.

## Display and preferences

- [ ] 200% browser zoom at desktop width: no lost content or horizontal two-axis reading.
- [ ] 400% zoom / narrow reflow: controls, logs, dialogs, match board, and Career remain operable.
- [ ] OS/browser forced-colors mode: focus, buttons, selected state, errors, and results remain distinguishable.
- [ ] High-contrast preference: text and statuses remain readable without color-only meaning.
- [ ] Reduced-motion preference: nonessential motion is removed and no workflow depends on animation.
- [ ] Verify at least one narrow touch viewport for target size and content reflow.

## Sign-off — intentionally blank

| Field | Entry |
|---|---|
| Build commit | Pending |
| Keyboard reviewer | Pending |
| Screen reader / version | Pending |
| Browser / OS | Pending |
| Zoom and forced-colors reviewer | Pending |
| Blocking findings | Pending |
| Human accessibility approval | **Not signed** |
