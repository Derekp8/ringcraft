import React, { useEffect, useRef } from 'react';
import { useOnboarding } from './OnboardingContext';
import './OnboardingOverlay.css';

/**
 * Full-screen overlay that highlights a target element and shows
 * tutorial content. Can be positioned absolutely or use spotlight effect.
 */

export const OnboardingOverlay: React.FC = () => {
  const { state, getCurrentStep, hideStep, completeStep } = useOnboarding();
  const overlayRef = useRef<HTMLDivElement>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);

  const step = getCurrentStep();

  // Position the spotlight over the target element if specified
  useEffect(() => {
    if (!step?.targetSelector || !spotlightRef.current) return;

    const target = document.querySelector(step.targetSelector) as HTMLElement;
    if (!target) {
      console.warn(`Onboarding target not found: ${step.targetSelector}`);
      return;
    }

    const rect = target.getBoundingClientRect();
    const spotlight = spotlightRef.current;

    spotlight.style.left = `${rect.left + window.scrollX - 8}px`;
    spotlight.style.top = `${rect.top + window.scrollY - 8}px`;
    spotlight.style.width = `${rect.width + 16}px`;
    spotlight.style.height = `${rect.height + 16}px`;
  }, [step]);

  if (!step || !state.activeStepId) {
    return null;
  }

  const handleComplete = () => {
    completeStep(step.id);
    hideStep();
  };

  const handleSkip = () => {
    hideStep();
  };

  return (
    <div ref={overlayRef} className="onboarding-overlay" role="dialog" aria-label="Tutorial overlay">
      {/* Backdrop */}
      <div className="onboarding-backdrop" />

      {/* Spotlight effect (if target exists) */}
      {step.targetSelector && <div ref={spotlightRef} className="onboarding-spotlight" />}

      {/* Content card */}
      <div className="onboarding-card">
        <div className="onboarding-card-header">
          <h2 className="onboarding-title">{step.title}</h2>
          {!step.mandatory && (
            <button
              className="onboarding-close"
              onClick={handleSkip}
              aria-label="Close tutorial"
            >
              ✕
            </button>
          )}
        </div>

        <div className="onboarding-card-body">
          <p className="onboarding-description">{step.description}</p>
        </div>

        <div className="onboarding-card-footer">
          {step.secondary && !step.mandatory && (
            <button
              className="onboarding-button onboarding-button-secondary"
              onClick={() => {
                step.secondary?.handler();
                handleSkip();
              }}
            >
              {step.secondary.label}
            </button>
          )}
          <button
            className="onboarding-button onboarding-button-primary"
            onClick={() => {
              step.action?.handler();
              handleComplete();
            }}
          >
            {step.action?.label || 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};
