/**
 * Strings the new tab needs before first paint. Everything shown only by the
 * drawer, Settings or a Line action lives in `panelStrings.ts`, which loads
 * with those chunks - this file counts against the 60 kB surface budget
 * (AGENTS.md section 3.3). A translation adds a sibling of each file.
 */
export const strings = {
  linePlaceholder: 'Search or > commands',
  lineKeyboardHint: 'Space: drawer · ?: keys',
  greetingMorning: 'Good morning',
  greetingAfternoon: 'Good afternoon',
  greetingEvening: 'Good evening',
  examplesPage: 'Examples',
  examplesDeck: 'Examples',
  examples: [
    'MDN Web Docs',
    'GitHub',
    'Internet Archive',
    'Wikipedia',
    'Web Standards',
    'TypeScript',
  ],
  pinsLabel: 'Pins',
  addPin: 'Add pin',
  pinUrlPlaceholder: 'Paste a URL',
  pinLabelPlaceholder: 'Label (optional)',
  pinLimit: '12 pins max. Unpin one.',
  invalidUrl: 'Enter a web URL.',
  renamePin: 'Rename pin',
  changePinIcon: 'Emoji icon',
  unpin: 'Unpin',
  renamePinPrompt: 'Pin label',
  iconPrompt: 'Emoji (blank for favicon)',
  settings: 'Settings',
  updateFailed: 'Action failed.',
  saved: 'Saved',
  savePin: 'Save',
  undo: 'Undo',
  openDrawer: 'Open Deck drawer',
  inbox: 'Inbox',
  newPage: 'New page',
  newDeck: 'New deck',
  drawerHandle: '⌃ Deck',
} as const;
