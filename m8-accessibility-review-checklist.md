# M8 Accessibility Review Checklist

## Boundary

The automated M8 checks verify browser-observable semantics and keyboard behavior. They do not constitute formal accessibility certification or replace a human assistive-technology review.

## Automated Checks

- [x] Visible buttons, links, inputs, selects, and textareas have accessible names.
- [x] The application exposes one main landmark.
- [x] Navigation, event logs, dialogs, and labeled regions expose semantic names.
- [x] Visible headings are non-empty.
- [x] Keyboard focus stays inside the active surface during representative traversal.
- [x] Keyboard focus is `:focus-visible` during Tab traversal.
- [x] Onboarding dialog semantics, initial focus, Tab wrapping, Escape dismissal, and return focus are checked.
- [x] Live-region presence is checked for playtest status updates.
- [x] Match decision prompts, result states, and latest event summaries are announced through live regions.
- [x] Status indicators expose visible text rather than color-only meaning.
- [x] Narrow, large-text, high-contrast, reduced-motion, Career, active-match, and Playtest profiles pass.

## Human Review Required

- [ ] Complete representative workflows using keyboard only, without pointer input.
- [ ] Review landmarks, reading order, names, descriptions, and announcements with a screen reader.
- [ ] Test 200% zoom and text reflow without loss of controls or information.
- [ ] Test high-contrast and forced-colors behavior in target browsers.
- [ ] Confirm reduced-motion behavior in target browsers and operating-system settings.
- [ ] Confirm focus visibility and focus restoration after dialogs, confirmations, downloads, and imports.
- [ ] Review Playtest panel usability during an active match.
- [ ] Record browser, operating system, assistive technology, findings, and retest status.

## Verification Command

```text
npm.cmd run visual:qa
```
