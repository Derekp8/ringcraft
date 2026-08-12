/**
 * OnboardingProgressIndicator
 * Shows user progress through onboarding phases
 */

import React from 'react';
import { useOnboarding } from './OnboardingContext';
import './OnboardingProgressIndicator.css';

interface OnboardingProgressIndicatorProps {
  /** Whether to show in compact mode (horizontal bar) or full mode */
  compact?: boolean;
}

export const OnboardingProgressIndicator: React.FC<OnboardingProgressIndicatorProps> = ({
  compact = false,
}) => {
  const { state } = useOnboarding();

  const phases = ['welcome', 'character-creation', 'team-setup', 'dashboard-orientation', 'first-actions', 'complete'];
  const currentIndex = phases.indexOf(state.currentPhase);
  const progress = ((currentIndex + 1) / phases.length) * 100;

  if (state.isDismissed) {
    return null;
  }

  if (compact) {
    return (
      <div className="onboarding-progress-compact">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="progress-label">
          {state.currentPhase.replace('-', ' ')} ({currentIndex + 1} of {phases.length})
        </span>
      </div>
    );
  }

  return (
    <div className="onboarding-progress-full">
      <h3>Tutorial Progress</h3>
      <div className="phases-list">
        {phases.map((phase, index) => (
          <div
            key={phase}
            className={`phase-item ${
              index <= currentIndex ? 'completed' : 'pending'
            } ${phase === state.currentPhase ? 'active' : ''}`}
          >
            <div className="phase-number">{index + 1}</div>
            <div className="phase-name">{phase.replace('-', ' ')}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
