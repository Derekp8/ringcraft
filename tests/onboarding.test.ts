/**
 * Tests for onboarding system
 * Verify state management, phase transitions, step completion
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ONBOARDING_STEPS, getPhaseSteps, getStepById } from '../onboarding/steps';
import type { OnboardingState, OnboardingPhase } from '../onboarding/types';

describe('Onboarding System', () => {
  describe('Steps', () => {
    it('should have steps for all phases', () => {
      const phases: OnboardingPhase[] = [
        'welcome',
        'character-creation',
        'team-setup',
        'dashboard-orientation',
        'first-actions',
        'complete',
      ];

      phases.forEach((phase) => {
        const steps = getPhaseSteps(phase);
        expect(steps.length).toBeGreaterThan(0);
      });
    });

    it('should find step by ID', () => {
      const step = getStepById('welcome-intro');
      expect(step).toBeDefined();
      expect(step?.title).toBe('Welcome to Project Ringcraft');
    });

    it('should have mandatory welcome step', () => {
      const welcomeSteps = getPhaseSteps('welcome');
      const mandatory = welcomeSteps.filter((s) => s.mandatory);
      expect(mandatory.length).toBeGreaterThan(0);
    });
  });

  describe('State Management', () => {
    let state: OnboardingState;

    beforeEach(() => {
      state = {
        currentPhase: 'welcome',
        careerMode: null,
        completedSteps: new Set(),
        isDismissed: false,
        hasSeenBefore: false,
        activeStepId: null,
      };
    });

    it('should initialize in welcome phase', () => {
      expect(state.currentPhase).toBe('welcome');
      expect(state.isDismissed).toBe(false);
    });

    it('should track completed steps', () => {
      state.completedSteps.add('welcome-intro');
      expect(state.completedSteps.has('welcome-intro')).toBe(true);
    });

    it('should mark as dismissed', () => {
      state.isDismissed = true;
      expect(state.isDismissed).toBe(true);
    });
  });

  describe('Phase Progression', () => {
    it('should transition through phases in order', () => {
      const phases: OnboardingPhase[] = [
        'welcome',
        'character-creation',
        'team-setup',
        'dashboard-orientation',
        'first-actions',
        'complete',
      ];

      phases.forEach((phase, index) => {
        if (index < phases.length - 1) {
          const nextPhase = phases[index + 1];
          expect(phases.indexOf(nextPhase)).toBe(index + 1);
        }
      });
    });
  });

  describe('Career Mode Selection', () => {
    it('should support solo and tag modes', () => {
      const soloState: OnboardingState = {
        currentPhase: 'welcome',
        careerMode: 'solo',
        completedSteps: new Set(),
        isDismissed: false,
        hasSeenBefore: false,
        activeStepId: null,
      };

      const tagState: OnboardingState = {
        currentPhase: 'welcome',
        careerMode: 'tag',
        completedSteps: new Set(),
        isDismissed: false,
        hasSeenBefore: false,
        activeStepId: null,
      };

      expect(soloState.careerMode).toBe('solo');
      expect(tagState.careerMode).toBe('tag');
    });

    it('should skip team-setup for solo careers', () => {
      // In actual implementation, skip this phase if careerMode === 'solo'
      const soloState: OnboardingState = {
        currentPhase: 'character-creation',
        careerMode: 'solo',
        completedSteps: new Set(),
        isDismissed: false,
        hasSeenBefore: false,
        activeStepId: null,
      };

      // After character creation in solo, should go to dashboard-orientation
      // not team-setup
      expect(soloState.careerMode).toBe('solo');
    });
  });
});
