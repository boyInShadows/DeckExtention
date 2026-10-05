import { strings } from './strings';

/**
 * Strings for the lazily loaded panels: drawer, Settings, Line actions.
 * Includes every surface string too, so a panel file imports one object.
 */
export const panelStrings = {
  ...strings,
  closeSettings: 'Close settings',
  appearance: 'Appearance',
  keys: 'Keys',
  backups: 'Backups',
  advanced: 'Advanced',
  theme: 'Theme',
  themeNight: 'Night',
  themeDay: 'Day',
  themeSystem: 'System',
  yourName: 'Your name',
  showSeconds: 'Show seconds',
  privacyBlur: 'Privacy blur',
  spaceOpensDrawer: 'Space opens drawer',
  wallpaperNone: 'None',
  wallpaperColor: 'Color',
  wallpaperLocal: 'Local',
  wallpaperDim: 'Wallpaper dim',
  customCss: 'Custom CSS',
  customCssHint: 'Targets stable [data-deck] attributes.',
  backupHint: 'Keeps seven local snapshots.',
  noBackups: 'No snapshots yet.',
  restore: 'Restore',
  restoreConfirm: 'Replace data with this backup?',
  exportData: 'Export data',
  importData: 'Import data',
  importConfirm: 'Import and replace data?',
  keyHint: 'Chrome manages extension shortcuts.',
  openShortcutSettings: 'Open shortcut settings',
  drawerRequired: 'Open the drawer first.',
  stashComing: 'Stash arrives in Phase 3.',
  searchEngine: 'Search template',
  drawer: 'Deck drawer',
  pinLimitReached: 'Pins are full.',
  dropToPins: 'Drop to Pins',
  closeDrawer: 'Close Deck drawer',
  pages: 'Pages',
  addPage: 'Add page',
  renamePagePrompt: 'Page name',
  selectPage: 'Select a page.',
  addDeck: '+ Add deck',
  addCard: 'Add link',
  pasteUrl: 'Paste a URL',
  emptyDeck: 'Drop links here, or press + to paste',
  collapseDeck: 'Collapse deck',
  deckMenu: 'Deck menu',
  renameDeck: 'Rename',
  renameDeckPrompt: 'Deck name',
  editDeckNote: 'Edit deck note',
  editNote: 'Edit note',
  openAll: 'Open all',
  deckColor: 'Color',
  defaultColor: 'Default',
  moveToPage: 'Move to page',
  trashDeck: 'Trash deck',
  trashCard: 'Trash card',
  markDone: 'Toggle done',
  tabsPermissionDeclined: 'Open all needs tabs permission.',
  preview: 'Preview',
  edit: 'Edit',
  close: 'Close',
  saveNote: 'Save note',
  inboxZero: 'Inbox zero.',
  triageHint: '↑↓ · ⇧ select · m move · x trash · n note · p pin · ⏎ open',
  moveTo: 'Move to…',
  noDeckMatch: 'No matching deck.',
  noDecks: 'Make a deck first.',
  quickSave: 'Quick Save',
  quickSaveReason: 'reads the page you save and shows a small toast on it.',
  allowAccess: 'Allow',
  revokeAccess: 'Revoke',
  accessTabs: 'Open all',
  accessTabsReason: 'opens every link in a deck as new tabs.',
  accessSearch: 'Web search',
  accessSearchReason: 'runs ? queries through your Chrome search engine.',
  import: 'Import',
  bookmarks: 'Bookmarks',
  bookmarksReason: 'reads your Chrome bookmarks once, to copy them into Deck.',
  importChromeBookmarks: 'Import Chrome bookmarks',
  importBookmarksFile: 'Bookmarks file (.html)',
  bookmarksDeclined: 'Bookmark import needs access to your bookmarks.',
  importConfirmButton: 'Import',
  cancel: 'Cancel',
  importing: 'Importing…',
  importPreview: (counts: {
    pages: number;
    decks: number;
    links: number;
    duplicates: number;
    unsupported: number;
  }) =>
    `${plural(counts.pages, 'folder')} → ${plural(counts.pages, 'page')}, ` +
    `${plural(counts.decks, 'subfolder')} → ${plural(counts.decks, 'deck')}, ` +
    `${plural(counts.links, 'link')}${skippedNote(counts)}`,
  importNothingNew: (duplicates: number) =>
    `Nothing new to import${duplicates > 0 ? ` - ${plural(duplicates, 'duplicate')} skipped` : ''}.`,
  importDone: (links: number) => `Imported ${plural(links, 'link')}.`,
  keyboard: 'Keyboard',
  keysAnywhere: 'Anywhere',
  keysDrawer: 'Drawer',
  keysInbox: 'Inbox',
  keysBrowser: 'Browser shortcuts',
  keyHelp: 'This help',
  keySpace: 'Open the drawer (empty Line)',
  keyEscape: 'Close / clear',
  keyAltDigit: 'Jump to page 1–9',
  keyLift: 'Lift / drop a card',
  keySelect: 'Select a range',
  keyNotSet: 'not set',
  rebindHint: 'Rebind in Settings › Keys.',
  pressKeys: 'Press keys… (Esc cancels)',
  resetKey: 'Reset',
  keyReserved: 'That key is reserved.',
  keySingleCharacter: 'Use one plain character here.',
  keyConflict: 'Already used by',
  keyLabels: {
    focusLine: 'Search',
    blur: 'Privacy blur',
    next: 'Next card',
    previous: 'Previous card',
    nextDeck: 'Next deck',
    previousDeck: 'Previous deck',
    nextPage: 'Next page',
    previousPage: 'Previous page',
    open: 'Open',
    openInNewTab: 'Open in new tab',
    move: 'Move to…',
    trash: 'Trash',
    note: 'Note',
    pin: 'Pin',
    addLink: 'Add link',
    addDeck: 'Add deck',
  },
} as const;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function skippedNote({
  duplicates,
  unsupported,
}: {
  duplicates: number;
  unsupported: number;
}): string {
  const notes = [
    duplicates > 0 ? `${plural(duplicates, 'duplicate')} skipped` : '',
    unsupported > 0 ? `${unsupported} unsupported skipped` : '',
  ].filter(Boolean);
  return notes.length > 0 ? ` (${notes.join(', ')})` : '';
}
