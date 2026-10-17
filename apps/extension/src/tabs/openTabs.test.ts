import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeckRepository } from '../storage/repository';
import { performTabAction, readOpenTabs, requestTabSearch } from './openTabs';
import { TABS_PERMISSION_DECLINED_KEY } from '../permissions/keys';
import type { NoticeInput } from '../newtab/ToastStack';

const DATABASE = 'deck-open-tabs-test';
const NOW = 1_800_000_000_000;
const tab = (id: number, change = {}) => ({
  id,
  windowId: 7,
  index: id,
  title: `Research ${id}`,
  url: `https://example.com/${id}`,
  ...change,
});
let repository: DeckRepository;
let api: ReturnType<typeof mockChrome>;
function mockChrome() {
  return {
    permissions: {
      contains: vi.fn().mockResolvedValue(true),
      request: vi.fn().mockResolvedValue(true),
    },
    runtime: { getURL: (path: string) => `chrome-extension://deck/${path}` },
    tabs: {
      query: vi.fn().mockResolvedValue([tab(1), tab(2)]),
      getCurrent: vi.fn().mockResolvedValue(tab(99)),
      get: vi.fn(async (id: number) => tab(id)),
      update: vi.fn().mockResolvedValue({}),
      remove: vi.fn().mockResolvedValue(undefined),
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
async function selectedTab() {
  const result = (await readOpenTabs()).tabs[0];
  if (!result) throw new Error('Missing tab fixture');
  return result;
}
beforeEach(() => {
  repository = new DeckRepository({ databaseName: DATABASE, now: () => NOW });
  api = mockChrome();
  vi.stubGlobal('chrome', api);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await repository.close();
  await deleteDB(DATABASE);
});

it('never reads the tab list without permission', async () => {
  api.permissions.contains.mockResolvedValue(false);
  expect(await readOpenTabs()).toEqual({ hasAccess: false, tabs: [] });
  expect(api.tabs.query).not.toHaveBeenCalled();
});

it('keeps all 40 valid tabs, includes other windows/internal pages, and excludes Deck and incomplete metadata', async () => {
  api.tabs.query.mockResolvedValue([
    ...Array.from({ length: 40 }, (_, i) => tab(i + 1)),
    tab(99),
    tab(100, { url: 'chrome://newtab/' }),
    tab(101, { url: 'chrome-extension://deck/src/newtab/index.html' }),
    tab(102, { id: undefined }),
    tab(103, { url: undefined }),
    tab(104, { id: -1 }),
    tab(105, { windowId: 8, url: 'chrome://settings/', title: 'Settings' }),
  ]);
  const result = await readOpenTabs();
  expect(result.hasAccess).toBe(true);
  expect(result.tabs).toHaveLength(41);
  expect(result.tabs[0]).toMatchObject({
    id: 1,
    hostname: 'example.com',
    windowId: 7,
  });
  expect(result.tabs.at(-1)).toMatchObject({
    id: 105,
    hostname: 'settings',
    windowId: 8,
  });
});

it('activates an existing tab, focuses its current window and stamps matching saved cards', async () => {
  const target = await selectedTab();
  await performTabAction(repository, target, 'save');
  api.tabs.get.mockResolvedValue(tab(1, { windowId: 9 }));
  await performTabAction(repository, target, 'activate');
  expect(api.tabs.update).toHaveBeenCalledWith(1, { active: true });
  expect(api.windows.update).toHaveBeenCalledWith(9, { focused: true });
  expect((await repository.listCards())[0]?.lastOpenedAt).toBe(NOW);
});

it('saves through Inbox deduplication and never closes the saved browser tab', async () => {
  const target = await selectedTab();
  expect(await performTabAction(repository, target, 'save')).toContain(
    'Saved to Inbox',
  );
  expect(await performTabAction(repository, target, 'save')).toContain(
    'Already in',
  );
  expect(await repository.listCards()).toHaveLength(1);
  expect(api.tabs.remove).not.toHaveBeenCalled();
});

it('closes only the selected tab after revalidating it', async () => {
  await performTabAction(repository, await selectedTab(), 'close');
  expect(api.tabs.remove).toHaveBeenCalledExactlyOnceWith(1);
});

it('refuses stale or revoked results without closing or saving anything', async () => {
  const target = await selectedTab();
  api.tabs.get.mockResolvedValue(
    tab(1, { pendingUrl: 'https://changed.test/' }),
  );
  await expect(performTabAction(repository, target, 'close')).rejects.toThrow(
    'changed',
  );
  await expect(performTabAction(repository, target, 'save')).rejects.toThrow(
    'changed',
  );
  api.permissions.contains.mockResolvedValue(false);
  await expect(performTabAction(repository, target, 'close')).rejects.toThrow();
  expect(api.tabs.remove).not.toHaveBeenCalled();
  expect(await repository.listCards()).toEqual([]);
});

it('reports unsupported saves and storage or Chrome failures', async () => {
  api.tabs.query.mockResolvedValue([tab(1, { url: 'chrome://settings/' })]);
  api.tabs.get.mockResolvedValue(tab(1, { url: 'chrome://settings/' }));
  await expect(
    performTabAction(repository, await selectedTab(), 'save'),
  ).rejects.toThrow('Only web pages');
  api.tabs.query.mockResolvedValue([tab(1)]);
  api.tabs.get.mockResolvedValue(tab(1));
  vi.spyOn(repository, 'upsertCard').mockRejectedValueOnce(
    new Error('disk full'),
  );
  await expect(
    performTabAction(repository, await selectedTab(), 'save'),
  ).rejects.toThrow('disk full');
  api.tabs.remove.mockRejectedValueOnce(new Error('tab busy'));
  await expect(
    performTabAction(repository, await selectedTab(), 'close'),
  ).rejects.toThrow('tab busy');
});

it('explains access first and requests only tabs from the explicit Allow action', async () => {
  api.permissions.contains.mockResolvedValue(false);
  const notices: NoticeInput[] = [];
  await requestTabSearch((notice) => notices.push(notice));
  expect(api.permissions.request).not.toHaveBeenCalled();
  expect(notices[0]?.text).toContain('find open tabs');
  await notices[0]?.action?.run();
  expect(api.permissions.request).toHaveBeenCalledExactlyOnceWith({
    permissions: ['tabs'],
  });
  api.permissions.request.mockResolvedValue(false);
  await notices[0]?.action?.run();
  expect(api.storage.local.set).toHaveBeenCalledWith({
    [TABS_PERMISSION_DECLINED_KEY]: true,
  });
  api.storage.local.get.mockResolvedValue({
    [TABS_PERMISSION_DECLINED_KEY]: true,
  });
  api.permissions.request.mockClear();
  await requestTabSearch((notice) => notices.push(notice));
  expect(api.permissions.request).not.toHaveBeenCalled();
  expect(notices.at(-1)?.kind).toBe('error');
});
