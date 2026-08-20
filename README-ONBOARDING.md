# Project Ringcraft M6 — Onboarding System

## Overview

This repository contains the **complete onboarding system for Project Ringcraft M6**. The system guides new players through Career mode setup, teaches core mechanics progressively, and provides contextual help throughout the game.

**Status:** ✅ Core system complete. Ready for integration into Career UI.

## What's Included

### Core System
- ✅ **OnboardingProvider** — State management with localStorage persistence
- ✅ **OnboardingOverlay** — Full-screen spotlight tutorial with modal cards
- ✅ **OnboardingTooltip** — Lightweight contextual hints
- ✅ **GuidedAction** — Wrapper to block/guide user actions during phases
- ✅ **OnboardingFlowOrchestrator** — Automatic phase progression
- ✅ **30+ pre-written tutorial steps** — Welcome, character creation, team setup, dashboard orientation, first actions

### Advanced Features
- ✅ **OnboardingProgressIndicator** — Visual progress bar and phase tracker
- ✅ **OnboardingHints** — Context-aware tips based on current phase
- ✅ **useOnboardingPhaseGuard** — Fine-grained feature access control
- ✅ **useFeatureAvailability** — Conditional rendering hook
- ✅ **useOnboardingAnalytics** — Event tracking and drop-off analysis

### Documentation & Examples
- ✅ **ONBOARDING-INTEGRATION.md** — Complete integration guide
- ✅ **INTEGRATION_EXAMPLE.tsx** — Full working example
- ✅ **onboarding.test.ts** — Unit tests
- ✅ **M6-ONBOARDING-PLAN.md** — Design and implementation notes

## Quick Start

### 1. Install Dependencies

```bash
npm ci
```

### 2. View System Architecture

The onboarding system lives in `src/ui/onboarding/`:

```
src/ui/onboarding/
├── types.ts                           # Type definitions
├── OnboardingContext.tsx              # State management
├── steps.ts                           # Tutorial content (30+ steps)
├── OnboardingOverlay.tsx              # Full-screen tutorial UI
├── OnboardingOverlay.css              # Overlay styling
├── OnboardingTooltip.tsx              # Inline hints UI
├── OnboardingTooltip.css              # Tooltip styling
├── GuidedAction.tsx                   # Action wrapper
├── OnboardingFlowOrchestrator.tsx     # Automatic flow management
├── OnboardingProgressIndicator.tsx    # Progress bar component
├── OnboardingProgressIndicator.css    # Progress styling
├── OnboardingHints.tsx                # Context-aware hints
├── OnboardingHints.css                # Hints styling
├── useOnboardingPhaseGuard.tsx        # Feature access control
├── useOnboardingAnalytics.ts          # Event tracking
├── index.ts                           # Public exports
├── advanced.ts                        # Advanced feature exports
└── INTEGRATION_EXAMPLE.tsx            # Full working example
```

### 3. Basic Integration

In your Career component:

```tsx
import {
  OnboardingProvider,
  OnboardingFlowOrchestrator,
  OnboardingOverlay,
} from './ui/onboarding';

function Career() {
  return (
    <OnboardingProvider>
      <OnboardingFlowOrchestrator />
      <OnboardingOverlay />
      
      {/* Your career UI here */}
      <CareerDashboard />
    </OnboardingProvider>
  );
}
```

### 4. Mark UI Elements

Add `data-onboarding` attributes to elements you want to highlight:

```tsx
<div data-onboarding="calendar">
  <Calendar />
</div>

<div data-onboarding="ratings-panel">
  <RatingsTable />
</div>
```

## Phases

Onboarding progresses through 6 phases automatically:

1. **welcome** — Career mode selection (solo/tag)
2. **character-creation** — Create your wrestler and customize stats
3. **team-setup** — Select tag partner (tag mode only)
4. **dashboard-orientation** — Learn the dashboard UI and mechanics
5. **first-actions** — Book and complete your first match
6. **complete** — Graduation; all features unlocked

Each phase contains multiple tutorial steps. Steps are auto-triggered and auto-advance.

## Core Hooks

### `useOnboarding()`

Main hook for accessing onboarding state and methods:

```tsx
const {
  state,              // OnboardingState object
  nextPhase,          // () => void
  goToPhase,          // (phase: OnboardingPhase) => void
  completeStep,       // (stepId: string) => void
  showStep,           // (stepId: string) => void
  hideStep,           // () => void
  dismiss,            // () => void (exit onboarding)
  reset,              // () => void (restart)
  setCareerMode,      // (mode: 'solo' | 'tag' | null) => void
  getCurrentStep,     // () => OnboardingStep | null
} = useOnboarding();
```

### `useOnboardingPhaseGuard(featureName)`

Check if a feature is currently accessible:

```tsx
const { allowed, unlocksAt, currentPhase } = useOnboardingPhaseGuard('book-match');

if (!allowed) {
  return <div>This feature unlocks in {unlocksAt} phase.</div>;
}
```

### `useFeatureAvailability(featureName)`

Conditionally render content:

```tsx
const renderIfAvailable = useFeatureAvailability('view-ratings');

return (
  <>
    {renderIfAvailable(<RatingsPanel />, <LockedPlaceholder />)}
  </>
);
```

### `useOnboardingAnalytics(options)`

Track onboarding events:

```tsx
useOnboardingAnalytics({
  debug: true, // Log to console
  onEvent: (event) => {
    // Send to analytics service
    console.log('Onboarding event:', event);
  },
});
```

## Components

### `<OnboardingProvider>`

Wrap your app. Must be at the root of Career mode:

```tsx
<OnboardingProvider>
  <CareerUI />
</OnboardingProvider>
```

### `<OnboardingFlowOrchestrator>`

Manages automatic phase transitions. Place near root:

```tsx
<OnboardingFlowOrchestrator /> {/* No visual output */}
```

### `<OnboardingOverlay>`

Displays the current tutorial step in a modal. Place once:

```tsx
<OnboardingOverlay /> {/* Auto-shows/hides based on state */}
```

### `<OnboardingTooltip>`

ShowsLightweight hints. Use conditionally:

```tsx
{state.currentPhase === 'character-creation' && (
  <OnboardingTooltip
    targetSelector="[data-onboarding='stats-selector']"
    position="right"
  >
    Higher strength = stronger power moves.
  </OnboardingTooltip>
)}
```

### `<GuidedAction>`

Wrap buttons to block actions during onboarding:

```tsx
<GuidedAction
  guideStepId="first-actions-booking"
  disableDuringOnboarding
>
  <BookMatchButton />
</GuidedAction>
```

### `<OnboardingProgressIndicator>`

Show progress through phases:

```tsx
{/* Compact mode */}
<OnboardingProgressIndicator compact />

{/* Full mode */}
<OnboardingProgressIndicator />
```

### `<OnboardingHints>`

Show phase-contextual tips:

```tsx
<OnboardingHints
  show={true}
  onHintUsed={(hint) => console.log('Used hint:', hint)}
/>
```

## Customization

### Adding Tutorial Steps

Edit `src/ui/onboarding/steps.ts`:

```typescript
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'my-step',
    phase: 'dashboard-orientation',
    title: 'My Tutorial Title',
    description: 'My tutorial text...',
    targetSelector: '[data-onboarding="my-element"]',
    action: {
      label: 'Got it',
      handler: () => console.log('User clicked'),
    },
    mandatory: false, // Can skip?
  },
  // ... more steps
];
```

### Styling

Edit CSS files to customize colors, sizing, animations:

- `OnboardingOverlay.css` — Full-screen overlay
- `OnboardingTooltip.css` — Inline tooltips
- `OnboardingProgressIndicator.css` — Progress bar
- `OnboardingHints.css` — Context tips

### Adding New Phases

1. Add to `OnboardingPhase` type in `types.ts`
2. Add steps to `ONBOARDING_STEPS` with that phase
3. Update phase order in `OnboardingFlowOrchestrator.tsx` if needed
4. Guard new UI behind phase checks

## Implementation Checklist

Use this checklist to integrate onboarding into your Career UI:

### Setup
- [ ] Import `OnboardingProvider` and wrap Career component
- [ ] Add `OnboardingFlowOrchestrator` to Career root
- [ ] Add `OnboardingOverlay` to Career root
- [ ] Verify localStorage is enabled for state persistence

### Welcome Phase
- [ ] Create welcome screen with career mode selector (solo/tag)
- [ ] Add `data-onboarding="career-mode-selector"` to mode buttons
- [ ] Wire up `setCareerMode('solo')` or `setCareerMode('tag')`
- [ ] Test: Welcome phase shows, mode selection gates team-setup

### Character Creation Phase
- [ ] Create character creation form
- [ ] Add `data-onboarding="stats-selector"` to stat inputs
- [ ] Show stats explanation during this phase
- [ ] Call `completeStep()` when character is created
- [ ] Test: Form shows, stats are explained, phase auto-advances

### Team Setup Phase (Tag Only)
- [ ] Create team setup form (roster import, partner selection)
- [ ] Add `data-onboarding="roster-import"` to import controls
- [ ] Guard this phase to only show if `careerMode === 'tag'`
- [ ] Call `completeStep()` when team is created
- [ ] Test: Only shows for tag careers, auto-skips for solo

### Dashboard Orientation Phase
- [ ] Create/show main Career Dashboard
- [ ] Add data attributes to key sections:
  - `data-onboarding="calendar"` → Calendar/Schedule
  - `data-onboarding="ratings-panel"` → Ratings Table
  - `data-onboarding="titles-panel"` → Titles Section
  - `data-onboarding="injuries-panel"` → Injuries Section
  - `data-onboarding="wp-panel"` → WP Display
- [ ] These sections are highlighted one by one during tutorial
- [ ] Test: Dashboard elements are spotlighted and explained

### First Actions Phase
- [ ] Show Match Booking UI
- [ ] Add `data-onboarding="booking-controls"` to booking buttons
- [ ] Add `data-onboarding="match-result-summary"` to result display
- [ ] Wrap booking button in `<GuidedAction disableDuringOnboarding>`
- [ ] After first match, show result summary
- [ ] Test: Booking is gated until this phase, result is explained

### Complete Phase
- [ ] Onboarding is done; all features unlocked
- [ ] Show "Tutorial Complete" or "Ready to Go" message
- [ ] Display skip/replay buttons (optional)
- [ ] Test: All features are accessible, no more blocking

### Advanced Features
- [ ] Add `<OnboardingProgressIndicator />` (optional visual feedback)
- [ ] Add `<OnboardingHints />` (optional contextual tips)
- [ ] Guard features with `useOnboardingPhaseGuard()` for hidden UI
- [ ] Set up analytics with `useOnboardingAnalytics()`

### Testing
- [ ] Manual: Walk through entire onboarding sequence
- [ ] Manual: Verify each phase gates correct features
- [ ] Manual: Test skip tutorial button
- [ ] Manual: Test replay tutorial button
- [ ] Manual: Verify localStorage persists state across reloads
- [ ] Keyboard: Tab through all interactive elements
- [ ] Keyboard: Press Esc to close non-mandatory overlays
- [ ] Screen Reader: Verify overlay title and content are announced
- [ ] Reduced Motion: Verify animations respect preference
- [ ] Mobile: Test narrow layout (390px) and touch interactions
- [ ] Run unit tests: `npm run test`

### Accessibility
- [ ] All buttons have `aria-label` or visible text
- [ ] Overlay is `role="dialog"`
- [ ] Color contrast meets WCAG AA standards
- [ ] No keyboard traps; Tab order is logical
- [ ] Reduced motion CSS is applied correctly
- [ ] Focus indicators are visible

### Polish
- [ ] Copy-edit tutorial text for clarity and tone
- [ ] Adjust timing (overlay auto-advance delays)
- [ ] Fine-tune CSS colors to match your theme
- [ ] Add sound effects or animations (optional)
- [ ] Test on different screen sizes (mobile, tablet, desktop)

## File Structure

```
ringcraft/
├── src/
│   ├── ui/
│   │   └── onboarding/
│   │       ├── types.ts
│   │       ├── OnboardingContext.tsx
│   │       ├── steps.ts
│   │       ├── OnboardingOverlay.tsx
│   │       ├── OnboardingOverlay.css
│   │       ├── OnboardingTooltip.tsx
│   │       ├── OnboardingTooltip.css
│   │       ├── GuidedAction.tsx
│   │       ├── OnboardingFlowOrchestrator.tsx
│   │       ├── OnboardingProgressIndicator.tsx
│   │       ├── OnboardingProgressIndicator.css
│   │       ├── OnboardingHints.tsx
│   │       ├── OnboardingHints.css
│   │       ├── useOnboardingPhaseGuard.tsx
│   │       ├── useOnboardingAnalytics.ts
│   │       ├── index.ts
│   │       ├── advanced.ts
│   │       └── INTEGRATION_EXAMPLE.tsx
│   └── ...
├── docs/
│   ├── M6-ONBOARDING-PLAN.md
│   ├── ONBOARDING-INTEGRATION.md
│   └── ...
├── tests/
│   └── onboarding.test.ts
├── README.md (this file)
└── ...
```

## Next Steps

1. **Integrate into Career UI** — Follow the implementation checklist above
2. **Customize tutorial content** — Edit `steps.ts` to match your game
3. **Test thoroughly** — Walk through every phase and check for edge cases
4. **Gather feedback** — Have test players go through onboarding
5. **Iterate** — Refine copy, timing, and UI based on feedback
6. **Monitor analytics** — Track where users drop off or get stuck
7. **M6+ Polish** — Add audiovisual effects, accessibility improvements, etc.

## Troubleshooting

**Overlay not showing:**
- Verify `OnboardingOverlay` component is in your render tree
- Check browser console for errors
- Confirm `data-onboarding` attributes match step `targetSelector` values

**Phase not advancing:**
- Verify all steps in current phase are completed with `completeStep()`
- Check that `OnboardingFlowOrchestrator` is mounted
- Confirm localStorage isn't disabled

**State not persisting:**
- Check that localStorage is enabled in browser settings
- Verify no errors in browser console (storage quota exceeded?)
- Try clearing localStorage and restarting

**Keyboard navigation not working:**
- Verify buttons have `onClick` handlers
- Check that `<GuidedAction>` isn't capturing keyboard events
- Test with Firefox/Chrome DevTools keyboard navigation

**Screen reader not announcing content:**
- Add `aria-label` to interactive elements
- Verify overlay has `role="dialog"`
- Test with NVDA or JAWS

## Contributing

Improvements and additions welcome! Areas for contribution:

- Mobile-optimized onboarding (swipe gestures, touch hints)
- Multilingual support (i18n)
- Video tutorials or GIFs
- Advanced branching logic (conditional phases)
- A/B testing different onboarding flows
- Accessibility improvements (ARIA, keyboard navigation)

## License

Part of Project Ringcraft (private project).

## Support

For questions or issues:
1. Check `ONBOARDING-INTEGRATION.md` for integration help
2. Review `INTEGRATION_EXAMPLE.tsx` for working example
3. Check existing tests in `onboarding.test.ts`
4. Review M5 FREEBUFF-HANDOFF.md for context on parent system
