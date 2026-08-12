/**
 * OnboardingHints
 * Context-aware hints that appear when the user is stuck or exploring
 */

import React, { useState } from 'react';
import { useOnboarding } from './OnboardingContext';
import './OnboardingHints.css';

/**
 * Hint suggestions based on current phase
 */
const PHASE_HINTS: Record<string, string[]> = {
  welcome: [
    'Solo careers offer focused progression with simple mechanics.',
    'Tag team careers require coordination but offer team dynamics and tag titles.',
    "Choose the mode that matches your playstyle. You can't change this later, so think carefully.",
  ],
  'character-creation': [
    'Your starting stats determine your initial rating and strengths in matches.',
    'Strength is good for power moves, Speed for aerial maneuvers, Technique for submissions.',
    'You can improve any stat later by spending WP, so balance your build.',
  ],
  'team-setup': [
    'Your tag partner\'s stats directly affect your team\'s performance.',
    'Team ranking is determined by both members, so choose someone complementary to your stats.',
    'You can swap partners later, but it resets your team ranking.',
  ],
  'dashboard-orientation': [
    'Your rating increases with wins and decreases with losses. Climb to rank 1 to earn title shots.',
    'Championships are held by the top-rated wrestlers. Defend your title monthly or lose it.',
    'WP is currency you earn from wins. Spend it to improve stats or save for big upgrades.',
  ],
  'first-actions': [
    'Choose opponents at your skill level for balanced matches.',
    'Each match grants WP based on difficulty. Harder opponents = more WP but harder to win.',
    'Your performance in matches affects your rating and determines title opportunities.',
  ],
};

interface OnboardingHintsProps {
  /** Whether to show hint container */
  show?: boolean;
  /** Optional callback when hint is used */
  onHintUsed?: (hint: string) => void;
}

export const OnboardingHints: React.FC<OnboardingHintsProps> = ({
  show = true,
  onHintUsed,
}) => {
  const { state } = useOnboarding();
  const [usedHints, setUsedHints] = useState<Set<string>>(new Set());
  const [currentHintIndex, setCurrentHintIndex] = useState(0);

  if (!show || state.isDismissed || state.currentPhase === 'complete') {
    return null;
  }

  const hints = PHASE_HINTS[state.currentPhase] || [];
  if (hints.length === 0) {
    return null;
  }

  const currentHint = hints[currentHintIndex % hints.length];

  const handleUseHint = () => {
    const newUsed = new Set(usedHints);
    newUsed.add(currentHint);
    setUsedHints(newUsed);
    onHintUsed?.(currentHint);
  };

  const handleNextHint = () => {
    setCurrentHintIndex((prev) => prev + 1);
  };

  return (
    <div className="onboarding-hints">
      <div className="hints-header">
        <span className="hints-label">💡 Tip</span>
        <span className="hints-counter">
          {(currentHintIndex % hints.length) + 1} / {hints.length}
        </span>
      </div>
      <p className="hints-text">{currentHint}</p>
      <div className="hints-actions">
        {hints.length > 1 && (
          <button className="hints-button hints-button-secondary" onClick={handleNextHint}>
            Next Tip
          </button>
        )}
        <button className="hints-button hints-button-primary" onClick={handleUseHint}>
          Got it
        </button>
      </div>
    </div>
  );
};
