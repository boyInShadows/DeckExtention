/**
 * User-facing strings for Quick Save (FableTasks P2.S4).
 *
 * Kept apart from `strings.ts` for one reason: only the service worker reads
 * these, and anything in `strings.ts` ships in the new tab's first paint,
 * which is held to a 60 kB budget (AGENTS.md section 3.3). A Persian
 * translation adds a sibling of this file exactly as it does for `strings.ts`.
 */
export const captureStrings = {
  menuSavePage: 'Save to Deck',
  menuSaveLink: 'Save link to Deck',
  saved: 'Saved to Inbox',
  savedHint: '↩ add note · ⌫ undo',
  duplicate: 'Already in',
  duplicateHint: '↩ open Deck',
  inbox: 'Inbox',
  addNote: 'Add note',
  undo: 'Undo',
  openDeck: 'Open Deck',
  notePlaceholder: 'Note, then Enter',
  noteSaved: 'Note saved',
  undone: 'Removed from Inbox',
  unsupportedPage: 'Deck can’t save this page. Only web pages can be saved.',
  savedWithoutToast: 'Saved to Inbox:',
  needsPermission:
    'Quick Save needs one-time access. Allow it under Settings › Keys, then press the shortcut again.',
  saveFailed: 'Quick Save failed:',
  toastFailed: 'That didn’t go through. Open Deck to check.',
} as const;
