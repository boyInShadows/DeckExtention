import {
  CAPTURE_NOTICE_KEY,
  CAPTURE_PERMISSION_DECLINED_KEY,
  CAPTURE_PERMISSIONS,
  OPEN_SETTINGS_HASH,
  SETTINGS_DEFAULTS,
} from 'deck-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeckRepository } from '../../src/storage/repository';
import { quickSave } from '../../src/background/quickSave';
import { setLanguage } from '../../src/i18n/language';
import { captureStrings as persian } from '../../src/i18n/fa/captureStrings';

const getSettings = vi.fn(() => Promise.resolve(SETTINGS_DEFAULTS));
const repository = { getSettings } as unknown as DeckRepository;

function stubChrome() {
  const stored: Record<string, unknown> = {};
  const request = vi.fn(() => Promise.resolve(false));
  const tabsCreate = vi.fn(() => Promise.resolve());
  vi.stubGlobal('chrome', {
    permissions: {
      contains: vi.fn(() => Promise.resolve(false)),
      request,
    },
    storage: {
      local: {
        get: vi.fn((key: string) => Promise.resolve({ [key]: stored[key] })),
        set: vi.fn((items: Record<string, unknown>) => {
          Object.assign(stored, items);
          return Promise.resolve();
        }),
      },
    },
    action: { setBadgeText: vi.fn(() => Promise.resolve()) },
    tabs: { create: tabsCreate },
    runtime: { getURL: (path: string) => `chrome-extension://deck/${path}` },
  });
  return { request, stored, tabsCreate };
}

afterEach(() => {
  setLanguage('en');
  getSettings.mockReset().mockResolvedValue(SETTINGS_DEFAULTS);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Quick Save permission', () => {
  it('asks on first use, remembers a decline, and does not open Settings', async () => {
    vi.useFakeTimers();
    const { request, stored, tabsCreate } = stubChrome();
    await quickSave(repository, undefined);
    await quickSave(repository, undefined);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({
      permissions: [...CAPTURE_PERMISSIONS],
    });
    expect(stored[CAPTURE_PERMISSION_DECLINED_KEY]).toBe(true);
    expect(stored[CAPTURE_NOTICE_KEY]).toEqual(
      expect.objectContaining({ kind: 'error' }),
    );
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('opens Settings only when Chrome refuses the request API', async () => {
    vi.useFakeTimers();
    const { request, stored, tabsCreate } = stubChrome();
    request.mockRejectedValue(new Error('no user gesture'));
    await quickSave(repository, undefined);
    expect(stored[CAPTURE_PERMISSION_DECLINED_KEY]).toBeUndefined();
    expect(tabsCreate).toHaveBeenCalledWith({
      url: `chrome-extension://deck/src/newtab/index.html${OPEN_SETTINGS_HASH}`,
    });
  });

  it('localizes permission fallback after the request without inserting a database wait before it', async () => {
    vi.useFakeTimers();
    const { request, stored } = stubChrome();
    getSettings.mockResolvedValue({ ...SETTINGS_DEFAULTS, language: 'fa' });
    await quickSave(repository, undefined);
    expect(request.mock.invocationCallOrder[0]).toBeLessThan(
      getSettings.mock.invocationCallOrder[0] ?? 0,
    );
    expect(stored[CAPTURE_NOTICE_KEY]).toMatchObject({
      message: persian.needsPermission,
    });
    await quickSave(repository, undefined);
    expect(request).toHaveBeenCalledOnce();
    expect(stored[CAPTURE_NOTICE_KEY]).toMatchObject({
      message: persian.needsPermission,
    });
  });
});
