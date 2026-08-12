/**
 * OnboardingFlowOrchestrator
 * Manages the progression through onboarding phases and coordinates
 * transitions between phases based on user actions in Career mode.
 */

import React, { useEffect } from 'react';
import { useOnboarding } from './OnboardingContext';
import { getPhaseSteps } from './steps';

/**
 * This component orchestrates onboarding flow.
 * Place it at the top level of your Career UI to automatically manage
 * transitions between onboarding phases.
 */
export const OnboardingFlowOrchestrator: React.FC = () => {
  const { state, nextPhase, showStep, setCareerMode, completeStep } = useOnboarding();

  // Auto-trigger first step when entering a new phase
  useEffect(() => {
    if (state.isDismissed || state.currentPhase === 'complete') return;

    const phaseSteps = getPhaseSteps(state.currentPhase);
    if (phaseSteps.length > 0) {
      // Find the first uncompleted step in this phase
      const nextStep = phaseSteps.find((step) => !state.completedSteps.has(step.id));
      if (nextStep && !state.activeStepId) {
        showStep(nextStep.id);
      }
    }
  }, [state.currentPhase, state.isDismissed, state.completedSteps, state.activeStepId, showStep]);

  // Auto-advance to next phase when all steps in current phase are complete
  useEffect(() => {
    if (state.isDismissed || state.currentPhase === 'complete') return;

    const phaseSteps = getPhaseSteps(state.currentPhase);
    const allCompleted = phaseSteps.every((step) => state.completedSteps.has(step.id));

    if (allCompleted && phaseSteps.length > 0) {
      // Delay slightly to avoid jarring transitions
      const timer = setTimeout(() => {
        nextPhase();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [state.currentPhase, state.completedSteps, state.isDismissed, nextPhase]);

  return null; // This is a logic-only component
};

/**
 * Hook to check if onboarding is blocking an action
 * Use in your Career UI components to conditionally allow/block interactions
 */
export const useOnboardingGuard = (actionName: string): boolean => {
  const { state } = useOnboarding();

  if (state.isDismissed || state.currentPhase === 'complete') {
    return true; // Action is allowed
  }

  // Map action names to which phase they unlock in
  const actionPhases: Record<string, string> = {
    'career-mode-selection': 'welcome',
    'character-creation': 'character-creation',
    'team-setup': 'team-setup',
    'booking-match': 'first-actions',
    'viewing-ratings': 'dashboard-orientation',
    'managing-wp': 'dashboard-orientation',
  };

  const requiredPhase = actionPhases[actionName];
  if (!requiredPhase) return true; // No restriction

  const phaseOrder = ['welcome', 'character-creation', 'team-setup', 'dashboard-orientation', 'first-actions', 'complete'];
  const requiredIndex = phaseOrder.indexOf(requiredPhase);
  const currentIndex = phaseOrder.indexOf(state.currentPhase);

  return currentIndex >= requiredIndex;
};
