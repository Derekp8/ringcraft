# Onboarding Integration Guide

## Quick Start

### 1. Wrap Your App with OnboardingProvider

```tsx
import { OnboardingProvider } from './ui/onboarding';

function App() {
  return (
    <OnboardingProvider>
      <YourCareerUI />
    </OnboardingProvider>
  );
}
```

### 2. Add the Orchestrator and Overlay to Your Career Component

```tsx
import {
  OnboardingFlowOrchestrator,
  useOnboarding,
} from './ui/onboarding';
import { OnboardingOverlay } from './ui/onboarding';

function CareerMode() {
  const { state, dismiss } = useOnboarding();

  return (
    <>
      <OnboardingFlowOrchestrator />
      <OnboardingOverlay />

      {/* Your career UI */}
      <CareerDashboard />

      {/* Optional: Skip onboarding button */}
      {!state.isDismissed && state.currentPhase !== 'complete' && (
        <button onClick={() => dismiss()}>
          Skip Tutorial
        </button>
      )}
    </>
  );
}
```

## Core Concepts

### Phases

Onboarding progresses through 6 phases:

1. **welcome** — Career mode selection (solo/tag)
2. **character-creation** — Create your wrestler
3. **team-setup** — (Tag only) Select tag partner
4. **dashboard-orientation** — Learn the dashboard UI
5. **first-actions** — Book and complete first match
6. **complete** — Graduation

Each phase contains multiple steps. Steps auto-advance when completed.

### Steps

A step is an individual tutorial lesson:

```typescript
interface OnboardingStep {
  id: string;                    // Unique ID
  phase: OnboardingPhase;        // Which phase
  title: string;                 // Tutorial title
  description: string;           // Main content
  targetSelector?: string;       // CSS selector to spotlight
  action?: { label, handler };   // Button action
  secondary?: { label, handler }; // Secondary button (skip)
  mandatory?: boolean;           // Can't skip if true
}
```

## Integration Patterns

### Pattern 1: Block Actions During Onboarding

Prevent certain actions until the tutorial teaches them:

```tsx
import { GuidedAction } from './ui/onboarding';

function BookMatchButton() {
  return (
    <GuidedAction
      guideStepId="first-actions-booking"
      disableDuringOnboarding
    >
      <button onClick={handleBookMatch}>Book Match</button>
    </GuidedAction>
  );
}
```

When clicked before the right phase, it shows the tutorial overlay.

### Pattern 2: Guard Component Visibility

Hide complex UI until the tutorial explains it:

```tsx
import { useOnboarding } from './ui/onboarding';

function RatingsPanel() {
  const { state } = useOnboarding();

  // Hide until dashboard-orientation phase
  if (state.currentPhase === 'welcome' || state.currentPhase === 'character-creation') {
    return null;
  }

  return <YourRatingsUI />;
}
```

### Pattern 3: Show Contextual Tooltips

Add lightweight hints to UI elements:

```tsx
import { OnboardingTooltip } from './ui/onboarding';
import { useOnboarding } from './ui/onboarding';

function WrestlerStatsDisplay() {
  const { state } = useOnboarding();

  return (
    <div>
      <div data-onboarding="stats-selector">
        {/* Your stats UI */}
      </div>

      {state.currentPhase === 'character-creation' && (
        <OnboardingTooltip targetSelector="[data-onboarding='stats-selector']" position="right">
          Strength affects power moves, Speed helps escapes, Technique improves submissions.
        </OnboardingTooltip>
      )}
    </div>
  );
}
```

### Pattern 4: Custom Phase Logic

Run custom logic when entering a phase:

```tsx
import { useOnboarding } from './ui/onboarding';
import { useEffect } from 'react';

function MyComponent() {
  const { state, setCareerMode } = useOnboarding();

  useEffect(() => {
    if (state.currentPhase === 'welcome') {
      // Reset form, show welcome screen, etc.
    }
  }, [state.currentPhase]);

  return <>...</>;
}
```

## Adding Data Attributes for Spotlighting

Add `data-onboarding` attributes to elements you want to highlight:

```tsx
{/* Calendar - spotlight this during dashboard-orientation */}
<div data-onboarding="calendar">
  <Calendar />
</div>

{/* Ratings table - spotlight during ratings tutorial */}
<div data-onboarding="ratings-panel">
  <RatingsTable />
</div>

{/* Match booking controls */}
<div data-onboarding="booking-controls">
  <BookingUI />
</div>
```

These selectors are used by onboarding steps to find and highlight elements.

## Controlling Onboarding State

```tsx
import { useOnboarding } from './ui/onboarding';

function MyComponent() {
  const {
    state,           // Current onboarding state
    nextPhase,       // Go to next phase
    goToPhase,       // Go to specific phase
    completeStep,    // Mark step complete
    showStep,        // Show a specific step overlay
    hideStep,        // Hide current overlay
    dismiss,         // Exit onboarding
    reset,           // Reset to welcome
    setCareerMode,   // Set solo/tag
    getCurrentStep,  // Get current step object
  } = useOnboarding();

  return <>...</>;
}
```

## Persistence

Onboarding state is automatically saved to localStorage:
- `ringcraft-onboarding-state` — current progress, phase, completed steps

This survives page refreshes and browser restarts.

## Accessibility

### Keyboard Navigation

All buttons are keyboard accessible:
- **Tab** to focus buttons
- **Enter/Space** to activate
- **Esc** to dismiss overlay (if not mandatory)

### Screen Readers

Overlay is marked as `role="dialog"` with aria labels. Buttons have clear labels.

### Reduced Motion

CSS includes `@media (prefers-reduced-motion: reduce)` to disable animations for users who prefer them.

## Customization

### Changing Step Content

Edit `src/ui/onboarding/steps.ts`:

```typescript
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'my-custom-step',
    phase: 'welcome',
    title: 'My Title',
    description: 'My description...',
    // Add more fields as needed
  },
  // ... more steps
];
```

### Styling the Overlay/Tooltip

Edit CSS files:
- `src/ui/onboarding/OnboardingOverlay.css` — full-screen overlay
- `src/ui/onboarding/OnboardingTooltip.css` — inline tooltip

Customize colors, sizing, animations, etc.

### Adding New Phases

1. Add phase name to `OnboardingPhase` type in `types.ts`
2. Add steps to `ONBOARDING_STEPS` with that phase
3. Update `OnboardingFlowOrchestrator.tsx` phase order if needed
4. Guard new UI behind phase checks

## Testing

### Manual Testing Checklist

- [ ] Welcome phase shows first
- [ ] Skipping tutorial works (dismiss button)
- [ ] Replaying tutorial works (reset button)
- [ ] Career mode selection gates team-setup phase
- [ ] Dashboard elements appear in correct phases
- [ ] First match booking is gated by first-actions phase
- [ ] localStorage persists state across page reloads
- [ ] Keyboard navigation works (Tab, Enter, Esc)
- [ ] Screen reader announces overlay title and content
- [ ] Reduced motion preference is respected

### Unit Testing

Test onboarding hooks and state:

```typescript
import { render, screen } from '@testing-library/react';
import { OnboardingProvider, useOnboarding } from './onboarding';

function TestComponent() {
  const { state, nextPhase } = useOnboarding();
  return (
    <div>
      <div>Phase: {state.currentPhase}</div>
      <button onClick={nextPhase}>Next</button>
    </div>
  );
}

test('advances to next phase', () => {
  render(
    <OnboardingProvider>
      <TestComponent />
    </OnboardingProvider>
  );
  expect(screen.getByText('Phase: welcome')).toBeInTheDocument();
  screen.getByText('Next').click();
  expect(screen.getByText('Phase: character-creation')).toBeInTheDocument();
});
```

## Next Steps

1. **Integrate into Career UI** — Add provider, orchestrator, and overlay
2. **Add data attributes** — Mark key elements with `data-onboarding`
3. **Gate actions** — Use `GuidedAction` on critical buttons
4. **Test flow** — Walk through entire onboarding sequence
5. **Polish content** — Refine tutorial text and pacing
6. **Accessibility audit** — Test with keyboard and screen reader
