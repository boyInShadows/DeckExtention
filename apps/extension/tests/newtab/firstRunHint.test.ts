import { afterEach, expect, it, vi } from 'vitest';
import { firstRunHint } from '../../src/newtab/firstRunHint';

function fixture() {
  let stored: string | null = null;
  const getItem = vi.fn(() => stored);
  const setItem = vi.fn((_key: string, value: string) => {
    stored = value;
  });
  const request = vi.fn(async (_name: string, action: () => unknown) =>
    action(),
  );
  vi.stubGlobal('navigator', { locks: { request } });
  vi.stubGlobal('localStorage', { getItem, setItem });
  return {
    getItem,
    setItem,
    request,
    setStored: (value: string) => {
      stored = value;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

it('claims one non-modal hint, remembers it and opens existing help on demand', async () => {
  const { setItem, request } = fixture();
  const openHelp = vi.fn();
  const notice = await firstRunHint(openHelp);
  expect(notice).toEqual(
    expect.objectContaining({
      kind: 'info',
      source: 'shortcut-hint',
      text: expect.stringContaining('>help'),
    }),
  );
  expect(setItem).toHaveBeenCalledWith('deck:first-run-hint', 'shown');
  expect(request).toHaveBeenCalledWith(
    'deck:first-run-hint',
    expect.any(Function),
  );
  expect(openHelp).not.toHaveBeenCalled();
  await notice?.action?.run();
  expect(openHelp).toHaveBeenCalledOnce();
  expect(await firstRunHint(openHelp)).toBeNull();
  expect(setItem).toHaveBeenCalledOnce();
});

it('does not reset a malformed stored marker', async () => {
  const { setStored, setItem } = fixture();
  setStored('unexpected');
  await expect(firstRunHint(vi.fn())).rejects.toThrow();
  expect(setItem).not.toHaveBeenCalled();
});

it('propagates failed storage writes instead of claiming the hint was saved', async () => {
  const { setItem } = fixture();
  const error = new Error('Storage full');
  setItem.mockImplementation(() => {
    throw error;
  });
  await expect(firstRunHint(vi.fn())).rejects.toBe(error);
});

it('propagates failed lock acquisition', async () => {
  const { request, setItem } = fixture();
  const error = new Error('Lock unavailable');
  request.mockRejectedValue(error);
  await expect(firstRunHint(vi.fn())).rejects.toBe(error);
  expect(setItem).not.toHaveBeenCalled();
});
