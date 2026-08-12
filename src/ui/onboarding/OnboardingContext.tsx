import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { OnboardingContextType, OnboardingPhase, OnboardingState, CareerMode, OnboardingStep } from './types';
import { ONBOARDING_STEPS } from './steps';

const OnboardingContext = createContext<OnboardingContextType | null>(null);

export const useOnboarding = () => {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
};

export interface OnboardingProviderProps {
  children: React.ReactNode;
}

export const OnboardingProvider: React.FC<OnboardingProviderProps> = ({ children }) => {
  const [state, setState] = useState<OnboardingState>(() => {
    // Restore from localStorage if available
    try {
      const saved = localStorage.getItem('ringcraft-onboarding-state');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          completedSteps: new Set(parsed.completedSteps || []),
        };
      }
    } catch (e) {
      console.error('Failed to restore onboarding state:', e);
    }

    // Default initial state
    return {
      currentPhase: 'welcome',
      careerMode: null,
      completedSteps: new Set(),
      isDismissed: false,
      hasSeenBefore: false,
      activeStepId: null,
    };
  });

  // Save state to localStorage whenever it changes
  const saveState = useCallback((newState: OnboardingState) => {
    setState(newState);
    try {
      localStorage.setItem(
        'ringcraft-onboarding-state',
        JSON.stringify({
          ...newState,
          completedSteps: Array.from(newState.completedSteps),
        })
      );
    } catch (e) {
      console.error('Failed to save onboarding state:', e);
    }
  }, []);

  const nextPhase = useCallback(() => {
    const phases: OnboardingPhase[] = [
      'welcome',
      'character-creation',
      'team-setup',
      'dashboard-orientation',
      'first-actions',
      'complete',
    ];
    const currentIndex = phases.indexOf(state.currentPhase);
    if (currentIndex < phases.length - 1) {
      saveState({
        ...state,
        currentPhase: phases[currentIndex + 1],
        activeStepId: null,
      });
    }
  }, [state, saveState]);

  const goToPhase = useCallback(
    (phase: OnboardingPhase) => {
      saveState({
        ...state,
        currentPhase: phase,
        activeStepId: null,
      });
    },
    [state, saveState]
  );

  const completeStep = useCallback(
    (stepId: string) => {
      const newCompleted = new Set(state.completedSteps);
      newCompleted.add(stepId);
      saveState({
        ...state,
        completedSteps: newCompleted,
        activeStepId: null,
      });
    },
    [state, saveState]
  );

  const showStep = useCallback(
    (stepId: string) => {
      saveState({
        ...state,
        activeStepId: stepId,
      });
    },
    [state, saveState]
  );

  const hideStep = useCallback(() => {
    saveState({
      ...state,
      activeStepId: null,
    });
  }, [state, saveState]);

  const dismiss = useCallback(() => {
    saveState({
      ...state,
      isDismissed: true,
      activeStepId: null,
    });
  }, [state, saveState]);

  const reset = useCallback(() => {
    saveState({
      currentPhase: 'welcome',
      careerMode: null,
      completedSteps: new Set(),
      isDismissed: false,
      hasSeenBefore: true, // Remember they've seen it
      activeStepId: null,
    });
  }, [saveState]);

  const setCareerMode = useCallback(
    (mode: CareerMode) => {
      saveState({
        ...state,
        careerMode: mode,
      });
    },
    [state, saveState]
  );

  const getCurrentStep = useCallback((): OnboardingStep | null => {
    if (!state.activeStepId) return null;
    return ONBOARDING_STEPS.find((step) => step.id === state.activeStepId) || null;
  }, [state.activeStepId]);

  const value: OnboardingContextType = useMemo(
    () => ({
      state,
      nextPhase,
      goToPhase,
      completeStep,
      showStep,
      hideStep,
      dismiss,
      reset,
      setCareerMode,
      getCurrentStep,
    }),
    [state, nextPhase, goToPhase, completeStep, showStep, hideStep, dismiss, reset, setCareerMode, getCurrentStep]
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
};
