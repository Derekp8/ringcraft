import { OnboardingStep } from './types';

/**
 * All onboarding steps, organized by phase
 * These are the definitive tutorial content for each step
 */

export const ONBOARDING_STEPS: OnboardingStep[] = [
  // WELCOME PHASE
  {
    id: 'welcome-intro',
    phase: 'welcome',
    title: 'Welcome to Project Ringcraft',
    description:
      'Step into the world of All Star Wrestling. You\'re about to start a career as a professional wrestler, managing your rise through the ranks, competing for titles, and building your legacy.',
    mandatory: true,
  },
  {
    id: 'welcome-career-modes',
    phase: 'welcome',
    title: 'Choose Your Path',
    description:
      'Will you pursue a solo career, or team up with a tag partner? Solo offers focus and clear progression. Tag requires coordination and teamwork but opens new strategic options.',
    targetSelector: '[data-onboarding="career-mode-selector"]',
    mandatory: true,
  },

  // CHARACTER CREATION PHASE
  {
    id: 'char-create-intro',
    phase: 'character-creation',
    title: 'Create Your Wrestler',
    description:
      'Give your wrestler a name and choose their starting stats. Strength, Speed, Technique, and Stamina determine how you perform in matches. You can adjust these as you progress.',
    mandatory: true,
  },
  {
    id: 'char-create-stats',
    phase: 'character-creation',
    title: 'Understanding Stats',
    description:
      'Strength affects power moves and damage. Speed helps with aerial attacks and escapes. Technique improves submission and counter offense. Stamina increases your endurance throughout long matches.',
    targetSelector: '[data-onboarding="stats-selector"]',
  },
  {
    id: 'char-create-preview',
    phase: 'character-creation',
    title: 'Career Starting Point',
    description:
      'Your starting rating is determined by your stats. Higher initial stats mean you\'ll compete against tougher opponents from day one, but advance faster.',
  },

  // TEAM SETUP PHASE (tag only)
  {
    id: 'team-setup-intro',
    phase: 'team-setup',
    title: 'Build Your Tag Team',
    description:
      'In tag careers, you\'ll form a stable two-person team. Your partner\'s strength matters—together you\'ll compete in tag rankings and pursue tag titles.',
    mandatory: true,
  },
  {
    id: 'team-setup-import',
    phase: 'team-setup',
    title: 'Import Your Roster',
    description:
      'Load a wrestler roster to choose your tag partner from existing wrestlers. This reference roster defines available opponents and determines title/ranking pools.',
    targetSelector: '[data-onboarding="roster-import"]',
  },
  {
    id: 'team-setup-pairing',
    phase: 'team-setup',
    title: 'Select Your Partner',
    description:
      'Choose a tag partner from your roster. Their stats and history will affect your team\'s starting rating and matchups. You can change partners later, but it resets team rankings.',
  },

  // DASHBOARD ORIENTATION PHASE
  {
    id: 'dashboard-overview',
    phase: 'dashboard-orientation',
    title: 'Your Career Dashboard',
    description:
      'This is your command center. Here you\'ll track your current status, upcoming schedule, and manage career decisions.',
    mandatory: true,
  },
  {
    id: 'dashboard-calendar',
    phase: 'dashboard-orientation',
    title: 'Calendar & Schedule',
    description:
      'The calendar shows your current month and upcoming bookings. Each match slot is confirmed or offered. Plan ahead—some slots have special constraints.',
    targetSelector: '[data-onboarding="calendar"]',
  },
  {
    id: 'dashboard-ratings',
    phase: 'dashboard-orientation',
    title: 'Ratings & Ranking',
    description:
      'Your rating determines your standing. Win matches to climb the rankings. Lose and your rating drops. The top-rated wrestlers compete for titles each month.',
    targetSelector: '[data-onboarding="ratings-panel"]',
  },
  {
    id: 'dashboard-titles',
    phase: 'dashboard-orientation',
    title: 'Championship Titles',
    description:
      'Titles are your legacy. Earn title shots by maintaining high ratings. Hold a title to gain prestige—but defend it regularly or face stripping. Every title has unique requirements.',
    targetSelector: '[data-onboarding="titles-panel"]',
  },
  {
    id: 'dashboard-injuries',
    phase: 'dashboard-orientation',
    title: 'Health & Injuries',
    description:
      'Injuries can sideline you for weeks or months. Critical injuries require special recovery. Plan your schedule around recovery windows, and avoid overstretching yourself.',
    targetSelector: '[data-onboarding="injuries-panel"]',
  },
  {
    id: 'dashboard-wp',
    phase: 'dashboard-orientation',
    title: 'Career Capital (WP)',
    description:
      'WP (Wrestling Points) is currency you earn by winning. Spend it to improve stats, or let it accumulate for passive bonuses. Strategic spending defines your long-term growth.',
    targetSelector: '[data-onboarding="wp-panel"]',
  },

  // FIRST ACTIONS PHASE
  {
    id: 'first-actions-intro',
    phase: 'first-actions',
    title: 'Time to Compete',
    description:
      'You\'re ready. Let\'s book your first match. This match will teach you how the match system works and give you your first taste of victory (or defeat).',
    mandatory: true,
  },
  {
    id: 'first-actions-booking',
    phase: 'first-actions',
    title: 'Booking a Match',
    description:
      'Click on an open match slot in the calendar. You\'ll see available opponents at your rating level. Choose wisely—tougher opponents give more WP but harder wins.',
    targetSelector: '[data-onboarding="booking-controls"]',
  },
  {
    id: 'first-actions-opponent',
    phase: 'first-actions',
    title: 'Scouting Your Opponent',
    description:
      'Review your opponent\'s stats and record. Higher stats mean a tougher fight. The match engine will simulate the encounter—both wrestlers use strategy and randomness.',
  },
  {
    id: 'first-actions-match-result',
    phase: 'first-actions',
    title: 'Match Resolution',
    description:
      'Your match will resolve automatically. You\'ll see a detailed summary of what happened: key moves, near-falls, stamina changes, and the final outcome.',
    targetSelector: '[data-onboarding="match-result-summary"]',
  },
  {
    id: 'first-actions-rating-update',
    phase: 'first-actions',
    title: 'Ratings Updated',
    description:
      'Your win (or loss) changed your rating and standings. Monthly rankings reset, so stay consistent to hold high positions and earn title opportunities.',
  },

  // COMPLETION
  {
    id: 'complete-ready',
    phase: 'complete',
    title: 'You\'re Ready',
    description:
      'Congratulations! You now understand the basics of a Ringcraft career. Continue competing, manage your health, chase titles, and build your legend. Good luck!',
  },
];

/**
 * Get all steps for a specific phase
 */
export const getPhaseSteps = (phase: string): OnboardingStep[] => {
  return ONBOARDING_STEPS.filter((step) => step.phase === phase);
};

/**
 * Get a step by ID
 */
export const getStepById = (id: string): OnboardingStep | undefined => {
  return ONBOARDING_STEPS.find((step) => step.id === id);
};
