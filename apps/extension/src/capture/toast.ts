/**
 * The Quick Save toast (FableTasks P2.S4).
 *
 * `showCaptureToast` is handed to `chrome.scripting.executeScript` and runs
 * inside the page the user just saved - only at hotkey time, never from a
 * content script (AGENTS.md guardrail 6). Chrome serialises the function
 * source, so it must be fully self-contained: no imports, no module-level
 * references, every helper nested inside. That is why it is one long function
 * rather than several small ones; the pieces are still split by job below.
 *
 * It resolves once the user decides (or the toast times out); the service
 * worker then performs the write. Everything it shows arrives through the
 * model, so all copy stays in `captureStrings.ts`.
 */

export type ToastOutcome =
  | { kind: 'timeout' }
  | { kind: 'undo' }
  | { kind: 'open' }
  | { kind: 'note'; note: string };

export interface ToastModel {
  /** tokens.css (with `:root` rewritten to `:host`) followed by toast.css. */
  css: string;
  theme: 'night' | 'day' | 'system';
  /** `saved` offers note + undo; `duplicate` offers open. */
  mode: 'saved' | 'duplicate';
  message: string;
  hint: string;
  labels: {
    addNote: string;
    undo: string;
    openDeck: string;
    notePlaceholder: string;
    noteSaved: string;
    undone: string;
    failed: string;
  };
  durationMs: number;
  /** How long the "Note saved" / "Removed" confirmation lingers. */
  confirmMs: number;
  /** An open note with no keystrokes for this long is saved as typed. */
  noteIdleMs: number;
  /**
   * Set by the service worker. The toast then returns `true` as soon as it is
   * on screen and reports the decision by message, which wakes the worker if
   * Chrome has put it to sleep meanwhile - a long note can outlive it.
   */
  report?: ToastReport;
}

export interface ToastReport {
  type: string;
  cardId: string;
  pageId: string;
}

/** The reply to a report: whether the write actually happened. */
export interface ToastReply {
  isDone: boolean;
}

export const TOAST_HOST_ID = 'deck-capture-toast';

export function showCaptureToast(
  model: ToastModel,
): Promise<ToastOutcome> | true {
  const HOST_ID = 'deck-capture-toast';
  const EXIT_MS = 320;

  document.getElementById(HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = model.css;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.dataset.theme = model.theme;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.dataset.deck = 'capture-toast';

  const message = document.createElement('p');
  message.className = 'message';
  message.textContent = model.message;
  const row = document.createElement('div');
  row.className = 'row';
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = model.hint;
  const makeButton = (label: string, action: string): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.action = action;
    return button;
  };
  const isSaved = model.mode === 'saved';
  const buttons = isSaved
    ? [
        makeButton(model.labels.addNote, 'note'),
        makeButton(model.labels.undo, 'undo'),
      ]
    : [makeButton(model.labels.openDeck, 'open')];
  const noteInput = document.createElement('input');
  noteInput.type = 'text';
  noteInput.placeholder = model.labels.notePlaceholder;
  noteInput.setAttribute('aria-label', model.labels.addNote);
  noteInput.hidden = true;
  row.append(hint, ...buttons);
  toast.append(message, row, noteInput);
  root.append(style, toast);
  document.documentElement.append(host);
  requestAnimationFrame(() => {
    toast.dataset.visible = '';
  });

  const decision = new Promise<ToastOutcome>((resolve) => {
    let timer: number | undefined;
    let isSettled = false;

    const remove = (delayMs: number) => {
      window.setTimeout(() => {
        delete toast.dataset.visible;
        window.setTimeout(() => host.remove(), EXIT_MS);
      }, delayMs);
    };
    const show = (text: string, delayMs: number) => {
      message.textContent = text;
      row.hidden = true;
      noteInput.hidden = true;
      remove(delayMs);
    };
    // Confirms only what the service worker says it actually wrote.
    const report = (
      outcome: ToastOutcome,
      confirmation: string | undefined,
    ) => {
      const fail = () => show(model.labels.failed, model.confirmMs * 2);
      chrome.runtime
        .sendMessage({ ...model.report, outcome })
        .then((reply: ToastReply | undefined) => {
          if (!reply?.isDone) fail();
          else if (confirmation) show(confirmation, model.confirmMs);
          else remove(0);
        }, fail);
    };
    const settle = (outcome: ToastOutcome, confirmation?: string) => {
      if (isSettled) return;
      isSettled = true;
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown, true);
      resolve(outcome);
      if (model.report && outcome.kind !== 'timeout')
        report(outcome, confirmation);
      else if (confirmation) show(confirmation, model.confirmMs);
      else remove(0);
    };
    const startTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => settle({ kind: 'timeout' }),
        model.durationMs,
      );
    };
    const openNote = () => {
      row.hidden = true;
      noteInput.hidden = false;
      noteInput.focus();
      startNoteIdle();
    };
    const submitNote = () => {
      const note = noteInput.value.trim();
      if (note) settle({ kind: 'note', note }, model.labels.noteSaved);
      else settle({ kind: 'timeout' });
    };
    // Someone who starts a note and walks away keeps what they typed.
    const startNoteIdle = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(submitNote, model.noteIdleMs);
    };
    /*
     * The shadow root is closed, so a window listener sees events from the
     * note input retargeted to the host. Focus on the host therefore means
     * "typing a note", and the input's own listener owns those keys.
     */
    const isTypingElsewhere = (event: KeyboardEvent): boolean => {
      if (document.activeElement === host) return true;
      const target = event.composedPath()[0];
      return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      );
    };
    // A page can synthesise events; only a real keystroke may undo or note.
    function onKeyDown(event: KeyboardEvent) {
      if (!event.isTrusted || isTypingElsewhere(event)) return;
      let isHandled = true;
      if (event.key === 'Escape') settle({ kind: 'timeout' });
      else if (event.key === 'Enter' && isSaved) openNote();
      else if (event.key === 'Enter') settle({ kind: 'open' });
      else if (event.key === 'Backspace' && isSaved)
        settle({ kind: 'undo' }, model.labels.undone);
      else isHandled = false;
      if (isHandled) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    noteInput.addEventListener('keydown', (event) => {
      // Keep the page's own shortcuts from firing while a note is typed.
      event.stopPropagation();
      if (!event.isTrusted) return;
      if (event.key === 'Enter') submitNote();
      else if (event.key === 'Escape') settle({ kind: 'timeout' });
      else startNoteIdle();
    });
    row.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      const action =
        event.target instanceof HTMLElement ? event.target.dataset.action : '';
      if (action === 'note') openNote();
      if (action === 'undo') settle({ kind: 'undo' }, model.labels.undone);
      if (action === 'open') settle({ kind: 'open' });
    });
    toast.addEventListener('mouseenter', () => {
      if (noteInput.hidden) window.clearTimeout(timer);
    });
    toast.addEventListener('mouseleave', () => {
      if (noteInput.hidden) startTimer();
    });
    window.addEventListener('keydown', onKeyDown, true);
    startTimer();
  });
  return model.report ? true : decision;
}

/** Scopes tokens.css to the shadow host so it cannot touch the page. */
export function toastStylesheet(tokensCss: string, toastCss: string): string {
  return `${tokensCss.replaceAll(':root', ':host')}\n${toastCss}`;
}
