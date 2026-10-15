/**
 * Strings the new tab needs before first paint. Everything shown only by the
 * drawer, Settings or a Line action lives in `panelStrings.ts`, which loads
 * with those chunks - this file counts against the 60 kB surface budget
 * (AGENTS.md section 3.3). A translation adds a sibling of each file.
 */
export const strings = {
  linePlaceholder: 'Search or type >',
  lineKeyboardHint: 'Space: Deck · ?: keys',
  greetingMorning: 'Good morning',
  greetingNight: 'Good night',
  greetingAfternoon: 'Good afternoon',
  greetingEvening: 'Good evening',
  examplesTitle: 'Examples',
  examples: [
    'MDN Web Docs',
    'GitHub',
    'Internet Archive',
    'Wikipedia',
    'Web Standards',
    'TypeScript',
  ],
  pinsLabel: 'Pins',
  pinsEmptyHint: 'Pin a site · Space opens Deck',
  addPin: 'Add pin',
  pinLimit: '12 pins max',
  settings: 'Settings',
  blurMode: 'Blur',
  updateFailed: 'Action failed.',
  saved: 'Saved',
  undo: 'Undo',
  openDrawer: 'Open Deck drawer',
  inbox: 'Inbox',
  newPage: 'New page',
  newDeck: 'New deck',
  drawerHandle: 'Deck · Space',
} as const;
