/**
 * useOnboardingAnalytics
 * Track onboarding completion, drop-off points, and user behavior
 */

import { useEffect, useCallback } from 'react';
import { useOnboarding } from './OnboardingContext';

export interface OnboardingAnalyticsEvent {
  type: 'phase_entered' | 'phase_skipped' | 'step_completed' | 'tutorial_dismissed' | 'tutorial_completed';
  phase: string;
  step?: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

interface OnboardingAnalyticsOptions {
  /** Callback to send analytics events */
  onEvent?: (event: OnboardingAnalyticsEvent) => void;
  /** Enable console logging for debugging */
  debug?: boolean;
}

/**
 * Hook for tracking onboarding analytics
 * Automatically fires events when user progresses through onboarding
 */
export const useOnboardingAnalytics = (options: OnboardingAnalyticsOptions = {}) => {
  const { debug = false, onEvent } = options;
  const { state } = useOnboarding();

  // Track phase changes
  useEffect(() => {
    if (!onEvent) return;

    const event: OnboardingAnalyticsEvent = {
      type: 'phase_entered',
      phase: state.currentPhase,
      timestamp: Date.now(),
    };

    if (debug) {
      console.log('[Onboarding Analytics]', event);
    }

    onEvent(event);
  }, [state.currentPhase, onEvent, debug]);

  // Track step completion
  useEffect(() => {
    if (!onEvent || !state.activeStepId) return;

    const event: OnboardingAnalyticsEvent = {
      type: 'step_completed',
      phase: state.currentPhase,
      step: state.activeStepId,
      timestamp: Date.now(),
    };

    if (debug) {
      console.log('[Onboarding Analytics]', event);
    }

    onEvent(event);
  }, [state.completedSteps, state.currentPhase, state.activeStepId, onEvent, debug]);

  // Track dismissal
  useEffect(() => {
    if (!onEvent || !state.isDismissed) return;

    const event: OnboardingAnalyticsEvent = {
      type: 'tutorial_dismissed',
      phase: state.currentPhase,
      timestamp: Date.now(),
    };

    if (debug) {
      console.log('[Onboarding Analytics]', event);
    }

    onEvent(event);
  }, [state.isDismissed, state.currentPhase, onEvent, debug]);

  // Track completion
  useEffect(() => {
    if (!onEvent || state.currentPhase !== 'complete') return;

    const event: OnboardingAnalyticsEvent = {
      type: 'tutorial_completed',
      phase: 'complete',
      timestamp: Date.now(),
      metadata: {
        hasSeenBefore: state.hasSeenBefore,
        careerMode: state.careerMode,
      },
    };

    if (debug) {
      console.log('[Onboarding Analytics]', event);
    }

    onEvent(event);
  }, [state.currentPhase, state.hasSeenBefore, state.careerMode, onEvent, debug]);

  // Return analytics API for manual tracking
  return useCallback(
    (event: Omit<OnboardingAnalyticsEvent, 'timestamp'>) => {
      if (!onEvent) return;

      const fullEvent: OnboardingAnalyticsEvent = {
        ...event,
        timestamp: Date.now(),
      };

      if (debug) {
        console.log('[Onboarding Analytics]', fullEvent);
      }

      onEvent(fullEvent);
    },
    [onEvent, debug]
  );
};
