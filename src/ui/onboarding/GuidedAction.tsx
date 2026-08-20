import React from 'react';
import { useOnboarding } from './OnboardingContext';

/**
 * Wrapper for UI actions that should be guided during onboarding.
 * Prevents certain actions until tutorial conditions are met.
 */

interface GuidedActionProps {
  /** Whether this action should be disabled during onboarding */
  disableDuringOnboarding?: boolean;
  /** Which onboarding step should be shown when hovering/clicking */
  guideStepId?: string;
  /** Child elements */
  children: React.ReactNode;
  /** Optional override: custom condition for when action is allowed */
  isAllowed?: boolean;
  /** Callback when blocked action is attempted */
  onBlockedAttempt?: () => void;
}

/**
 * Wraps a button or interactive element to add onboarding guidance.
 * Disables interaction if action is blocked, shows tooltip on attempt.
 */
export const GuidedAction: React.FC<GuidedActionProps> = ({
  disableDuringOnboarding = false,
  guideStepId,
  children,
  isAllowed = true,
  onBlockedAttempt,
}) => {
  const { state, showStep } = useOnboarding();

  // Determine if action should be blocked
  const isBlocked = disableDuringOnboarding && !state.isDismissed && state.currentPhase !== 'complete' && !isAllowed;

  const handleClick = (e: React.MouseEvent) => {
    if (isBlocked) {
      e.preventDefault();
      e.stopPropagation();
      onBlockedAttempt?.();
      if (guideStepId) {
        showStep(guideStepId);
      }
    }
  };

  // If completely dismissed, render normally
  if (state.isDismissed) {
    return <>{children}</>;
  }

  return (
    <div
      onClick={handleClick}
      style={{
        opacity: isBlocked ? 0.6 : 1,
        cursor: isBlocked ? 'not-allowed' : 'auto',
        pointerEvents: isBlocked ? 'auto' : 'auto',
        transition: 'opacity 0.2s ease',
      }}
      role={isBlocked ? 'button' : undefined}
      tabIndex={isBlocked ? 0 : undefined}
      onKeyDown={(e) => {
        if (isBlocked && (e.key === 'Enter' || e.key === ' ')) {
          handleClick(e as any);
        }
      }}
    >
      {children}
    </div>
  );
};
