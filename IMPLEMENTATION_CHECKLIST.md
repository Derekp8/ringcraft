# M6 Onboarding Implementation Checklist

> Historical integration scaffold: the onboarding work described below is implemented in the current UI and automated suites. It is retained as design history, not current status. Use `docs/m6-implementation-audit.md` and `docs/release-readiness-audit.md` for implementation state; use `docs/human-playtest-checklist.md` and `docs/human-accessibility-checklist.md` for the remaining unsigned acceptance work.

Use this checklist to track progress on integrating the onboarding system into your Career UI.

## Phase 1: Setup ✅ COMPLETE

- [x] Create onboarding system files
- [x] Implement state management (OnboardingContext)
- [x] Build core components (Overlay, Tooltip, GuidedAction)
- [x] Write tutorial content (30+ steps)
- [x] Create advanced features (Progress, Hints, Guards, Analytics)
- [x] Document integration guide
- [x] Commit to repository

## Phase 2: Career UI Integration 🚀 NEXT

### Setup & Infrastructure
- [ ] Import OnboardingProvider in Career component
- [ ] Wrap entire Career UI with OnboardingProvider
- [ ] Add OnboardingFlowOrchestrator to Career root
- [ ] Add OnboardingOverlay to Career root
- [ ] Test: Confirm onboarding state is accessible via useOnboarding()
- [ ] Test: Confirm localStorage persistence works

### Welcome Phase
- [ ] Create WelcomePhase component
  - [ ] Display welcome text/intro
  - [ ] Show career mode selector (Solo / Tag buttons)
  - [ ] Add `data-onboarding="career-mode-selector"` to container
  - [ ] Wire setCareerMode('solo') to Solo button
  - [ ] Wire setCareerMode('tag') to Tag button
- [ ] Test: Welcome appears on first load
- [ ] Test: Clicking Solo/Tag moves to next phase
- [ ] Test: Career mode is saved in state

### Character Creation Phase
- [ ] Create CharacterCreationPhase component
  - [ ] Show wrestler name input
  - [ ] Show stat sliders/inputs (Strength, Speed, Technique, Stamina)
  - [ ] Add `data-onboarding="stats-selector"` to stat controls
  - [ ] Show preview of starting rating based on stats
  - [ ] Add Create/Confirm button
- [ ] Connect to create wrestler in core system
- [ ] Test: Stats tutorial step is shown and spotlighted
- [ ] Test: Creating wrestler triggers phase advancement

### Team Setup Phase (Tag Only)
- [ ] Create TeamSetupPhase component
  - [ ] Show roster file picker/import
  - [ ] Add `data-onboarding="roster-import"` to import controls
  - [ ] Show wrestler list after import
  - [ ] Allow selection of tag partner
  - [ ] Show team stats preview
  - [ ] Add Confirm button
- [ ] Guard phase: Only show if careerMode === 'tag'
- [ ] For solo careers: Skip this phase entirely
- [ ] Test: Phase only shows for tag mode
- [ ] Test: Solo mode skips to dashboard
- [ ] Test: Partner selection triggers phase advancement

### Dashboard Orientation Phase
- [ ] Show main Career Dashboard with all panels:
  - [ ] Calendar/Schedule section
    - [ ] Add `data-onboarding="calendar"`
    - [ ] Show current month and upcoming slots
  - [ ] Ratings section
    - [ ] Add `data-onboarding="ratings-panel"`
    - [ ] Display current rating and ranking table
  - [ ] Titles section
    - [ ] Add `data-onboarding="titles-panel"`
    - [ ] Show owned titles and available shots
  - [ ] Injuries section
    - [ ] Add `data-onboarding="injuries-panel"`
    - [ ] Display current injuries and recovery dates
  - [ ] WP (Career Capital) section
    - [ ] Add `data-onboarding="wp-panel"`
    - [ ] Show WP balance and spending options
  - [ ] Events log section
    - [ ] Show recent career events
- [ ] Verify tutorial steps highlight each section
- [ ] Test: Each section appears in tutorial order
- [ ] Test: Dashboard becomes read-only or limited (no actions yet)

### First Actions Phase
- [ ] Show Match Booking UI
  - [ ] Add `data-onboarding="booking-controls"`
  - [ ] Show available opponents
  - [ ] Opponent difficulty/rating display
  - [ ] Book button
- [ ] Implement match booking
  - [ ] Wire up to match engine
  - [ ] Resolve match deterministically
  - [ ] Generate match result summary
- [ ] Show Match Result Summary
  - [ ] Add `data-onboarding="match-result-summary"`
  - [ ] Display match log (moves, near-falls, etc.)
  - [ ] Show rating change
  - [ ] Show WP earned
  - [ ] Show any injuries sustained
- [ ] Wrap booking in GuidedAction
  ```tsx
  <GuidedAction
    guideStepId="first-actions-booking"
    disableDuringOnboarding
  >
    <BookMatchButton />
  </GuidedAction>
  ```
- [ ] Test: Match booking is gated until this phase
- [ ] Test: Attempting to book earlier shows overlay
- [ ] Test: First match resolves and shows summary
- [ ] Test: Rating and WP are updated correctly

### Complete Phase
- [ ] Show completion message/screen
  - [ ] "Congratulations" message
  - [ ] "You're ready to go" CTA
  - [ ] Optional: Show tutorial skip/replay buttons
- [ ] Unlock all features
  - [ ] Full match booking available
  - [ ] All dashboard controls active
  - [ ] No more guided actions
- [ ] Test: All features are accessible
- [ ] Test: No more tutorial overlays appear

## Phase 3: Advanced Features 📊 OPTIONAL

### Progress Indicator
- [ ] Import OnboardingProgressIndicator
- [ ] Add to Career header or sidebar
- [ ] Choose display mode (compact or full)
  ```tsx
  <OnboardingProgressIndicator compact />
  ```
- [ ] Test: Shows current phase and progress
- [ ] Test: Updates as phases advance

### Context Hints
- [ ] Import OnboardingHints
- [ ] Add to Career sidebar or info panel
- [ ] Define hints for each phase in `PHASE_HINTS`
  ```tsx
  const PHASE_HINTS: Record<string, string[]> = {
    'welcome': [
      'Hint 1...',
      'Hint 2...',
    ],
    // ...
  };
  ```
- [ ] Test: Hints show based on current phase
- [ ] Test: "Next Tip" button rotates through hints

### Feature Guards
- [ ] Use useOnboardingPhaseGuard() to check feature access
  ```tsx
  const guard = useOnboardingPhaseGuard('book-match');
  if (!guard.allowed) {
    return <Locked unlocks={guard.unlocksAt} />;
  }
  ```
- [ ] Use useFeatureAvailability() for conditional rendering
  ```tsx
  const render = useFeatureAvailability('view-ratings');
  return render(<RatingsPanel />, <LockedPlaceholder />);
  ```
- [ ] Test: Hidden features remain inaccessible
- [ ] Test: Correct "unlocks at" message shown

### Analytics
- [ ] Set up analytics callback
  ```tsx
  useOnboardingAnalytics({
    onEvent: (event) => {
      // Send to analytics service
      console.log('Onboarding event:', event);
    },
    debug: true,
  });
  ```
- [ ] Connect to your analytics service (Segment, Mixpanel, etc.)
- [ ] Test: Events are logged for:
  - [ ] Phase entered
  - [ ] Step completed
  - [ ] Tutorial dismissed
  - [ ] Tutorial completed
- [ ] Monitor drop-off points in analytics dashboard

## Phase 4: Testing 🧪 CRITICAL

### Manual Testing
- [ ] **Happy Path**: Complete entire onboarding solo
  - [ ] Walk through all phases
  - [ ] Verify each step explains the feature
  - [ ] Confirm phase auto-advancement works
- [ ] **Happy Path (Tag)**: Complete entire onboarding with tag career
  - [ ] Verify team-setup phase appears
  - [ ] Confirm partner selection works
- [ ] **Skip Tutorial**: Click "Skip" button
  - [ ] Onboarding dismisses
  - [ ] All features unlock
  - [ ] No more overlays appear
- [ ] **Replay Tutorial**: Click "Restart Tutorial" button
  - [ ] Onboarding resets to welcome
  - [ ] State is cleared
  - [ ] All phases repeat
- [ ] **Page Reload**: Reload page during onboarding
  - [ ] State persists from localStorage
  - [ ] Same phase/step shows
  - [ ] Progress is preserved
- [ ] **Browser Storage**: Clear localStorage
  - [ ] Onboarding resets to welcome
  - [ ] Progress starts over

### Keyboard Navigation
- [ ] **Tab**: Focus moves through all interactive elements
- [ ] **Shift+Tab**: Focus moves backwards
- [ ] **Enter/Space**: Activate focused button
- [ ] **Esc**: Close non-mandatory overlay (if focused)
- [ ] **Arrow Keys**: Navigate carousel/selector (if applicable)

### Screen Reader Testing
- [ ] **NVDA/JAWS**: Overlay title is announced
- [ ] **NVDA/JAWS**: Overlay description is readable
- [ ] **NVDA/JAWS**: Buttons are announced with labels
- [ ] **NVDA/JAWS**: Focus changes are announced
- [ ] **NVDA/JAWS**: Modal dialog is marked correctly

### Accessibility Testing
- [ ] **Color Contrast**: All text meets WCAG AA (4.5:1 normal, 3:1 large)
- [ ] **Focus Indicators**: All buttons have visible focus state
- [ ] **Reduced Motion**: Animations are disabled when preference set
- [ ] **Text Scaling**: UI works at 200% zoom
- [ ] **No Keyboard Traps**: Tab doesn't get stuck

### Responsive Design Testing
- [ ] **Desktop (1920px)**: All elements visible and properly spaced
- [ ] **Tablet (768px)**: Overlay scales appropriately
- [ ] **Mobile (390px)**: Overlay is readable and buttons are tappable
- [ ] **Portrait Orientation**: Text doesn't overflow
- [ ] **Landscape Orientation**: No horizontal scroll needed

### Unit Tests
- [ ] Run: `npm run test`
- [ ] All tests pass (84 total)
- [ ] Add tests for Career integration:
  - [ ] Welcome phase shows career mode selector
  - [ ] Character creation saves wrestler
  - [ ] Team setup only shows for tag
  - [ ] Dashboard elements are spotlighted
  - [ ] First match booking is gated
  - [ ] Complete phase unlocks all features

## Phase 5: Polish 🎨 OPTIONAL

### Copy/Messaging
- [ ] Review all tutorial text for clarity
- [ ] Ensure tone is consistent and friendly
- [ ] Verify game terminology is correct
- [ ] Check for typos and grammar
- [ ] Adjust technical language to be more accessible

### Visual Polish
- [ ] Adjust spotlight border color and glow
- [ ] Fine-tune overlay card positioning
- [ ] Smooth transitions between phases
- [ ] Add icons or illustrations (optional)
- [ ] Ensure colors match your game theme

### Pacing
- [ ] Adjust overlay auto-dismiss timing (currently 500ms)
- [ ] Add delays between steps if needed
- [ ] Test that pacing feels natural (not too fast, not too slow)
- [ ] Verify mandatory steps can't be rushed

### Audio/Visual Effects (Optional)
- [ ] Add background music
- [ ] Add sound effects for phase transitions
- [ ] Add animations for spotlight reveal
- [ ] Add confetti/celebration on tutorial completion

### Localization (Optional)
- [ ] Extract all strings to i18n library
- [ ] Translate tutorial content to target languages
- [ ] Test with different languages
- [ ] Verify RTL text layouts if needed

## Phase 6: Deployment 🚀 FINAL

- [ ] Code review: Have team review onboarding integration
- [ ] QA Sign-off: QA team completes all manual tests
- [ ] Performance: Verify no performance regression
  - [ ] Overlay renders without jank
  - [ ] State updates don't cause unnecessary re-renders
  - [ ] localStorage operations are fast
- [ ] Analytics: Confirm analytics are flowing correctly
- [ ] Monitoring: Set up alerts for onboarding drop-off
- [ ] Merge to main branch
- [ ] Deploy to production
- [ ] Monitor metrics for first 24-48 hours
- [ ] Be ready to hotfix if needed

## Metrics to Track 📈

After launch, monitor these metrics:

- **Completion Rate**: % of new players who complete onboarding
- **Drop-off Points**: Which phases have the most exits
- **Time to Completion**: Average time to complete onboarding
- **Skip Rate**: % who skip tutorial
- **Replay Rate**: % who replay tutorial
- **Feature Access**: Post-onboarding feature adoption rates

## Known Issues & Workarounds

### Issue: Spotlight doesn't appear
**Cause**: `data-onboarding` selector doesn't match element
**Fix**: Verify selector in step definition matches your DOM element exactly

### Issue: Phase won't advance
**Cause**: Steps aren't being completed
**Fix**: Ensure `completeStep(stepId)` is called after each action

### Issue: localStorage full
**Cause**: Browser storage quota exceeded
**Fix**: Clear other site data, or increase quota limit

### Issue: Screen reader doesn't announce overlay
**Cause**: Missing ARIA attributes
**Fix**: Ensure overlay has `role="dialog"` and buttons have `aria-label`

## Questions?

Refer to:
1. `README-ONBOARDING.md` — System overview and quick start
2. `ONBOARDING-INTEGRATION.md` — Detailed integration patterns
3. `INTEGRATION_EXAMPLE.tsx` — Full working example
4. `onboarding.test.ts` — Unit test examples
