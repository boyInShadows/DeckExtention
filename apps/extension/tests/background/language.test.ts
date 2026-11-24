import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS } from 'deck-schema';
import { getLanguage, setLanguage } from '../../src/i18n/language';
import { refreshNativeLanguage } from '../../src/background/language';
import type { DeckRepository } from '../../src/storage/repository';

const getSettings = vi.fn();
const repository = { getSettings } as unknown as DeckRepository;
const create = vi.fn();
const removeAll = vi.fn();
const setTitle = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  getSettings.mockResolvedValue({ ...SETTINGS_DEFAULTS, language: 'fa' });
  removeAll.mockResolvedValue(undefined);
  setTitle.mockResolvedValue(undefined);
  create.mockImplementation((_options, callback) => callback());
  vi.stubGlobal('chrome', {
    runtime: {},
    contextMenus: { create, removeAll },
    action: { setTitle },
  });
});

afterEach(() => {
  setLanguage('en');
  vi.unstubAllGlobals();
});

it('loads the validated saved language and changes both menus and the toolbar', async () => {
  await refreshNativeLanguage(repository);
  expect(getLanguage()).toBe('fa');
  expect(create.mock.calls.map(([options]) => options)).toEqual([
    { id: 'deck-save-page', title: 'ذخیره در Deck', contexts: ['page'] },
    { id: 'deck-save-link', title: 'ذخیرهٔ پیوند در Deck', contexts: ['link'] },
  ]);
  expect(setTitle).toHaveBeenCalledWith({ title: 'ذخیره در Deck' });
  getSettings.mockResolvedValue(SETTINGS_DEFAULTS);
  await refreshNativeLanguage(repository);
  expect(getLanguage()).toBe('en');
  expect(setTitle).toHaveBeenLastCalledWith({
    title: "Save this page to Deck's Inbox",
  });
});

it('reports native API failure and lets the next refresh recover', async () => {
  create.mockImplementationOnce((_options, callback) => {
    Object.assign(chrome.runtime, {
      lastError: { message: 'Menu unavailable' },
    });
    callback();
    Reflect.deleteProperty(chrome.runtime, 'lastError');
  });
  await expect(refreshNativeLanguage(repository)).rejects.toThrow(
    'Menu unavailable',
  );
  await expect(refreshNativeLanguage(repository)).resolves.toBeUndefined();
  expect(setTitle).toHaveBeenCalledOnce();
});

it('serializes concurrent refreshes without duplicating menu IDs', async () => {
  let release!: () => void;
  removeAll.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const first = refreshNativeLanguage(repository);
  const second = refreshNativeLanguage(repository);
  await vi.waitFor(() => expect(removeAll).toHaveBeenCalledOnce());
  expect(create).not.toHaveBeenCalled();
  release();
  await Promise.all([first, second]);
  expect(removeAll).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenCalledTimes(4);
});
