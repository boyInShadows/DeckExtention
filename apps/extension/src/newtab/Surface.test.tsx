// @vitest-environment happy-dom
import {
  CAPTURE_NOTICE_KEY,
  SETTINGS_DEFAULTS,
  type Card,
  type Deck,
  type KeyBinding,
  type Page,
  type Settings,
} from 'deck-schema';
import type { ComponentChildren } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { strings } from '../i18n/strings';
import {
  click,
  keyDown,
  render,
  type,
  type RenderResult,
} from '../testing/render';
import type { SurfaceData } from './bootstrap';
import { Surface } from './Surface';

/*
 * The lazy chunks and Pins are other components' concerns; these stand-ins
 * expose exactly the callbacks Surface hands them, so the tests can drive
 * Surface the way those components would.
 */
vi.mock('./Pins', () => ({ Pins: StubPins }));
vi.mock('./SettingsPanel', () => ({ default: StubSettings }));
vi.mock('./HelpOverlay', () => ({ default: StubHelp }));
vi.mock('../drawer/drawer', () => ({ default: StubDrawer }));
/*
 * dnd-kit is externalised by Vitest, so it resolves the real `react` instead
 * of the Preact alias and cannot render here. The context provider adds no
 * surface behaviour, so it is passed through.
 */
vi.mock('../drawer/WorkspaceDnd', () => ({ WorkspaceDnd: StubDnd }));

const DRAWER_EXIT_MS = 320;
const CLOCK_TICK_MS = 1_000;
const MORNING = new Date(2026, 0, 2, 9, 0, 0);
const EVENING = new Date(2026, 0, 2, 20, 0, 0);
const BRIGHT_LUMINANCE = 0.5;
const DIM_PERCENT = 40;
const WALLPAPER_URL = 'blob:wallpaper-1';

function StubDnd({ children }: { children: ComponentChildren }) {
  return <>{children}</>;
}

function StubPins({
  cards,
  onCardsChange,
}: {
  cards: Card[];
  onCardsChange: (cards: Card[]) => void;
}) {
  return (
    <div data-deck="pins-stub" data-count={cards.length}>
      <button type="button" onClick={() => onCardsChange([])}>
        clear pins
      </button>
    </div>
  );
}

function StubSettings({
  settings,
  onChange,
  onDataChange,
  onClose,
}: {
  settings: Settings;
  onChange: (next: Settings) => Promise<void>;
  onDataChange: () => void;
  onClose: () => void;
}) {
  return (
    <div data-deck="settings-stub">
      <button
        type="button"
        onClick={() => void onChange({ ...settings, ownerName: 'Ada' })}
      >
        rename
      </button>
      <button type="button" onClick={onDataChange}>
        reload
      </button>
      <button type="button" onClick={onClose}>
        close settings
      </button>
    </div>
  );
}

function StubHelp({
  keymapOverrides,
  onClose,
}: {
  keymapOverrides: readonly KeyBinding[];
  onClose: () => void;
}) {
  return (
    <div data-deck="help-stub" data-keys={keymapOverrides.length}>
      <button type="button" onClick={onClose}>
        close help
      </button>
    </div>
  );
}

function StubDrawer(props: {
  isOpen: boolean;
  cards: Card[];
  decks: Deck[];
  pages: Page[];
  onClose: () => void;
  onError: (message: string) => void;
  onCardsChange: (cards: Card[]) => void;
}) {
  return (
    <div
      data-deck="drawer-stub"
      data-open={String(props.isOpen)}
      data-shape={`${props.pages.length}/${props.decks.length}/${props.cards.length}`}
    >
      <button type="button" onClick={props.onClose}>
        close drawer
      </button>
      <button type="button" onClick={() => props.onError('drawer says no')}>
        fail drawer
      </button>
      <input data-deck="drawer-input" />
    </div>
  );
}

// ---------------------------------------------------------------- fixtures

function makeCard(id: string): Card {
  return {
    id,
    deckId: 'deck_a',
    url: `https://${id}.example/`,
    title: id,
    hostname: `${id}.example`,
    order: 'a0',
    pinned: true,
    lastOpenedAt: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  };
}

const PAGE: Page = {
  id: 'page_a',
  title: 'Page',
  order: 'a0',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

const DECK: Deck = {
  id: 'deck_a',
  pageId: PAGE.id,
  title: 'Deck',
  kind: 'normal',
  order: 'a0',
  color: null,
  isCollapsed: false,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

function fakeRepository() {
  return {
    setSettings: vi.fn((next: Settings) => Promise.resolve(next)),
    listPages: vi.fn(() => Promise.resolve([PAGE])),
    listDecks: vi.fn(() => Promise.resolve([DECK])),
    listCards: vi.fn(() =>
      Promise.resolve([makeCard('a'), makeCard('b'), makeCard('c')]),
    ),
    getWallpaperBlob: vi.fn((): Promise<Blob | null> =>
      Promise.resolve(new Blob(['x'])),
    ),
  };
}

type FakeRepository = ReturnType<typeof fakeRepository>;

function surfaceData(
  settings: Partial<Settings> = {},
  repository: FakeRepository = fakeRepository(),
): SurfaceData {
  return {
    cards: [makeCard('a')],
    decks: [],
    pages: [],
    defaultDeckId: DECK.id,
    settings: { ...SETTINGS_DEFAULTS, ...settings },
    repository: repository as unknown as SurfaceData['repository'],
  };
}

// ---------------------------------------------------- browser stand-ins

const frames = new Map<number, FrameRequestCallback>();
const idles = new Map<number, IdleRequestCallback>();
let nextHandle = 1;
let messageListeners: ((message: unknown) => void)[] = [];
let storageGet = vi.fn(() => Promise.resolve<Record<string, unknown>>({}));
const storageRemove = vi.fn(() => Promise.resolve());
const cancelIdle = vi.fn((handle: number) => idles.delete(handle));
const cancelFrame = vi.fn((handle: number) => frames.delete(handle));

function stubBrowser(): void {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(nextHandle, callback);
    return nextHandle++;
  });
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
    idles.set(nextHandle, callback);
    return nextHandle++;
  });
  vi.stubGlobal('cancelIdleCallback', cancelIdle);
  vi.stubGlobal('chrome', {
    storage: { local: { get: storageGet, remove: storageRemove } },
    runtime: {
      onMessage: {
        addListener: (listener: (message: unknown) => void) => {
          messageListeners = [...messageListeners, listener];
        },
        removeListener: (listener: (message: unknown) => void) => {
          messageListeners = messageListeners.filter(
            (item) => item !== listener,
          );
        },
      },
    },
  });
}

async function flushFrames(view: RenderResult): Promise<void> {
  await view.act(() => {
    const pending = [...frames.entries()];
    frames.clear();
    for (const [, callback] of pending) callback(0);
  });
}

async function flushIdle(view: RenderResult): Promise<void> {
  await view.act(async () => {
    const pending = [...idles.values()];
    idles.clear();
    for (const callback of pending)
      callback({ didTimeout: false, timeRemaining: () => 0 });
    await vi.dynamicImportSettled();
  });
}

/** Lets promises and lazy chunks resolve, then flushes Preact. */
async function settle(view: RenderResult): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await view.act(async () => {
      await vi.dynamicImportSettled();
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    });
  }
}

async function mount(data: SurfaceData): Promise<RenderResult> {
  const view = await render(<Surface initialData={data} />);
  await settle(view);
  return view;
}

function surface(view: RenderResult): HTMLElement {
  return view.get('[data-deck="surface"]');
}

function alertText(view: RenderResult): string | null {
  return view.query('[data-deck="error"]')?.textContent ?? null;
}

async function press(
  view: RenderResult,
  target: EventTarget,
  key: string,
  init: KeyboardEventInit = {},
): Promise<KeyboardEvent> {
  let event: KeyboardEvent | undefined;
  await view.act(() => {
    event = keyDown(target, key, init);
  });
  if (!event) throw new Error('No key event dispatched');
  await settle(view);
  return event;
}

async function clickOn(view: RenderResult, element: Element): Promise<void> {
  await view.act(() => click(element));
  await settle(view);
}

beforeEach(() => {
  frames.clear();
  idles.clear();
  messageListeners = [];
  storageGet = vi.fn(() => Promise.resolve<Record<string, unknown>>({}));
  storageRemove.mockClear();
  cancelIdle.mockClear();
  cancelFrame.mockClear();
  stubBrowser();
  performance.clearMarks();
  performance.clearMeasures();
  performance.mark('deck-start');
  history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.body.style.backgroundImage = '';
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.deckReady;
});

describe('Surface first paint', () => {
  it('paints the calm surface with no greeting, drawer or alert', async () => {
    const view = await mount(surfaceData());
    const main = surface(view);
    expect(main.dataset.wallpaperKind).toBe('none');
    expect(main.hasAttribute('data-blurred')).toBe(false);
    expect(main.hasAttribute('data-bright-wallpaper')).toBe(false);
    expect(main.hasAttribute('data-drawer-open')).toBe(false);
    expect(main.style.getPropertyValue('--deck-wallpaper-image')).toBe('none');
    expect(main.style.getPropertyValue('--deck-wallpaper-gradient')).toBe(
      'none',
    );
    expect(view.query('[data-deck="greeting"]')).toBeNull();
    expect(view.query('[data-deck="drawer-stub"]')).toBeNull();
    expect(alertText(view)).toBeNull();
    expect(view.get('[data-deck="pins-stub"]').dataset.count).toBe('1');
    view.unmount();
  });

  it('greets the owner by name and applies the stored look', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(MORNING);
    const view = await mount(
      surfaceData({
        ownerName: 'Ada',
        isBlurred: true,
        wallpaperLuminance: BRIGHT_LUMINANCE,
        wallpaperDim: DIM_PERCENT,
        wallpaperGradient: 'linear-gradient(red, blue)',
        customCss: '[data-deck="clock"] { color: red; }',
      }),
    );
    const main = surface(view);
    expect(view.get('[data-deck="greeting"]').textContent).toBe(
      `${strings.greetingMorning}, Ada`,
    );
    expect(main.dataset.blurred).toBe('true');
    expect(main.dataset.brightWallpaper).toBe('true');
    expect(main.style.getPropertyValue('--deck-wallpaper-dim')).toBe('0.4');
    expect(main.style.getPropertyValue('--deck-wallpaper-gradient')).toBe(
      'linear-gradient(red, blue)',
    );
    expect(view.get('[data-deck="custom-css"]').textContent).toContain(
      'color: red',
    );
    expect(
      view.get('[data-deck="blur-toggle"]').getAttribute('aria-pressed'),
    ).toBe('true');
    view.unmount();
  });

  it('ticks the clock every second, with seconds when asked', async () => {
    vi.useFakeTimers({
      toFake: ['Date', 'setInterval', 'clearInterval'],
    });
    vi.setSystemTime(EVENING);
    const view = await mount(surfaceData({ showSeconds: true }));
    const clock = view.get('[data-deck="clock"]');
    expect(clock.textContent).toContain('20:00:00');
    await view.act(() => {
      vi.advanceTimersByTime(CLOCK_TICK_MS);
    });
    expect(clock.textContent).toContain('20:00:01');
    expect(clock.getAttribute('datetime')).toBe(
      new Date(EVENING.getTime() + CLOCK_TICK_MS).toISOString(),
    );
    view.unmount();
  });

  it('marks deck-ready once, on the first frame of the first surface', async () => {
    const first = await mount(surfaceData());
    expect(document.documentElement.dataset.deckReady).toBeUndefined();
    await flushFrames(first);
    expect(document.documentElement.dataset.deckReady).toBe('true');
    first.unmount();

    const second = await mount(surfaceData());
    await flushFrames(second);
    expect(performance.getEntriesByName('deck-ready')).toHaveLength(1);
    expect(performance.getEntriesByName('deck-interactive')).toHaveLength(1);
    second.unmount();
  });
});

describe('Surface hand-over from Quick Save', () => {
  it('shows a stored capture notice once and clears it', async () => {
    storageGet = vi.fn(() =>
      Promise.resolve<Record<string, unknown>>({
        [CAPTURE_NOTICE_KEY]: {
          message: 'Could not show the toast',
          createdAt: 1,
        },
      }),
    );
    stubBrowser();
    const view = await mount(surfaceData());
    expect(storageGet).toHaveBeenCalledWith(CAPTURE_NOTICE_KEY);
    expect(alertText(view)).toBe('Could not show the toast');
    expect(storageRemove).toHaveBeenCalledWith(CAPTURE_NOTICE_KEY);
    view.unmount();
  });

  it('ignores a malformed notice', async () => {
    storageGet = vi.fn(() =>
      Promise.resolve<Record<string, unknown>>({
        [CAPTURE_NOTICE_KEY]: { message: '' },
      }),
    );
    stubBrowser();
    const view = await mount(surfaceData());
    expect(alertText(view)).toBeNull();
    expect(storageRemove).not.toHaveBeenCalled();
    view.unmount();
  });

  it('reports a storage failure instead of hiding it', async () => {
    storageGet = vi.fn(() => Promise.reject(new Error('storage gone')));
    stubBrowser();
    const view = await mount(surfaceData());
    expect(alertText(view)).toBe('Error: storage gone');
    view.unmount();
  });

  it('opens Settings for #settings and consumes the hash', async () => {
    history.replaceState(null, '', '/newtab.html#settings');
    const view = await mount(surfaceData());
    expect(view.query('[data-deck="settings-stub"]')).not.toBeNull();
    expect(location.hash).toBe('');
    expect(location.pathname).toBe('/newtab.html');
    view.unmount();
  });

  it('arrives with the drawer open for a #page= link', async () => {
    history.replaceState(null, '', '/newtab.html#page=page_a');
    const view = await mount(surfaceData());
    expect(surface(view).dataset.drawerOpen).toBe('true');
    expect(view.get('[data-deck="drawer-stub"]').dataset.open).toBe('true');
    expect(location.hash).toBe('#page=page_a');
    view.unmount();
  });
});

describe('Surface drawer', () => {
  function drawer(view: RenderResult): HTMLElement | null {
    return view.query('[data-deck="drawer-stub"]');
  }

  it('mounts from the handle, then slides open on the next frame', async () => {
    const view = await mount(surfaceData());
    await clickOn(view, view.getByLabel(strings.openDrawer));
    expect(drawer(view)?.dataset.open).toBe('false');
    expect(surface(view).dataset.drawerOpen).toBe('true');
    await flushFrames(view);
    expect(drawer(view)?.dataset.open).toBe('true');
    view.unmount();
  });

  it('closes, then unmounts once the exit animation is over', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = await mount(surfaceData());
    await clickOn(view, view.getByLabel(strings.openDrawer));
    await flushFrames(view);
    await clickOn(view, view.getByText('close drawer'));
    expect(drawer(view)?.dataset.open).toBe('false');
    await view.act(() => {
      vi.advanceTimersByTime(DRAWER_EXIT_MS);
    });
    expect(drawer(view)).toBeNull();
    expect(surface(view).hasAttribute('data-drawer-open')).toBe(false);
    view.unmount();
  });

  it('keeps the drawer when it is reopened during the exit animation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = await mount(surfaceData());
    await clickOn(view, view.getByLabel(strings.openDrawer));
    await flushFrames(view);
    await clickOn(view, view.getByText('close drawer'));
    await clickOn(view, view.getByLabel(strings.openDrawer));
    await view.act(() => {
      vi.advanceTimersByTime(DRAWER_EXIT_MS);
    });
    await flushFrames(view);
    expect(drawer(view)?.dataset.open).toBe('true');
    view.unmount();
  });

  it('leaves no exit timer behind when unmounted mid-animation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = await mount(surfaceData());
    await clickOn(view, view.getByLabel(strings.openDrawer));
    await flushFrames(view);
    await clickOn(view, view.getByText('close drawer'));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('toggles with Ctrl+J in either case, and ignores a plain j', async () => {
    const view = await mount(surfaceData());
    expect((await press(view, document.body, 'j')).defaultPrevented).toBe(
      false,
    );
    expect(drawer(view)).toBeNull();

    const open = await press(view, document.body, 'j', { ctrlKey: true });
    expect(open.defaultPrevented).toBe(true);
    await flushFrames(view);
    expect(drawer(view)?.dataset.open).toBe('true');

    await press(view, document.body, 'J', { ctrlKey: true, shiftKey: true });
    expect(drawer(view)?.dataset.open).toBe('false');
    view.unmount();
  });

  it('toggles on the background toggle message and ignores others', async () => {
    const view = await mount(surfaceData());
    const send = async (message: unknown) => {
      await view.act(() => {
        for (const listener of messageListeners) listener(message);
      });
      await settle(view);
    };
    for (const ignored of [null, 'deck:toggle-drawer', {}, { type: 'other' }])
      await send(ignored);
    expect(drawer(view)).toBeNull();

    await send({ type: 'deck:toggle-drawer' });
    await flushFrames(view);
    expect(drawer(view)?.dataset.open).toBe('true');
    view.unmount();
    expect(messageListeners).toHaveLength(0);
  });

  it('closes on Escape, but not while typing in a field', async () => {
    const view = await mount(surfaceData());
    await clickOn(view, view.getByLabel(strings.openDrawer));
    await flushFrames(view);

    await press(view, view.get('[data-deck="drawer-input"]'), 'Escape');
    await press(view, document.body, 'Enter');
    expect(drawer(view)?.dataset.open).toBe('true');

    await press(view, document.body, 'Escape');
    expect(drawer(view)?.dataset.open).toBe('false');
    view.unmount();
  });

  it('opens from Space in an empty Line and closes Settings first', async () => {
    const view = await mount(surfaceData());
    await clickOn(view, view.getByLabel(strings.settings));
    expect(view.query('[data-deck="settings-stub"]')).not.toBeNull();
    await press(view, view.get('[data-deck="line"] input'), ' ');
    expect(view.query('[data-deck="settings-stub"]')).toBeNull();
    expect(drawer(view)).not.toBeNull();
    view.unmount();
  });

  it('shares workspace changes and surfaces drawer errors', async () => {
    const view = await mount(surfaceData());
    await clickOn(view, view.getByLabel(strings.openDrawer));
    expect(drawer(view)?.dataset.shape).toBe('0/0/1');
    await clickOn(view, view.getByText('clear pins'));
    expect(drawer(view)?.dataset.shape).toBe('0/0/0');
    await clickOn(view, view.getByText('fail drawer'));
    expect(alertText(view)).toBe('drawer says no');
    view.unmount();
  });
});

describe('Surface settings and keys', () => {
  it('toggles blur from the button and saves the result', async () => {
    const repository = fakeRepository();
    const view = await mount(
      surfaceData(
        { wallpaperGradient: 'linear-gradient(red, blue)' },
        repository,
      ),
    );
    await clickOn(view, view.get('[data-deck="blur-toggle"]'));
    expect(repository.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ isBlurred: true }),
    );
    expect(surface(view).dataset.blurred).toBe('true');
    expect(document.documentElement.dataset.theme).toBe('night');
    expect(document.body.style.backgroundImage).toContain('linear-gradient');
    view.unmount();
  });

  it('toggles blur with b, or with the rebound key instead', async () => {
    const defaults = await mount(surfaceData());
    await press(defaults, document.body, 'b');
    expect(surface(defaults).dataset.blurred).toBe('true');
    defaults.unmount();

    const rebound = await mount(
      surfaceData({ keymap: [{ action: 'blur', chord: 'p' }] }),
    );
    await press(rebound, document.body, 'b');
    expect(surface(rebound).hasAttribute('data-blurred')).toBe(false);
    await press(rebound, document.body, 'p');
    expect(surface(rebound).dataset.blurred).toBe('true');
    rebound.unmount();
  });

  it('ignores surface keys with modifiers or from a text field', async () => {
    const repository = fakeRepository();
    const view = await mount(surfaceData({}, repository));
    const line = view.get<HTMLInputElement>('[data-deck="line"] input');
    await press(view, line, 'b');
    await press(view, document.body, 'b', { altKey: true });
    await press(view, document.body, 'b', { metaKey: true });
    await press(view, document.body, '?', { ctrlKey: true });
    expect(repository.setSettings).not.toHaveBeenCalled();
    expect(view.query('[data-deck="help-stub"]')).toBeNull();
    view.unmount();
  });

  it('opens help with ? and closes it again', async () => {
    const view = await mount(
      surfaceData({ keymap: [{ action: 'blur', chord: 'p' }] }),
    );
    await press(view, document.body, '?');
    expect(view.get('[data-deck="help-stub"]').dataset.keys).toBe('1');
    await clickOn(view, view.getByText('close help'));
    expect(view.query('[data-deck="help-stub"]')).toBeNull();
    view.unmount();
  });

  it('opens help from a bare ? in the Line', async () => {
    const view = await mount(surfaceData());
    const line = view.get<HTMLInputElement>('[data-deck="line"] input');
    await view.act(() => type(line, '?'));
    await press(view, line, 'Enter');
    expect(view.query('[data-deck="help-stub"]')).not.toBeNull();
    view.unmount();
  });

  it('saves from Settings, shows the result and closes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(EVENING);
    const view = await mount(surfaceData());
    await clickOn(view, view.getByLabel(strings.settings));
    await clickOn(view, view.getByText('rename'));
    expect(view.get('[data-deck="greeting"]').textContent).toBe(
      `${strings.greetingEvening}, Ada`,
    );
    await clickOn(view, view.getByText('close settings'));
    expect(view.query('[data-deck="settings-stub"]')).toBeNull();
    view.unmount();
  });

  it('opens Settings from the >settings command', async () => {
    const view = await mount(surfaceData());
    const line = view.get<HTMLInputElement>('[data-deck="line"] input');
    await view.act(() => type(line, '>settings'));
    await press(view, line, 'Enter');
    await vi.waitFor(async () => {
      await settle(view);
      expect(view.query('[data-deck="settings-stub"]')).not.toBeNull();
    });
    view.unmount();
  });

  it('reports a failed save and clears the alert after the next success', async () => {
    const repository = fakeRepository();
    repository.setSettings
      .mockRejectedValueOnce(new Error('quota exceeded'))
      .mockRejectedValueOnce('locked');
    const view = await mount(surfaceData({}, repository));
    const toggle = view.get('[data-deck="blur-toggle"]');
    await clickOn(view, toggle);
    expect(alertText(view)).toBe(`${strings.updateFailed} quota exceeded`);
    expect(surface(view).hasAttribute('data-blurred')).toBe(false);
    await clickOn(view, toggle);
    expect(alertText(view)).toBe(`${strings.updateFailed} locked`);
    await clickOn(view, toggle);
    expect(alertText(view)).toBeNull();
    expect(surface(view).dataset.blurred).toBe('true');
    view.unmount();
  });

  it('re-reads the workspace after a bulk import', async () => {
    const repository = fakeRepository();
    const view = await mount(surfaceData({}, repository));
    await clickOn(view, view.getByLabel(strings.settings));
    await clickOn(view, view.getByText('reload'));
    expect(view.get('[data-deck="pins-stub"]').dataset.count).toBe('3');
    await clickOn(view, view.getByLabel(strings.openDrawer));
    expect(view.get('[data-deck="drawer-stub"]').dataset.shape).toBe('1/1/3');
    view.unmount();
  });

  it('reports a workspace that cannot be re-read', async () => {
    const repository = fakeRepository();
    repository.listDecks
      .mockRejectedValueOnce(new Error('db closed'))
      .mockRejectedValueOnce('db locked');
    const view = await mount(surfaceData({}, repository));
    await clickOn(view, view.getByLabel(strings.settings));
    await clickOn(view, view.getByText('reload'));
    expect(alertText(view)).toBe(`${strings.updateFailed} db closed`);
    await clickOn(view, view.getByText('reload'));
    expect(alertText(view)).toBe(`${strings.updateFailed} db locked`);
    expect(view.get('[data-deck="pins-stub"]').dataset.count).toBe('1');
    view.unmount();
  });
});

describe('Surface drawer preload', () => {
  it('preloads the drawer chunk when idle without reporting anything', async () => {
    const view = await mount(surfaceData());
    expect(idles.size).toBe(0);
    await flushFrames(view);
    expect(idles.size).toBe(1);
    await flushIdle(view);
    await settle(view);
    expect(alertText(view)).toBeNull();
    view.unmount();
  });

  it('cancels a pending idle preload on unmount', async () => {
    const view = await mount(surfaceData());
    await flushFrames(view);
    const [handle] = [...idles.keys()];
    view.unmount();
    expect(cancelIdle).toHaveBeenCalledWith(handle);
  });

  it('cancels the preload frame when unmounted before it runs', async () => {
    const view = await mount(surfaceData());
    view.unmount();
    expect(cancelFrame).toHaveBeenCalled();
    expect(cancelIdle).not.toHaveBeenCalled();
  });
});

describe('Surface wallpaper', () => {
  interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
  }

  function deferred<T>(): Deferred<T> {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((settleWith) => {
      resolve = settleWith;
    });
    return { promise, resolve };
  }

  let decodeResult: () => Promise<void> = () => Promise.resolve();
  let urlCount = 0;

  beforeEach(() => {
    decodeResult = () => Promise.resolve();
    urlCount = 0;
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        decode(): Promise<void> {
          return decodeResult();
        }
      },
    );
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      urlCount += 1;
      return urlCount === 1 ? WALLPAPER_URL : `blob:wallpaper-${urlCount}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  const FILE_WALLPAPER = { kind: 'file', blobKey: 'wp1' } as const;

  function wallpaper(view: RenderResult): HTMLElement {
    return view.get('[data-deck="wallpaper"]');
  }

  it('fades in a decoded file wallpaper and frees it on unmount', async () => {
    const repository = fakeRepository();
    const view = await mount(
      surfaceData({ wallpaper: FILE_WALLPAPER }, repository),
    );
    expect(repository.getWallpaperBlob).toHaveBeenCalledWith('wp1');
    expect(wallpaper(view).dataset.loaded).toBe('true');
    expect(surface(view).style.getPropertyValue('--deck-wallpaper-image')).toBe(
      `url("${WALLPAPER_URL}")`,
    );
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(WALLPAPER_URL);
  });

  it('keeps the gradient when the stored image is missing', async () => {
    const repository = fakeRepository();
    repository.getWallpaperBlob.mockResolvedValue(null);
    const view = await mount(
      surfaceData({ wallpaper: FILE_WALLPAPER }, repository),
    );
    expect(wallpaper(view).hasAttribute('data-loaded')).toBe(false);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(alertText(view)).toBeNull();
    view.unmount();
  });

  it('does not read a blob that arrives after the surface is gone', async () => {
    const repository = fakeRepository();
    const pending = deferred<Blob | null>();
    repository.getWallpaperBlob.mockReturnValue(pending.promise);
    const view = await mount(
      surfaceData({ wallpaper: FILE_WALLPAPER }, repository),
    );
    view.unmount();
    pending.resolve(new Blob(['late']));
    await pending.promise;
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('frees an image that finishes decoding after the surface is gone', async () => {
    const decoding = deferred<undefined>();
    decodeResult = () => decoding.promise;
    const view = await mount(surfaceData({ wallpaper: FILE_WALLPAPER }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(WALLPAPER_URL);
    decoding.resolve(undefined);
    await decoding.promise;
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(view.container.isConnected).toBe(false);
  });

  it('reports an image that cannot be decoded', async () => {
    decodeResult = () => Promise.reject(new Error('bad image'));
    const view = await mount(surfaceData({ wallpaper: FILE_WALLPAPER }));
    expect(alertText(view)).toBe(`${strings.updateFailed} bad image`);
    expect(wallpaper(view).hasAttribute('data-loaded')).toBe(false);
    view.unmount();
  });

  it('reports a non-Error storage failure as text', async () => {
    const repository = fakeRepository();
    repository.getWallpaperBlob.mockRejectedValue('meta store missing');
    const view = await mount(
      surfaceData({ wallpaper: FILE_WALLPAPER }, repository),
    );
    expect(alertText(view)).toBe(`${strings.updateFailed} meta store missing`);
    view.unmount();
  });

  it('drops the old image as soon as a different wallpaper is chosen', async () => {
    const repository = fakeRepository();
    const next = deferred<Blob | null>();
    repository.getWallpaperBlob
      .mockResolvedValueOnce(new Blob(['one']))
      .mockReturnValueOnce(next.promise);
    const settings = { ...SETTINGS_DEFAULTS, wallpaper: FILE_WALLPAPER };
    const view = await mount(surfaceData(settings, repository));
    expect(wallpaper(view).dataset.loaded).toBe('true');

    repository.setSettings.mockResolvedValueOnce({
      ...settings,
      isBlurred: true,
      wallpaper: { kind: 'file', blobKey: 'wp2' },
    });
    await clickOn(view, view.get('[data-deck="blur-toggle"]'));
    // The save resolves after act; its effects wait for the next frame.
    await flushFrames(view);
    await settle(view);
    expect(repository.getWallpaperBlob).toHaveBeenLastCalledWith('wp2');
    expect(wallpaper(view).hasAttribute('data-loaded')).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(WALLPAPER_URL);
    view.unmount();
  });
});
