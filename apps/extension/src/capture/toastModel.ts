import type { Theme } from 'deck-schema';

import { captureStrings } from '../i18n/captureStrings';
import type { SaveResult } from './quickSave';
import type { ToastModel } from './toast';

/** FableTasks P2.S4: a 2.5 s toast. */
export const TOAST_DURATION_MS = 2_500;
const TOAST_CONFIRM_MS = 900;
const NOTE_IDLE_MS = 20_000;

/** How the page-side toast reports a decision back to the service worker. */
export const TOAST_MESSAGE_TYPE = 'deck:toast-decision';

export function buildToastModel(
  result: SaveResult,
  theme: Theme,
  css: string,
): ToastModel {
  const isSaved = result.kind === 'saved';
  const location =
    result.kind === 'duplicate'
      ? (result.location ?? captureStrings.inbox)
      : '';
  return {
    css,
    theme,
    mode: isSaved ? 'saved' : 'duplicate',
    message: isSaved
      ? captureStrings.saved
      : `${captureStrings.duplicate} ${location}`,
    hint: isSaved ? captureStrings.savedHint : captureStrings.duplicateHint,
    labels: {
      addNote: captureStrings.addNote,
      undo: captureStrings.undo,
      openDeck: captureStrings.openDeck,
      notePlaceholder: captureStrings.notePlaceholder,
      noteSaved: captureStrings.noteSaved,
      undone: captureStrings.undone,
      failed: captureStrings.toastFailed,
    },
    durationMs: TOAST_DURATION_MS,
    confirmMs: TOAST_CONFIRM_MS,
    noteIdleMs: NOTE_IDLE_MS,
    report: {
      type: TOAST_MESSAGE_TYPE,
      cardId: result.card.id,
      pageId: result.kind === 'duplicate' ? result.pageId : 'inbox',
    },
  };
}
