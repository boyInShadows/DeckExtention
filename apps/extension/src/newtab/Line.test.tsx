// @vitest-environment happy-dom
import { SETTINGS_DEFAULTS, type Card, type Settings } from 'deck-schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { panelStrings as strings } from '../i18n/panelStrings';
import {
  click,
  keyDown,
  render,
  type,
  type RenderResult,
} from '../testing/render';
import type { SurfaceData } from './bootstrap';
import { Line } from './Line';

const lineActions = vi.hoisted(() => ({
  executeAction: vi.fn<(id: string, context: unknown) => Promise<void>>(),
  searchWeb:
    vi.fn<
      (query: string, settings: unknown, saveSettings: unknown) => Promise<void>
    >(),
}));
vi.mock('./lineActions', () => lineActions);

const upsertCard = vi.fn((value: Card) => Promise.resolve(value));
const REPOSITORY = { upsertCard } as unknown as SurfaceData['repository'];

function card(id: string, title: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    deckId: 'deck_a',
    url: `https://${id}.example/`,
    title,
    hostname: `${id}.example`,
    order: 'a0',
    pinned: false,
    lastOpenedAt: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  };
}

const CARDS = [
  card('alpha', 'Alpha docs'),
  card('beta', 'Alpha beta'),
  card('gone', 'Alpha gone', { deletedAt: 5 }),
];

function setup(settings: Settings = SETTINGS_DEFAULTS, cards = CARDS) {
  const props = {
    cards,
    settings,
    repository: REPOSITORY,
    openSettings: vi.fn<() => void>(),
    saveSettings: vi.fn<(next: Settings) => Promise<void>>(() =>
      Promise.resolve(),
    ),
    notify: vi.fn<(message: string) => void>(),
    notifyInfo: vi.fn<(message: string) => void>(),
    notifySuccess: vi.fn<(message: string) => void>(),
    notifyNotice: vi.fn(),
    canSpaceOpenDrawer: settings.canSpaceOpenDrawer,
    openDrawer: vi.fn<() => void>(),
    openHelp: vi.fn<() => void>(),
  };
  return { props, render: () => render(<Line {...props} />) };
}

function input(view: RenderResult): HTMLInputElement {
  return view.get<HTMLInputElement>('input');
}

async function typeQuery(view: RenderResult, value: string): Promise<void> {
  await view.act(() => type(input(view), value));
  await vi.waitFor(() =>
    expect(view.query('[data-deck="line-results"]')).not.toBeNull(),
  );
}

async function press(
  view: RenderResult,
  key: string,
  init: KeyboardEventInit = {},
): Promise<KeyboardEvent> {
  let event: KeyboardEvent | undefined;
  await view.act(() => {
    event = keyDown(input(view), key, init);
  });
  if (!event) throw new Error('No key event dispatched');
  return event;
}

function activeText(view: RenderResult): string | undefined {
  return view.query('[data-active] span')?.textContent ?? undefined;
}

beforeEach(() => {
  upsertCard.mockClear();
  lineActions.executeAction.mockReset().mockResolvedValue(undefined);
  lineActions.searchWeb.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('Line results', () => {
  it('rotates the empty placeholder only while unfocused', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const view = await setup().render();
      expect(input(view).placeholder).toBe(strings.linePlaceholder);
      await view.act(() => {
        vi.advanceTimersByTime(6_000);
      });
      expect(input(view).placeholder).toBe(strings.lineKeyboardHint);
      await view.act(() => {
        input(view).focus();
      });
      expect(input(view).placeholder).toBe(strings.linePlaceholder);
      await view.act(() => {
        vi.advanceTimersByTime(6_000);
      });
      expect(input(view).placeholder).toBe(strings.linePlaceholder);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it('starts with no misleading example hint or results', async () => {
    const view = await setup().render();
    expect(view.query('[data-deck="example-hint"]')).toBeNull();
    expect(view.query('[data-deck="line-results"]')).toBeNull();
    view.unmount();
  });

  it('lists matching live cards and never trashed ones', async () => {
    const view = await setup().render();
    await typeQuery(view, 'alpha');
    const titles = view
      .getAll('[data-deck="card"] span')
      .map((item) => item.textContent);
    expect(titles).toEqual(['Alpha docs', 'Alpha beta']);
    expect(view.get('[data-deck="card"]').tagName).toBe('BUTTON');
    expect(activeText(view)).toBe('Alpha docs');
    view.unmount();
  });

  it('explains how to search the web without searching a plain query', async () => {
    const view = await setup().render();
    await typeQuery(view, 'weather tomorrow');
    expect(view.container.textContent).toContain(strings.noResults);
    expect(view.query('[data-deck="card"]')).toBeNull();
    await press(view, 'Enter');
    expect(lineActions.searchWeb).not.toHaveBeenCalled();
    view.unmount();
  });

  it('lists commands for > and matches a command with trailing words', async () => {
    const view = await setup().render();
    await typeQuery(view, '>theme');
    expect(view.container.textContent).toContain(strings.actionsGroup);
    expect(view.getAll('.deck-result')).toHaveLength(3);

    await typeQuery(view, '>blur now');
    expect(view.getAll('.deck-result')).toHaveLength(1);
    expect(activeText(view)).toBe('>blur');
    view.unmount();
  });

  it('offers a web search for ?', async () => {
    const view = await setup().render();
    await typeQuery(view, '?weather');
    expect(view.container.textContent).toContain(strings.searchWeb);
    expect(view.container.textContent).not.toContain(strings.cardsGroup);
    await view.act(() => click(view.get('[data-deck="web-search-result"]')));
    await vi.waitFor(() =>
      expect(lineActions.searchWeb).toHaveBeenCalledWith(
        'weather',
        SETTINGS_DEFAULTS,
        expect.any(Function),
      ),
    );
    view.unmount();
  });

  it('caps each group and shows how many results remain', async () => {
    const fixture = Array.from({ length: 20 }, (_, index) =>
      card(`match_${index}`, `Match ${index}`),
    );
    const view = await setup(SETTINGS_DEFAULTS, fixture).render();
    await typeQuery(view, 'match');
    expect(view.getAll('[data-deck="card"]')).toHaveLength(8);
    expect(view.get('[data-deck="result-more"]').textContent).toBe(
      'and 12 more…',
    );
    view.unmount();
  });

  it('opens a typed hostname and executes an action row by mouse', async () => {
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => undefined);
    const { props, render: mount } = setup();
    const view = await mount();
    await typeQuery(view, 'foo.com');
    expect(view.get('[data-deck="url-result"]').textContent).toContain(
      'https://foo.com/',
    );
    await press(view, 'Enter');
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://foo.com/'),
    );
    await typeQuery(view, '>settings');
    await view.act(() => click(view.get('[data-deck="action-result"]')));
    await vi.waitFor(() =>
      expect(lineActions.executeAction).toHaveBeenCalledWith(
        'settings',
        expect.objectContaining({ openSettings: props.openSettings }),
      ),
    );
    expect(input(view).value).toBe('');
    view.unmount();
  });
});

describe('Line keyboard selection', () => {
  it('cycles Cards and Notes by Tab, with arrows inside the chosen group', async () => {
    const fixture = [
      card('note', 'Alpha docs', { note: 'Alpha note details' }),
      card('other', 'Alpha beta'),
    ];
    const view = await setup(SETTINGS_DEFAULTS, fixture).render();
    await typeQuery(view, 'alpha');
    expect(view.getAll('[data-deck="line-group"]')).toHaveLength(2);
    await press(view, 'Tab');
    expect(activeText(view)).toBe('Alpha docs');
    expect(view.get('[data-deck="note-result"] small').textContent).toContain(
      'Alpha note',
    );
    await press(view, 'Tab');
    expect(activeText(view)).toBe('Alpha docs');
    view.unmount();
  });
  it('moves the selection with arrows and Tab, wrapping both ways', async () => {
    const view = await setup().render();
    await typeQuery(view, 'alpha');

    expect((await press(view, 'ArrowDown')).defaultPrevented).toBe(true);
    expect(activeText(view)).toBe('Alpha beta');
    await press(view, 'ArrowDown');
    expect(activeText(view)).toBe('Alpha docs');
    expect((await press(view, 'ArrowUp')).defaultPrevented).toBe(true);
    expect(activeText(view)).toBe('Alpha beta');
    expect((await press(view, 'Tab')).defaultPrevented).toBe(true);
    expect(activeText(view)).toBe('Alpha docs');
    view.unmount();
  });

  it('keeps arrows harmless and lets Tab leave when nothing is listed', async () => {
    const view = await setup().render();
    await typeQuery(view, 'zzz');
    expect((await press(view, 'ArrowDown')).defaultPrevented).toBe(true);
    expect((await press(view, 'ArrowUp')).defaultPrevented).toBe(true);
    expect((await press(view, 'Tab')).defaultPrevented).toBe(false);
    expect(view.query('[data-active]')).toBeNull();
    view.unmount();
  });

  it('resets the selection when the query changes', async () => {
    const view = await setup().render();
    await typeQuery(view, 'alpha');
    await press(view, 'ArrowDown');
    await typeQuery(view, 'alpha ');
    expect(activeText(view)).toBe('Alpha docs');
    view.unmount();
  });
});

describe('Line space-to-drawer', () => {
  it('opens the drawer on Space in an empty Line', async () => {
    const { props, render: mount } = setup();
    const view = await mount();
    expect((await press(view, ' ')).defaultPrevented).toBe(true);
    expect(props.openDrawer).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('types a space normally once the Line has text', async () => {
    const { props, render: mount } = setup();
    const view = await mount();
    await typeQuery(view, 'a');
    expect((await press(view, ' ')).defaultPrevented).toBe(false);
    expect(props.openDrawer).not.toHaveBeenCalled();
    view.unmount();
  });

  it('respects the Settings toggle that disables Space', async () => {
    const { props, render: mount } = setup({
      ...SETTINGS_DEFAULTS,
      canSpaceOpenDrawer: false,
    });
    const view = await mount();
    await press(view, ' ');
    expect(props.openDrawer).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe('Line Enter', () => {
  it('opens the active card here, or in a new tab with Shift', async () => {
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const view = await setup().render();
    await typeQuery(view, 'alpha');
    await press(view, 'ArrowDown');

    expect((await press(view, 'Enter')).defaultPrevented).toBe(true);
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://beta.example/'),
    );
    await press(view, 'Enter', { shiftKey: true });
    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        'https://beta.example/',
        '_blank',
        'noopener',
      ),
    );
    expect(upsertCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'beta', lastOpenedAt: expect.any(Number) }),
    );
    view.unmount();
  });

  it('does nothing when there is no card to open', async () => {
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => undefined);
    const { props, render: mount } = setup();
    const view = await mount();
    await press(view, 'Enter');
    await typeQuery(view, 'zzz');
    await press(view, 'Enter');
    expect(assign).not.toHaveBeenCalled();
    expect(props.notify).not.toHaveBeenCalled();
    view.unmount();
  });

  it('runs the selected command with the Line context', async () => {
    const { props, render: mount } = setup();
    const view = await mount();
    await typeQuery(view, '>theme');
    await press(view, 'ArrowDown');
    await press(view, 'Enter');
    await vi.waitFor(() =>
      expect(lineActions.executeAction).toHaveBeenCalledWith('theme-day', {
        settings: props.settings,
        repository: REPOSITORY,
        saveSettings: props.saveSettings,
        openSettings: props.openSettings,
        notify: props.notifyInfo,
        notifySuccess: props.notifySuccess,
        notifyNotice: props.notifyNotice,
      }),
    );
    expect(view.get<HTMLInputElement>('[data-deck="line"] input').value).toBe(
      '',
    );
    view.unmount();
  });

  it('reports a failed command through notify', async () => {
    lineActions.executeAction.mockRejectedValue(new Error('disk full'));
    const { props, render: mount } = setup();
    const view = await mount();
    await typeQuery(view, '>blur');
    await press(view, 'Enter');
    await vi.waitFor(() =>
      expect(props.notify).toHaveBeenCalledWith(
        `${strings.updateFailed} disk full`,
      ),
    );
    view.unmount();
  });

  it('reports a non-Error failure too', async () => {
    lineActions.searchWeb.mockRejectedValue('denied');
    const { props, render: mount } = setup();
    const view = await mount();
    await typeQuery(view, '?cats');
    await press(view, 'Enter');
    await vi.waitFor(() =>
      expect(props.notify).toHaveBeenCalledWith(
        `${strings.updateFailed} denied`,
      ),
    );
    view.unmount();
  });

  it('searches the web for ? with a trimmed term', async () => {
    const { props, render: mount } = setup();
    const view = await mount();
    await typeQuery(view, '?  cats  ');
    await press(view, 'Enter');
    await vi.waitFor(() =>
      expect(lineActions.searchWeb).toHaveBeenCalledWith(
        'cats',
        props.settings,
        props.saveSettings,
      ),
    );
    expect(props.openHelp).not.toHaveBeenCalled();
    view.unmount();
  });

  it('opens help for a bare ?', async () => {
    const { props, render: mount } = setup();
    const view = await mount();
    await typeQuery(view, '?');
    await press(view, 'Enter');
    expect(props.openHelp).toHaveBeenCalledTimes(1);
    expect(lineActions.searchWeb).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe('Line focus keys', () => {
  it('focuses the Line on / from the page, but not from another input', async () => {
    const view = await setup().render();
    const other = document.createElement('textarea');
    document.body.append(other);

    const fromInput = keyDown(other, '/');
    expect(fromInput.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(input(view));

    const fromPage = keyDown(document.body, '/');
    expect(fromPage.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input(view));
    view.unmount();
  });

  it('uses a rebound focus key instead of /', async () => {
    const view = await setup({
      ...SETTINGS_DEFAULTS,
      keymap: [{ action: 'focusLine', chord: 'l' }],
    }).render();
    expect(keyDown(document.body, '/').defaultPrevented).toBe(false);
    keyDown(document.body, 'l');
    expect(document.activeElement).toBe(input(view));
    view.unmount();
  });

  it('clears and leaves the Line on Escape, only while it is focused', async () => {
    const view = await setup().render();
    await typeQuery(view, 'alpha');
    await view.act(() => {
      keyDown(document.body, 'Escape');
    });
    expect(input(view).value).toBe('alpha');

    input(view).focus();
    await press(view, 'Escape');
    expect(input(view).value).toBe('');
    expect(document.activeElement).not.toBe(input(view));
    expect(view.query('[data-deck="line-results"]')).toBeNull();
    view.unmount();
  });
});
