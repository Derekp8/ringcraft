// Main onboarding exports - update to include all features
export { OnboardingProvider, useOnboarding } from './OnboardingContext';
export { OnboardingOverlay } from './OnboardingOverlay';
export { OnboardingTooltip } from './OnboardingTooltip';
export { GuidedAction } from './GuidedAction';
export { OnboardingFlowOrchestrator, useOnboardingGuard } from './OnboardingFlowOrchestrator';
export { OnboardingProgressIndicator } from './OnboardingProgressIndicator';
export { OnboardingHints } from './OnboardingHints';
export { useOnboardingPhaseGuard, useFeatureAvailability } from './useOnboardingPhaseGuard';
export { useOnboardingAnalytics, type OnboardingAnalyticsEvent } from './useOnboardingAnalytics';
export type { OnboardingContextType, OnboardingState, OnboardingStep, OnboardingPhase, CareerMode } from './types';
export { ONBOARDING_STEPS, getPhaseSteps, getStepById } from './steps';
