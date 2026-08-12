# M6 Onboarding System

## Overview

Onboarding guides new players through Career mode setup and teaches core mechanics through an interactive, tutorial-driven flow.

## Goals

1. **Lower entry barrier** — new players understand career constraints and options
2. **Teach mechanics progressively** — introduce ratings, titles, injuries, WP spending step-by-step
3. **Orient to the UI** — highlight key surfaces and navigation
4. **Enable self-serve recovery** — clear explanations of errors and constraints

## Structure

### Phases

1. **Welcome** (new game only)
   - Brief explanation of what a Career is
   - Solo vs. Team choice
   - Difficulty/house rules (future)

2. **Character Creation**
   - Wrestler name/stats selection
   - Explain stats impact (strength, speed, technique, stamina)
   - Preview career starting point

3. **Team Setup** (if Team selected)
   - Roster import guidance
   - Team selection/pairing
   - Budget/slot constraints

4. **Career Dashboard Orientation**
   - Current month and schedule
   - Key surfaces: Ratings, Titles, Injuries, Matches
   - Navigation and quick actions

5. **First Actions**
   - Guided first booking
   - Explain match offer flow
   - Post-match summary walkthrough

### Components

- **OnboardingOverlay** — full-screen tutorial step with highlights
- **Tooltip** — inline contextual help
- **GuidedAction** — wrapper for blocking/guiding user actions
- **OnboardingState** — context provider tracking progress

## Implementation Phases

### Phase 1: Core Structure (this sprint)
- [ ] Onboarding state management (Redux or context)
- [ ] Welcome/character creation flow
- [ ] Overlay and tooltip components
- [ ] Navigation guards for Career dashboard

### Phase 2: Dashboard Orientation
- [ ] Ratings/titles/injuries surface explanations
- [ ] First match offer guidance
- [ ] Post-match summary walkthrough

### Phase 3: Polish
- [ ] Keyboard navigation for onboarding
- [ ] Skip/replay options
- [ ] Accessibility audit
- [ ] Mobile/narrow layout support

## Design Principles

- **Non-intrusive** — can be skipped; doesn't break normal flow
- **Progressive disclosure** — explain complexity as it appears
- **Contextual** — hints appear at the moment they're relevant
- **Dismissable** — player can close and continue
