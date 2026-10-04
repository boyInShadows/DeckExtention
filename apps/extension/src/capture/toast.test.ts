// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  showCaptureToast,
  TOAST_HOST_ID,
  toastStylesheet,
  type ToastModel,
  type ToastOutcome,
  type ToastReply,
} from './toast';

const DURATION_MS = 2_500;
const CONFIRM_MS = 100;
const NOTE_IDLE_MS = 20_000;
const EXIT_MS = 320;

const MODEL: ToastModel = {
  css: '.toast {}',
  theme: 'night',
  mode: 'saved',
  message: 'Saved to Inbox',
  hint: 'hint',
  labels: {
    addNote: 'Add note',
    undo: 'Undo',
    openDeck: 'Open Deck',
    notePlaceholder: 'Note, then Enter',
    noteSaved: 'Note saved',
    undone: 'Removed from Inbox',
    failed: 'Could not save',
  },
  durationMs: DURATION_MS,
  confirmMs: CONFIRM_MS,
  noteIdleMs: NOTE_IDLE_MS,
};

/** The toast's root is closed; capture it as it is attached. */
function captureShadowRoot(): () => ShadowRoot {
  const attach = vi.spyOn(HTMLElement.prototype, 'attachShadow');
  return () => {
    const root = attach.mock.results.at(-1)?.value as ShadowRoot | undefined;
    if (!root) throw new Error('The toast attached no shadow root');
    return root;
  };
}

/** Only real keystrokes count; mark the test's events as the browser would. */
function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
}

function press(key: string, target: EventTarget = window): KeyboardEvent {
  const event = trusted(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
  target.dispatchEvent(event);
  return event;
}

function click(element: Element): void {
  element.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
}

function button(root: ShadowRoot, action: string): HTMLButtonElement {
  const found = root.querySelector<HTMLButtonElement>(
    `[data-action="${action}"]`,
  );
  if (!found) throw new Error(`No ${action} button`);
  return found;
}

function noteInput(root: ShadowRoot): HTMLInputElement {
  const input = root.querySelector('input');
  if (!input) throw new Error('No note input');
  return input;
}

function messageText(root: ShadowRoot): string | null | undefined {
  return root.querySelector('.message')?.textContent;
}

function host(): HTMLElement | null {
  return document.getElementById(TOAST_HOST_ID);
}

function show(model: ToastModel = MODEL): Promise<ToastOutcome> {
  const result = showCaptureToast(model);
  if (result === true) throw new Error('Expected a decision promise');
  return result;
}

let shadowRoot: () => ShadowRoot;

beforeEach(() => {
  vi.useFakeTimers();
  shadowRoot = captureShadowRoot();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.replaceChildren(
    document.createElement('head'),
    document.createElement('body'),
  );
});

describe('showCaptureToast: rendering', () => {
  it('mounts one labelled status toast with note and undo when saved', () => {
    void show();
    const root = shadowRoot();
    const toast = root.querySelector<HTMLElement>(
      '[data-deck="capture-toast"]',
    );

    expect(host()).not.toBeNull();
    expect(toast?.getAttribute('role')).toBe('status');
    expect(toast?.dataset.theme).toBe('night');
    expect(messageText(root)).toBe('Saved to Inbox');
    expect(button(root, 'note').textContent).toBe('Add note');
    expect(button(root, 'undo').textContent).toBe('Undo');
    expect(root.querySelector('[data-action="open"]')).toBeNull();
    expect(noteInput(root).hidden).toBe(true);
    expect(root.querySelector('style')?.textContent).toBe('.toast {}');
  });

  it('offers only Open Deck for a duplicate', () => {
    void show({ ...MODEL, mode: 'duplicate' });
    const root = shadowRoot();
    expect(button(root, 'open').textContent).toBe('Open Deck');
    expect(root.querySelector('[data-action="undo"]')).toBeNull();
  });

  it('becomes visible on the next frame', () => {
    void show();
    const toast = shadowRoot().querySelector<HTMLElement>('.toast');
    expect(toast?.dataset.visible).toBeUndefined();
    vi.advanceTimersToNextFrame();
    expect(toast?.dataset.visible).toBe('');
  });

  it('replaces a toast that is still on screen', () => {
    void show();
    void show();
    expect(document.querySelectorAll(`#${TOAST_HOST_ID}`)).toHaveLength(1);
  });
});

describe('showCaptureToast: keyboard', () => {
  it('times out alone and leaves the page', async () => {
    const outcome = show();
    vi.advanceTimersByTime(DURATION_MS);
    await expect(outcome).resolves.toEqual({ kind: 'timeout' });
    vi.runAllTimers();
    expect(host()).toBeNull();
  });

  it('Backspace undoes and confirms', async () => {
    const outcome = show();
    const event = press('Backspace');
    await expect(outcome).resolves.toEqual({ kind: 'undo' });
    expect(event.defaultPrevented).toBe(true);
    expect(messageText(shadowRoot())).toBe('Removed from Inbox');
    vi.advanceTimersByTime(CONFIRM_MS + EXIT_MS);
    expect(host()).toBeNull();
  });

  it('Escape dismisses without a decision', async () => {
    const outcome = show();
    press('Escape');
    await expect(outcome).resolves.toEqual({ kind: 'timeout' });
  });

  it('Enter opens Deck for a duplicate', async () => {
    const outcome = show({ ...MODEL, mode: 'duplicate' });
    press('Enter');
    await expect(outcome).resolves.toEqual({ kind: 'open' });
  });

  it('ignores keys it does not own, and untrusted keys', async () => {
    const outcome = show();
    const other = press('a');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(other.defaultPrevented).toBe(false);
    vi.advanceTimersByTime(DURATION_MS);
    await expect(outcome).resolves.toEqual({ kind: 'timeout' });
  });

  it('leaves keys alone while the user types in the page', async () => {
    const field = document.createElement('textarea');
    document.body.append(field);
    const outcome = show();
    const event = press('Backspace', field);
    expect(event.defaultPrevented).toBe(false);
    vi.advanceTimersByTime(DURATION_MS);
    await expect(outcome).resolves.toEqual({ kind: 'timeout' });
  });

  it('settles once: later keys change nothing', async () => {
    const outcome = show();
    press('Backspace');
    const late = press('Escape');
    await expect(outcome).resolves.toEqual({ kind: 'undo' });
    expect(late.defaultPrevented).toBe(false);
  });
});

describe('showCaptureToast: notes', () => {
  it('Enter opens the note, Enter saves it trimmed', async () => {
    const outcome = show();
    const root = shadowRoot();
    press('Enter');
    const input = noteInput(root);
    expect(input.hidden).toBe(false);
    input.value = '  read later  ';
    press('Enter', input);
    await expect(outcome).resolves.toEqual({
      kind: 'note',
      note: 'read later',
    });
    expect(messageText(root)).toBe('Note saved');
  });

  it('an empty note is no decision', async () => {
    const outcome = show();
    press('Enter');
    press('Enter', noteInput(shadowRoot()));
    await expect(outcome).resolves.toEqual({ kind: 'timeout' });
  });

  it('Escape in the note dismisses', async () => {
    const outcome = show();
    press('Enter');
    press('Escape', noteInput(shadowRoot()));
    await expect(outcome).resolves.toEqual({ kind: 'timeout' });
  });

  it('a note left idle is saved as typed; typing restarts the wait', async () => {
    const outcome = show();
    press('Enter');
    const input = noteInput(shadowRoot());
    input.value = 'half a thought';
    vi.advanceTimersByTime(NOTE_IDLE_MS - 1);
    press('x', input);
    vi.advanceTimersByTime(NOTE_IDLE_MS - 1);
    let isSettled = false;
    void outcome.then(() => {
      isSettled = true;
    });
    await Promise.resolve();
    expect(isSettled).toBe(false);
    vi.advanceTimersByTime(1);
    await expect(outcome).resolves.toEqual({
      kind: 'note',
      note: 'half a thought',
    });
  });

  it('keys typed in the note never reach the page', () => {
    void show();
    press('Enter');
    const pageListener = vi.fn();
    window.addEventListener('keydown', pageListener);
    press('k', noteInput(shadowRoot()));
    expect(pageListener).not.toHaveBeenCalled();
  });

  it('ignores untrusted keys in the note', async () => {
    const outcome = show();
    press('Enter');
    const input = noteInput(shadowRoot());
    input.value = 'forged';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    vi.advanceTimersByTime(NOTE_IDLE_MS);
    await expect(outcome).resolves.toEqual({ kind: 'note', note: 'forged' });
  });
});

describe('showCaptureToast: mouse', () => {
  it('buttons undo, open a note, and open Deck', async () => {
    const undone = show();
    click(button(shadowRoot(), 'undo'));
    await expect(undone).resolves.toEqual({ kind: 'undo' });

    void show();
    const root = shadowRoot();
    click(button(root, 'note'));
    expect(noteInput(root).hidden).toBe(false);

    const opened = show({ ...MODEL, mode: 'duplicate' });
    click(button(shadowRoot(), 'open'));
    await expect(opened).resolves.toEqual({ kind: 'open' });
  });

  it('ignores untrusted clicks', async () => {
    const outcome = show();
    button(shadowRoot(), 'undo').dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    vi.advanceTimersByTime(DURATION_MS);
    await expect(outcome).resolves.toEqual({ kind: 'timeout' });
  });

  it('hovering holds the toast; leaving restarts the timer', async () => {
    const outcome = show();
    const toast = shadowRoot().querySelector('.toast');
    toast?.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(DURATION_MS * 4);
    let isSettled = false;
    void outcome.then(() => {
      isSettled = true;
    });
    await Promise.resolve();
    expect(isSettled).toBe(false);
    toast?.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(DURATION_MS);
    await expect(outcome).resolves.toEqual({ kind: 'timeout' });
  });
});

describe('showCaptureToast: reporting to the service worker', () => {
  const REPORT = { type: 'deck/toast', cardId: 'c1', pageId: 'p1' };

  function stubSendMessage(reply: Promise<ToastReply | undefined>) {
    const sendMessage = vi.fn(() => reply);
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    return sendMessage;
  }

  async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  it('returns true at once and reports the decision by message', async () => {
    const sendMessage = stubSendMessage(Promise.resolve({ isDone: true }));
    expect(showCaptureToast({ ...MODEL, report: REPORT })).toBe(true);
    press('Backspace');
    await flush();
    expect(sendMessage).toHaveBeenCalledWith({
      ...REPORT,
      outcome: { kind: 'undo' },
    });
    expect(messageText(shadowRoot())).toBe('Removed from Inbox');
  });

  it('removes quietly after a confirmed decision with nothing to say', async () => {
    stubSendMessage(Promise.resolve({ isDone: true }));
    showCaptureToast({ ...MODEL, mode: 'duplicate', report: REPORT });
    press('Enter');
    await flush();
    await vi.advanceTimersByTimeAsync(EXIT_MS);
    expect(host()).toBeNull();
  });

  it('says it failed when the worker did not write', async () => {
    stubSendMessage(Promise.resolve({ isDone: false }));
    showCaptureToast({ ...MODEL, report: REPORT });
    press('Backspace');
    await flush();
    expect(messageText(shadowRoot())).toBe('Could not save');
  });

  it('says it failed when the message itself fails', async () => {
    stubSendMessage(Promise.reject(new Error('worker gone')));
    showCaptureToast({ ...MODEL, report: REPORT });
    press('Backspace');
    await flush();
    expect(messageText(shadowRoot())).toBe('Could not save');
  });

  it('does not report a timeout', async () => {
    const sendMessage = stubSendMessage(Promise.resolve({ isDone: true }));
    showCaptureToast({ ...MODEL, report: REPORT });
    await vi.advanceTimersByTimeAsync(DURATION_MS);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('toastStylesheet', () => {
  it('scopes tokens to the shadow host and appends the toast styles', () => {
    expect(toastStylesheet(':root { --a: 1 }', '.toast {}')).toBe(
      ':host { --a: 1 }\n.toast {}',
    );
  });
});
