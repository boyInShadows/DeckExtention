// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { useState } from 'react';
import { SETTINGS_DEFAULTS, type Card } from 'deck-schema';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { panelStrings as strings } from '../i18n/panelStrings';
import { DeckRepository } from '../storage/repository';
import type { NoticeInput } from './ToastStack';
import {
  render,
  type,
  keyDown,
  click,
  type RenderResult,
} from '../testing/render';
import { Line } from './Line';

const DATABASE = 'deck-line-open-tabs-test';
let repository: DeckRepository;
let view: RenderResult | undefined;
let api: ReturnType<typeof mockChrome>;
function event() {
  const handlers = new Set<(...args: unknown[]) => void>();
  return {
    addListener: (handler: (...args: unknown[]) => void) =>
      handlers.add(handler),
    removeListener: (handler: (...args: unknown[]) => void) =>
      handlers.delete(handler),
    emit: (...args: unknown[]) =>
      handlers.forEach((handler) => handler(...args)),
  };
}
const tab = (id: number, title: string) => ({
  id,
  title,
  windowId: id === 1 ? 1 : 2,
  index: id,
  url: `https://example.com/${id}`,
});
function mockChrome() {
  return {
    runtime: { getURL: () => 'chrome-extension://deck/' },
    permissions: {
      contains: vi.fn().mockResolvedValue(true),
      request: vi.fn().mockResolvedValue(true),
      onAdded: event(),
      onRemoved: event(),
    },
    tabs: {
      getCurrent: vi.fn().mockResolvedValue({ id: 99, windowId: 1 }),
      query: vi.fn().mockResolvedValue([tab(1, 'AlphaTab'), tab(2, 'BetaTab')]),
      get: vi.fn(async (id: number) =>
        tab(id, id === 1 ? 'AlphaTab' : 'BetaTab'),
      ),
      update: vi.fn().mockResolvedValue({}),
      remove: vi.fn().mockResolvedValue(undefined),
      onCreated: event(),
      onRemoved: event(),
      onMoved: event(),
      onAttached: event(),
      onReplaced: event(),
      onUpdated: event(),
    },
    windows: { update: vi.fn().mockResolvedValue({}) },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
}
async function mount(cards: Card[] = []) {
  const props = {
    settings: SETTINGS_DEFAULTS,
    repository,
    openSettings: vi.fn(),
    openWorkspace: vi.fn(),
    prepareWorkspace: vi.fn().mockResolvedValue(true),
    openNote: vi.fn(),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn(),
    notifyInfo: vi.fn(),
    notifySuccess: vi.fn(),
    notifyNotice: vi.fn<(notice: NoticeInput) => void>(),
    canSpaceOpenDrawer: true,
    openDrawer: vi.fn(),
    openHelp: vi.fn(),
    onDataChange: vi.fn(),
  };
  function Host() {
    const [saved, setSaved] = useState(cards);
    return (
      <Line
        {...props}
        cards={saved}
        onDataChange={() => {
          props.onDataChange();
          void repository
            .listCards()
            .then(setSaved)
            .catch((error) => props.notify(String(error)));
        }}
      />
    );
  }
  view = await render(<Host />);
  return { view, props, input: view.get<HTMLInputElement>('input') };
}
async function search(result: Awaited<ReturnType<typeof mount>>, text: string) {
  await result.view.act(() => type(result.input, text));
  await vi.waitFor(async () => {
    await result.view.act(async () => {});
    expect(result.view.query('[data-deck="line-results"]')).not.toBeNull();
  });
}
async function ready(result: Awaited<ReturnType<typeof mount>>, count = 1) {
  await vi.waitFor(async () => {
    await result.view.act(async () => {});
    expect(result.view.getAll('[data-deck="tab-result"]')).toHaveLength(count);
  });
}
beforeEach(() => {
  repository = new DeckRepository({ databaseName: DATABASE });
  api = mockChrome();
  vi.stubGlobal('chrome', api);
});
afterEach(async () => {
  view?.unmount();
  view = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await repository.close();
  await deleteDB(DATABASE);
  document.body.replaceChildren();
});

it('finds one of 40 live tabs and Enter switches and focuses its window', async () => {
  api.tabs.query.mockResolvedValue(
    Array.from({ length: 40 }, (_, i) => tab(i + 1, `Research ${i + 1}`)),
  );
  api.tabs.get.mockResolvedValue(tab(40, 'Research 40'));
  const result = await mount();
  await search(result, '"research 40');
  await ready(result);
  expect(result.view.get('[data-deck="tab-result"]').textContent).toContain(
    'Window 2',
  );
  await result.view.act(() => {
    keyDown(result.input, 'Enter');
  });
  await vi.waitFor(() =>
    expect(api.windows.update).toHaveBeenCalledWith(2, { focused: true }),
  );
  expect(api.tabs.update).toHaveBeenCalledExactlyOnceWith(40, { active: true });
});

it('keeps ordinary x/s typing harmless and scopes shortcuts to a focused tab result', async () => {
  const result = await mount();
  await search(result, 'alphatab');
  await ready(result);
  await result.view.act(() => {
    keyDown(result.input, 'x');
    keyDown(result.input, 's');
  });
  expect(api.tabs.remove).not.toHaveBeenCalled();
  expect(await repository.listCards()).toEqual([]);
  await result.view.act(() => {
    keyDown(result.input, 'ArrowDown');
  });
  const row = result.view.get<HTMLButtonElement>('[data-deck="tab-activate"]');
  expect(document.activeElement).toBe(row);
  await result.view.act(() => {
    keyDown(row, 's');
  });
  await vi.waitFor(() =>
    expect(result.props.onDataChange).toHaveBeenCalledOnce(),
  );
  await ready(result);
  expect(result.view.get('[data-deck="tab-activate"][data-active]')).toBe(row);
  expect((await repository.listCards())[0]?.url).toBe('https://example.com/1');
  await result.view.act(() => {
    keyDown(row, 'x', { ctrlKey: true });
  });
  expect(api.tabs.remove).not.toHaveBeenCalled();
  api.tabs.query.mockResolvedValue([tab(2, 'BetaTab')]);
  await result.view.act(() => {
    keyDown(row, 'x');
  });
  await vi.waitFor(() =>
    expect(api.tabs.remove).toHaveBeenCalledExactlyOnceWith(1),
  );
  expect(document.activeElement).toBe(result.input);
  expect(await repository.listCards()).toHaveLength(1);
});

it('offers all four groups, focuses tabs through Tab, wraps row arrows, and Escape returns to search', async () => {
  const result = await mount([
    {
      id: 'saved_card',
      deckId: 'saved_deck',
      title: 'Tab reference',
      note: 'Tab note',
      url: 'https://saved.test/',
      hostname: 'saved.test',
      order: 'a0',
      pinned: false,
      lastOpenedAt: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    },
  ]);
  await search(result, 'tab');
  await ready(result, 2);
  expect(
    result.view
      .getAll('[data-deck="line-group"] h2')
      .map((item) => item.textContent),
  ).toEqual([
    strings.cardsGroup,
    strings.notesGroup,
    strings.actionsGroup,
    strings.openTabsGroup,
  ]);
  for (let index = 0; index < 3; index += 1)
    await result.view.act(() => {
      keyDown(result.input, 'Tab');
    });
  const rows = result.view.getAll<HTMLButtonElement>(
    '[data-deck="tab-activate"]',
  );
  expect(document.activeElement).toBe(rows[0]);
  const [first, second] = rows;
  if (!first || !second) throw new Error('Missing tab rows');
  await result.view.act(() => {
    keyDown(first, 'ArrowUp');
  });
  expect(document.activeElement).toBe(rows[1]);
  await result.view.act(() => {
    keyDown(second, 'ArrowDown');
  });
  expect(document.activeElement).toBe(rows[0]);
  await result.view.act(() => {
    keyDown(first, 'Escape');
  });
  expect(document.activeElement).toBe(result.input);
  expect(result.input.value).toBe('tab');
});

it('hides tabs without a grant, explains >tabs and shows results after the grant event', async () => {
  api.permissions.contains.mockResolvedValue(false);
  const result = await mount();
  await search(result, 'alphatab');
  expect(result.view.query('[data-deck="tab-result"]')).toBeNull();
  expect(api.tabs.query).not.toHaveBeenCalled();
  await search(result, '>tab');
  await result.view.act(() => {
    keyDown(result.input, 'Enter');
  });
  await vi.waitFor(() =>
    expect(result.props.notifyNotice).toHaveBeenCalledWith(
      expect.objectContaining({ text: strings.tabSearchPermissionReason }),
    ),
  );
  const notice = result.props.notifyNotice.mock.calls[0]?.[0];
  expect(api.permissions.request).not.toHaveBeenCalled();
  await result.view.act(async () => {
    await notice?.action?.run();
  });
  expect(api.permissions.request).toHaveBeenCalledWith({
    permissions: ['tabs'],
  });
  api.permissions.contains.mockResolvedValue(true);
  await result.view.act(() =>
    api.permissions.onAdded.emit({ permissions: ['tabs'] }),
  );
  await ready(result, 2);
  expect(result.input.value).toBe('>tabs');
  await vi.waitFor(() => expect(document.activeElement).toBe(result.input));
  expect(result.view.query('[data-deck="action-result"]')).toBeNull();
  await result.view.act(() =>
    api.permissions.onRemoved.emit({ permissions: ['tabs'] }),
  );
  expect(result.view.query('[data-deck="tab-result"]')).toBeNull();
});

it('does not flash cached tab metadata when a new search is awaiting a fresh permission check', async () => {
  const result = await mount();
  await search(result, 'alphatab');
  await ready(result);
  await search(result, '?web');
  expect(result.view.query('[data-deck="tab-result"]')).toBeNull();
  let finish: ((hasAccess: boolean) => void) | undefined;
  api.permissions.contains.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await search(result, 'alphatab');
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect(result.view.query('[data-deck="tab-result"]')).toBeNull();
  finish?.(false);
  await result.view.act(async () => {});
  expect(api.tabs.query).toHaveBeenCalledOnce();
});

it('reports stale targets and supports the visible Save/Close controls', async () => {
  const result = await mount();
  await search(result, 'alphatab');
  await ready(result);
  api.tabs.get.mockResolvedValue(tab(1, 'AlphaTab'));
  await result.view.act(() => click(result.view.get('[data-deck="tab-save"]')));
  await vi.waitFor(() =>
    expect(result.props.notifySuccess).toHaveBeenCalledWith('Saved to Inbox'),
  );
  api.tabs.get.mockResolvedValue({
    ...tab(1, 'Different'),
    url: 'https://changed.test/',
  });
  await result.view.act(() =>
    click(result.view.get('[data-deck="tab-close"]')),
  );
  await vi.waitFor(() =>
    expect(result.props.notify).toHaveBeenCalledWith(
      `${strings.updateFailed} ${strings.openTabChanged}`,
    ),
  );
  expect(api.tabs.remove).not.toHaveBeenCalled();
});

it('accepts the next activation after switching while tab metadata is still refreshing', async () => {
  const result = await mount();
  await search(result, '>tabs alphatab');
  await ready(result);
  let finishRefresh: ((tabs: ReturnType<typeof tab>[]) => void) | undefined;
  api.tabs.query.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRefresh = resolve;
      }),
  );
  try {
    await result.view.act(() => {
      keyDown(result.input, 'Enter');
    });
    await vi.waitFor(() => expect(finishRefresh).toBeDefined());
    expect(api.windows.update).toHaveBeenCalledOnce();
    await search(result, '>tabs betatab');
    await ready(result);
    await result.view.act(() => {
      keyDown(result.input, 'Enter');
    });
    await vi.waitFor(() =>
      expect(api.tabs.update).toHaveBeenCalledWith(2, { active: true }),
    );
  } finally {
    finishRefresh?.([tab(1, 'AlphaTab'), tab(2, 'BetaTab')]);
    await result.view.act(async () => {});
  }
});

it.each([false, true])(
  'queues a second activation while the first is pending (failure: %s)',
  async (shouldFail) => {
    const result = await mount();
    await search(result, '>tabs alphatab');
    await ready(result);
    let finish: (() => void) | undefined;
    api.tabs.update.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = () =>
            shouldFail ? reject(new Error('tab busy')) : resolve({});
        }),
    );
    try {
      await result.view.act(() => {
        keyDown(result.input, 'Enter');
      });
      await vi.waitFor(() => expect(finish).toBeDefined());
      await search(result, '>tabs betatab');
      await ready(result);
      await result.view.act(() => {
        keyDown(result.input, 'Enter');
      });
      await vi.dynamicImportSettled();
      expect(api.tabs.update).toHaveBeenCalledExactlyOnceWith(1, {
        active: true,
      });
      finish?.();
      await vi.waitFor(() =>
        expect(api.tabs.update).toHaveBeenCalledWith(2, { active: true }),
      );
      await vi.waitFor(() =>
        expect(api.windows.update).toHaveBeenLastCalledWith(2, {
          focused: true,
        }),
      );
      if (shouldFail)
        expect(result.props.notify).toHaveBeenCalledWith(
          `${strings.updateFailed} tab busy`,
        );
    } finally {
      finish?.();
      await result.view.act(async () => {});
    }
  },
);
