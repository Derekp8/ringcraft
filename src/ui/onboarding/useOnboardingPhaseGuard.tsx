/**
 * useOnboardingPhaseGuard
 * Advanced hook for fine-grained control over feature access during onboarding
 */

import { useCallback } from 'react';
import { useOnboarding } from './OnboardingContext';

/**
 * Feature access permissions per phase
 */
const FEATURE_PHASES: Record<string, string> = {
  // Welcome phase
  'view-welcome-screen': 'welcome',

  // Character creation phase
  'create-wrestler': 'character-creation',
  'view-wrestler-stats': 'character-creation',

  // Team setup phase
  'import-roster': 'team-setup',
  'select-tag-partner': 'team-setup',

  // Dashboard orientation phase
  'view-dashboard': 'dashboard-orientation',
  'view-calendar': 'dashboard-orientation',
  'view-ratings': 'dashboard-orientation',
  'view-titles': 'dashboard-orientation',
  'view-injuries': 'dashboard-orientation',
  'view-wp': 'dashboard-orientation',

  // First actions phase
  'book-match': 'first-actions',
  'view-match-result': 'first-actions',
  'spend-wp': 'dashboard-orientation', // Can start earlier

  // Complete phase (all features available)
  'all': 'complete',
};

interface GuardResult {
  /** Whether the feature is currently accessible */
  allowed: boolean;
  /** The phase where this feature unlocks */
  unlocksAt: string;
  /** Current phase */
  currentPhase: string;
  /** How many phases until this unlocks (0 if already unlocked, null if already done) */
  phasesUntilUnlock: number | null;
}

/**
 * Hook to check if a feature is currently accessible
 * @param featureName - The feature to check (must be a key in FEATURE_PHASES)
 * @returns GuardResult with access info
 */
export const useOnboardingPhaseGuard = (featureName: string): GuardResult => {
  const { state } = useOnboarding();

  const phases = [
    'welcome',
    'character-creation',
    'team-setup',
    'dashboard-orientation',
    'first-actions',
    'complete',
  ];

  // If dismissed or complete, everything is allowed
  if (state.isDismissed || state.currentPhase === 'complete') {
    return {
      allowed: true,
      unlocksAt: state.currentPhase,
      currentPhase: state.currentPhase,
      phasesUntilUnlock: null,
    };
  }

  const requiredPhase = FEATURE_PHASES[featureName] || 'welcome';
  const requiredIndex = phases.indexOf(requiredPhase);
  const currentIndex = phases.indexOf(state.currentPhase);

  const allowed = currentIndex >= requiredIndex;
  const phasesUntilUnlock = allowed ? 0 : requiredIndex - currentIndex;

  return {
    allowed,
    unlocksAt: requiredPhase,
    currentPhase: state.currentPhase,
    phasesUntilUnlock: allowed ? null : phasesUntilUnlock,
  };
};

/**
 * Hook to conditionally render content based on onboarding phase
 * @param featureName - The feature to check
 * @returns Callback to conditionally render
 */
export const useFeatureAvailability = (
  featureName: string
): ((component: React.ReactNode, lockedPlaceholder?: React.ReactNode) => React.ReactNode) => {
  const guard = useOnboardingPhaseGuard(featureName);

  return useCallback(
    (component: React.ReactNode, lockedPlaceholder?: React.ReactNode) => {
      if (guard.allowed) {
        return component;
      }
      return (
        lockedPlaceholder || (
          <div className="feature-locked">
            <p>This feature unlocks in the {guard.unlocksAt.replace('-', ' ')} phase.</p>
          </div>
        )
      );
    },
    [guard]
  );
};
