// @vitest-environment happy-dom
import { SETTINGS_DEFAULTS } from 'deck-schema';
import { render as renderImmediately, type ComponentChildren } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { strings } from '../i18n/strings';
import { keyDown, render } from '../testing/render';
import type { SurfaceData } from './bootstrap';
import { Surface } from './Surface';

/*
 * Its own file because the drawer chunk must fail to load here, while
 * Surface.test.tsx needs it to load. Pins and the dnd-kit provider are
 * passed through for the same reason as there.
 */
vi.mock('../drawer/drawer', () => {
  throw new Error('chunk missing');
});
vi.mock('./Pins', () => ({ Pins: () => null }));
vi.mock('../resurface/Resurface', () => ({
  get default() {
    throw new Error('Resurface chunk missing');
  },
}));
vi.mock('../shelf/Shelf', () => ({
  get default() {
    throw new Error('Shelf chunk missing');
  },
}));
vi.mock('../drawer/WorkspaceDnd', () => ({ WorkspaceDnd: PassThrough }));

function PassThrough({ children }: { children: ComponentChildren }) {
  return <>{children}</>;
}

const callbacks: (() => void)[] = [];

beforeEach(() => {
  callbacks.length = 0;
  const schedule = (callback: () => void) => callbacks.push(callback);
  vi.stubGlobal('requestAnimationFrame', schedule);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('requestIdleCallback', schedule);
  vi.stubGlobal('cancelIdleCallback', vi.fn());
  vi.stubGlobal('chrome', {
    tabs: { getCurrent: () => Promise.resolve({ id: 7 }) },
    storage: { local: { get: () => Promise.resolve({}), remove: vi.fn() } },
    runtime: {
      sendMessage: vi.fn(() => Promise.resolve({ error: null })),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  performance.mark('deck-start');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  delete document.documentElement.dataset.deckReady;
  performance.clearMarks();
  performance.clearMeasures();
});

it('accepts the focus shortcut on its first ready frame before passive effects', () => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  const container = document.createElement('div');
  document.body.append(container);
  const data: SurfaceData = {
    cards: [],
    decks: [],
    pages: [],
    defaultDeckId: 'deck_a',
    settings: SETTINGS_DEFAULTS,
    repository: { getRecoveryIssueCount: () => 0 } as SurfaceData['repository'],
  };
  try {
    renderImmediately(<Surface initialData={data} />, container);
    expect(document.documentElement.dataset.deckReady).toBeUndefined();
    for (const callback of callbacks.splice(0)) callback();
    expect(document.documentElement.dataset.deckReady).toBe('true');
    keyDown(window, '/');
    expect(document.activeElement).toBe(container.querySelector('input'));
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  } finally {
    renderImmediately(null, container);
    container.remove();
  }
});

describe('Surface drawer preload failure', () => {
  it('keeps the surface usable and reports missing drawer, Resurface and Shelf chunks', async () => {
    const data: SurfaceData = {
      cards: [],
      decks: [],
      pages: [],
      defaultDeckId: 'deck_a',
      settings: { ...SETTINGS_DEFAULTS, showShelf: true },
      repository: {
        getRecoveryIssueCount: () => 0,
      } as SurfaceData['repository'],
    };
    const view = await render(<Surface initialData={data} />);
    // Two rounds: the frame schedules the idle callback, which preloads.
    for (let round = 0; round < 2; round += 1) {
      await view.act(() => {
        for (const callback of callbacks.splice(0)) callback();
      });
    }
    await vi.waitFor(async () => {
      await view.act(async () => {
        await vi.dynamicImportSettled();
      });
      const notices = view.getAll('[data-deck="toast"][data-kind="error"]');
      expect(notices).toHaveLength(3);
      const errors = notices.map((item) => item.textContent).join(' ');
      expect(errors).toContain(strings.updateFailed);
      expect(errors).toContain('Resurface chunk missing');
      expect(errors).toContain('Shelf chunk missing');
      expect(view.query('[data-deck="line"]')).not.toBeNull();
    });
    view.unmount();
  });
});
