/**
 * Strings the new tab needs before first paint. Everything shown only by the
 * drawer, Settings or a Line action lives in `panelStrings.ts`, which loads
 * with those chunks - this file counts against the 60 kB surface budget
 * (AGENTS.md section 3.3). A translation adds a sibling of each file.
 */
export const strings = {
  count: (value: number) => String(value),
  isoWeek: (year: number, week: number) =>
    `${year}-W${String(week).padStart(2, '0')}`,
  isoWeekLabel: (year: number, week: number) => `ISO week ${week}, ${year}`,
  links: 'Links',
  tasks: 'Tasks',
  sessions: 'Sessions',
  focus: 'Focus',
  sections: 'Workspace sections',
  openSection: (label: string) => `Open ${label}`,
  taskSaved: 'Task saved to Inbox',
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
  previousLinks: 'Previous links',
  moreLinks: 'More links',
  surfaceExtras: 'Your workspace',
  pinRange: (first: number, last: number, total: number) =>
    `${first}-${last} of ${total}`,
  settings: 'Settings',
  blurMode: 'Blur',
  updateFailed: 'Action failed.',
  backupFailed: 'Backup failed.',
  saved: 'Saved',
  undo: 'Undo',
  openDrawer: 'Open Deck drawer: Deck · Space',
  inbox: 'Inbox',
  newPage: 'New page',
  newDeck: 'New deck',
  drawerHandle: 'Deck · Space',
  sortable: 'sortable',
  dragInstructions:
    'To pick up a draggable item, press the space bar. While dragging, use the arrow keys to move the item. Press space again to drop the item in its new position, or press escape to cancel.',
  dragPickedUp: (id: string | number) => `Picked up draggable item ${id}.`,
  dragOver: (id: string | number, overId: string | number) =>
    `Draggable item ${id} was moved over droppable area ${overId}.`,
  dragLeft: (id: string | number) =>
    `Draggable item ${id} is no longer over a droppable area.`,
  dragDropped: (id: string | number, overId: string | number | undefined) =>
    overId === undefined
      ? `Draggable item ${id} was dropped.`
      : `Draggable item ${id} was dropped over droppable area ${overId}`,
  dragCancelled: (id: string | number) =>
    `Dragging was cancelled. Draggable item ${id} was dropped.`,
} as const;
