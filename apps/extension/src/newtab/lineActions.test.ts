// @vitest-environment happy-dom
import 'fake-indexeddb/auto';

import { SETTINGS_DEFAULTS, type Settings } from 'deck-schema';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { panelStrings } from '../i18n/panelStrings';
import { DeckRepository } from '../storage/repository';
import { executeAction, searchWeb } from './lineActions';

const TEST_DATABASE = 'deck-line-actions-test';
const FIXED_NOW = new Date('2026-03-04T05:06:07Z');
const BLOB_URL = 'blob:deck-export';

let repository: DeckRepository | undefined;

function openRepository(): DeckRepository {
  repository = new DeckRepository({ databaseName: TEST_DATABASE });
  return repository;
}

function contextFor(settings: Settings = SETTINGS_DEFAULTS) {
  return {
    settings,
    repository: openRepository(),
    saveSettings: vi.fn<(next: Settings) => Promise<void>>(() =>
      Promise.resolve(),
    ),
    openSettings: vi.fn<() => void>(),
    notify: vi.fn<(message: string) => void>(),
    notifyNotice: vi.fn(),
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await repository?.close();
  repository = undefined;
  await deleteDB(TEST_DATABASE);
});

describe('executeAction', () => {
  it('toggles the privacy blur both ways', async () => {
    const context = contextFor({ ...SETTINGS_DEFAULTS, isBlurred: true });
    await executeAction('blur', context);
    expect(context.saveSettings).toHaveBeenCalledWith({
      ...SETTINGS_DEFAULTS,
      isBlurred: false,
    });
  });

  it.each([
    ['theme-night', 'night'],
    ['theme-day', 'day'],
    ['theme-system', 'system'],
  ] as const)('%s saves the %s theme', async (id, theme) => {
    const context = contextFor();
    await executeAction(id, context);
    expect(context.saveSettings).toHaveBeenCalledWith({
      ...SETTINGS_DEFAULTS,
      theme,
    });
    expect(context.openSettings).not.toHaveBeenCalled();
  });

  it.each(['settings', 'import'] as const)(
    '%s opens Settings without saving',
    async (id) => {
      const context = contextFor();
      await executeAction(id, context);
      expect(context.openSettings).toHaveBeenCalledTimes(1);
      expect(context.saveSettings).not.toHaveBeenCalled();
    },
  );

  it('explains that new pages need the drawer', async () => {
    const context = contextFor();
    await executeAction('new-page', context);
    expect(context.notify).toHaveBeenCalledWith(panelStrings.drawerRequired);
  });

  it('starts stash through the worker once tab access is granted', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ error: null });
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn().mockResolvedValue(true) },
      runtime: { sendMessage },
    });
    const context = contextFor();
    await executeAction('stash', context);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'deck:stash' });
  });

  it('downloads a dated JSON export and releases the object URL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (blob instanceof Blob) blobs.push(blob);
      return BLOB_URL;
    });
    const revokeUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });

    await executeAction('export', contextFor());

    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('deck-2026-03-04.json');
    expect(clicked[0]?.href).toBe(BLOB_URL);
    expect(blobs[0]?.type).toBe('application/json');
    const exported = JSON.parse(await (blobs[0] as Blob).text()) as {
      schemaVersion: number;
    };
    expect(exported.schemaVersion).toEqual(expect.any(Number));
    expect(revokeUrl).toHaveBeenCalledWith(BLOB_URL);
  });
});

describe('searchWeb', () => {
  function stubChrome(isGranted: boolean, isAlreadyGranted = false) {
    const contains = vi.fn(() => Promise.resolve(isAlreadyGranted));
    const request = vi.fn(() => Promise.resolve(isGranted));
    const query = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', {
      permissions: { contains, request },
      search: { query },
    });
    return { contains, request, query };
  }

  it('runs Chrome search in this tab once the permission is granted', async () => {
    const chromeApi = stubChrome(true);
    const assign = vi.spyOn(window.location, 'assign');
    const saveSettings = vi.fn();
    await searchWeb('deck tabs', SETTINGS_DEFAULTS, saveSettings);
    expect(chromeApi.contains).toHaveBeenCalledWith({
      permissions: ['search'],
    });
    expect(chromeApi.request).toHaveBeenCalledWith({
      permissions: ['search'],
    });
    expect(chromeApi.query).toHaveBeenCalledWith({
      text: 'deck tabs',
      disposition: 'CURRENT_TAB',
    });
    expect(assign).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('uses an existing search grant without asking again', async () => {
    const chromeApi = stubChrome(false, true);
    await searchWeb('deck tabs', SETTINGS_DEFAULTS, vi.fn());
    expect(chromeApi.request).not.toHaveBeenCalled();
    expect(chromeApi.query).toHaveBeenCalledOnce();
  });

  it('falls back to the search URL template, encoding the query', async () => {
    const chromeApi = stubChrome(false);
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => undefined);
    const settings = {
      ...SETTINGS_DEFAULTS,
      searchUrlTemplate: 'https://search.example/?q={query}',
    };
    const saveSettings = vi.fn(() => Promise.resolve());
    await searchWeb('a&b c', settings, saveSettings);
    expect(chromeApi.query).not.toHaveBeenCalled();
    expect(saveSettings).toHaveBeenCalledWith({
      ...settings,
      searchPermission: 'declined',
    });
    expect(assign).toHaveBeenCalledWith('https://search.example/?q=a%26b%20c');
  });

  it('does not ask again after a decline', async () => {
    const chromeApi = stubChrome(true);
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => undefined);
    const saveSettings = vi.fn();
    await searchWeb(
      'next',
      { ...SETTINGS_DEFAULTS, searchPermission: 'declined' },
      saveSettings,
    );
    expect(chromeApi.request).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('https://www.google.com/search?q=next');
  });
});
