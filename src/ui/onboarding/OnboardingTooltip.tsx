import React, { useEffect, useRef } from 'react';
import { useOnboarding } from './OnboardingContext';
import './OnboardingTooltip.css';

/**
 * Inline tooltip that appears next to a target element.
 * Lighter than overlay, for contextual hints.
 */

interface OnboardingTooltipProps {
  /** CSS selector for the element to attach to */
  targetSelector: string;
  /** Tooltip content */
  children?: React.ReactNode;
  /** Which side to position on */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Optional callback when dismissed */
  onDismiss?: () => void;
}

export const OnboardingTooltip: React.FC<OnboardingTooltipProps> = ({
  targetSelector,
  children,
  position = 'bottom',
  onDismiss,
}) => {
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = document.querySelector(targetSelector) as HTMLElement;
    if (!target || !tooltipRef.current) return;

    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const tooltip = tooltipRef.current;

    let top = 0;
    let left = 0;
    const gap = 8;

    switch (position) {
      case 'top':
        top = targetRect.top + window.scrollY - tooltipRect.height - gap;
        left = targetRect.left + window.scrollX + targetRect.width / 2 - tooltipRect.width / 2;
        break;
      case 'bottom':
        top = targetRect.bottom + window.scrollY + gap;
        left = targetRect.left + window.scrollX + targetRect.width / 2 - tooltipRect.width / 2;
        break;
      case 'left':
        top = targetRect.top + window.scrollY + targetRect.height / 2 - tooltipRect.height / 2;
        left = targetRect.left + window.scrollX - tooltipRect.width - gap;
        break;
      case 'right':
        top = targetRect.top + window.scrollY + targetRect.height / 2 - tooltipRect.height / 2;
        left = targetRect.right + window.scrollX + gap;
        break;
    }

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip.style.opacity = '1';
  }, [targetSelector, position]);

  return (
    <div ref={tooltipRef} className={`onboarding-tooltip onboarding-tooltip-${position}`}>
      {children}
      {onDismiss && (
        <button
          className="onboarding-tooltip-close"
          onClick={onDismiss}
          aria-label="Dismiss tooltip"
        >
          ✕
        </button>
      )}
    </div>
  );
};
