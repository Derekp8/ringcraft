/**
 * Example: Integrating onboarding into Career UI
 * Shows how to use the onboarding system in your actual application.
 */

import React from 'react';
import {
  OnboardingProvider,
  OnboardingOverlay,
  GuidedAction,
  useOnboarding,
  OnboardingFlowOrchestrator,
} from '../onboarding';

/**
 * Example Career Mode component
 */
function CareerMode() {
  return (
    <OnboardingProvider>
      <CareerModeContent />
    </OnboardingProvider>
  );
}

function CareerModeContent() {
  const { state, dismiss, reset } = useOnboarding();

  return (
    <div className="career-mode">
      {/* Orchestrator manages flow automatically */}
      <OnboardingFlowOrchestrator />

      {/* Overlay displays tutorial steps */}
      <OnboardingOverlay />

      {/* Header with tutorial controls */}
      <header className="career-header">
        <h1>Career Mode</h1>
        {!state.isDismissed && state.currentPhase !== 'complete' && (
          <div className="tutorial-controls">
            <button onClick={() => dismiss()}>Skip Tutorial</button>
            <button onClick={() => reset()}>Restart Tutorial</button>
          </div>
        )}
      </header>

      {/* Main career content */}
      <main className="career-main">
        {state.currentPhase === 'welcome' && <WelcomePhase />}
        {state.currentPhase === 'character-creation' && <CharacterCreationPhase />}
        {state.currentPhase === 'team-setup' && <TeamSetupPhase />}
        {[
          'dashboard-orientation',
          'first-actions',
          'complete',
        ].includes(state.currentPhase) && <CareerDashboard />}
      </main>
    </div>
  );
}

/**
 * Welcome phase: show career mode selector
 */
function WelcomePhase() {
  const { setCareerMode, nextPhase } = useOnboarding();

  return (
    <div className="welcome-phase">
      <h2>Choose Your Path</h2>
      <p>Would you like a solo career or a tag team career?</p>
      <div data-onboarding="career-mode-selector" className="career-mode-buttons">
        <button
          onClick={() => {
            setCareerMode('solo');
            nextPhase();
          }}
        >
          Solo Career
        </button>
        <button
          onClick={() => {
            setCareerMode('tag');
            nextPhase();
          }}
        >
          Tag Team Career
        </button>
      </div>
    </div>
  );
}

/**
 * Character creation phase
 */
function CharacterCreationPhase() {
  const { completeStep } = useOnboarding();
  const [wrestler, setWrestler] = React.useState({ name: '', stats: {} });

  const handleCreate = () => {
    // Validate and create wrestler
    completeStep('char-create-intro');
    completeStep('char-create-stats');
    completeStep('char-create-preview');
  };

  return (
    <div className="character-creation-phase">
      <h2>Create Your Wrestler</h2>
      <div data-onboarding="stats-selector" className="stats-form">
        <input
          type="text"
          placeholder="Wrestler Name"
          value={wrestler.name}
          onChange={(e) => setWrestler({ ...wrestler, name: e.target.value })}
        />
        {/* Stats input fields */}
      </div>
      <button onClick={handleCreate}>Create Wrestler</button>
    </div>
  );
}

/**
 * Team setup phase (tag only)
 */
function TeamSetupPhase() {
  const { state, completeStep } = useOnboarding();

  if (state.careerMode !== 'tag') {
    return null;
  }

  return (
    <div className="team-setup-phase">
      <h2>Build Your Tag Team</h2>
      <div data-onboarding="roster-import" className="roster-section">
        {/* Roster import UI */}
      </div>
      <button onClick={() => completeStep('team-setup-intro')}>Continue</button>
    </div>
  );
}

/**
 * Career dashboard: main UI after onboarding
 */
function CareerDashboard() {
  const { state } = useOnboarding();

  return (
    <div className="career-dashboard">
      <div className="dashboard-grid">
        {/* Calendar */}
        <section data-onboarding="calendar" className="calendar-section">
          <h3>Calendar</h3>
          {/* Calendar UI */}
        </section>

        {/* Ratings - only show after dashboard-orientation phase */}
        {[
          'dashboard-orientation',
          'first-actions',
          'complete',
        ].includes(state.currentPhase) && (
          <section data-onboarding="ratings-panel" className="ratings-section">
            <h3>Ratings</h3>
            {/* Ratings table */}
          </section>
        )}

        {/* Titles */}
        <section data-onboarding="titles-panel" className="titles-section">
          <h3>Titles</h3>
          {/* Titles list */}
        </section>

        {/* Injuries */}
        <section data-onboarding="injuries-panel" className="injuries-section">
          <h3>Injuries</h3>
          {/* Injuries list */}
        </section>

        {/* WP */}
        <section data-onboarding="wp-panel" className="wp-section">
          <h3>Career Capital (WP)</h3>
          {/* WP display and spending */}
        </section>
      </div>

      {/* Match booking - gated to first-actions phase */}
      {[
        'first-actions',
        'complete',
      ].includes(state.currentPhase) && (
        <section data-onboarding="booking-controls" className="booking-section">
          <GuidedAction
            guideStepId="first-actions-booking"
            disableDuringOnboarding={false}
          >
            <BookMatchButton />
          </GuidedAction>
        </section>
      )}

      {/* Match result summary - show after first match */}
      {state.currentPhase === 'complete' && (
        <section data-onboarding="match-result-summary" className="result-section">
          <MatchResultSummary />
        </section>
      )}
    </div>
  );
}

/**
 * Book match button
 */
function BookMatchButton() {
  return <button>Book a Match</button>;
}

/**
 * Match result summary
 */
function MatchResultSummary() {
  return <div>Match Result</div>;
}

export default CareerMode;
