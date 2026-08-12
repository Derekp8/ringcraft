/**
 * Onboarding state machine and types
 * Guides new players through Career setup
 */

export type OnboardingPhase =
  | 'welcome'
  | 'character-creation'
  | 'team-setup'
  | 'dashboard-orientation'
  | 'first-actions'
  | 'complete';

export type CareerMode = 'solo' | 'tag' | null;

export interface OnboardingStep {
  /** Unique identifier for this step */
  id: string;
  /** Which phase this belongs to */
  phase: OnboardingPhase;
  /** Human-readable title */
  title: string;
  /** Main explanation text */
  description: string;
  /** Optional: what to highlight/focus on (CSS selector or component ref) */
  targetSelector?: string;
  /** Optional: action button text and handler */
  action?: {
    label: string;
    handler: () => void | Promise<void>;
  };
  /** Optional: secondary action (e.g., "Skip this step") */
  secondary?: {
    label: string;
    handler: () => void | Promise<void>;
  };
  /** Whether this step is mandatory (can't skip) */
  mandatory?: boolean;
}

export interface OnboardingState {
  /** Current phase of onboarding */
  currentPhase: OnboardingPhase;
  /** Career mode selected (solo/tag or null if not started) */
  careerMode: CareerMode;
  /** Steps completed in current phase */
  completedSteps: Set<string>;
  /** Whether onboarding has been explicitly dismissed */
  isDismissed: boolean;
  /** Whether user has seen onboarding before (show skip option) */
  hasSeenBefore: boolean;
  /** Current active step (if showing overlay/tooltip) */
  activeStepId: string | null;
}

export interface OnboardingContextType {
  /** Current onboarding state */
  state: OnboardingState;
  /** Advance to next phase */
  nextPhase: () => void;
  /** Go to specific phase */
  goToPhase: (phase: OnboardingPhase) => void;
  /** Mark step as completed */
  completeStep: (stepId: string) => void;
  /** Show specific step (overlay/tooltip) */
  showStep: (stepId: string) => void;
  /** Hide current step overlay */
  hideStep: () => void;
  /** Dismiss onboarding entirely */
  dismiss: () => void;
  /** Reset onboarding to welcome */
  reset: () => void;
  /** Set career mode (solo or tag) */
  setCareerMode: (mode: CareerMode) => void;
  /** Get current step definition */
  getCurrentStep: () => OnboardingStep | null;
}
