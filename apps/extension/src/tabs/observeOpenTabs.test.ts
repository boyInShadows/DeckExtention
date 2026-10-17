import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { observeOpenTabs } from './observeOpenTabs';

function event() {
  const listeners = new Set<(...args: unknown[]) => void>();
  return {
    addListener: vi.fn((listener: (...args: unknown[]) => void) =>
      listeners.add(listener),
    ),
    removeListener: vi.fn((listener: (...args: unknown[]) => void) =>
      listeners.delete(listener),
    ),
    emit: (...args: unknown[]) =>
      listeners.forEach((listener) => listener(...args)),
  };
}
let api: ReturnType<typeof mockChrome>;
let stop: (() => void) | undefined;
function mockChrome() {
  return {
    permissions: {
      contains: vi.fn().mockResolvedValue(true),
      onAdded: event(),
      onRemoved: event(),
    },
    runtime: { getURL: () => 'chrome-extension://deck/' },
    tabs: {
      getCurrent: vi.fn().mockResolvedValue({ id: 99, windowId: 1 }),
      query: vi.fn().mockResolvedValue([
        {
          id: 1,
          windowId: 1,
          index: 0,
          title: 'Research',
          url: 'https://example.com/',
        },
      ]),
      onCreated: event(),
      onRemoved: event(),
      onUpdated: event(),
      onMoved: event(),
      onAttached: event(),
      onReplaced: event(),
    },
  };
}
beforeEach(() => {
  api = mockChrome();
  vi.stubGlobal('chrome', api);
});
afterEach(() => {
  stop?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('reads once, refreshes metadata changes and unregisters every listener', async () => {
  const changed = vi.fn();
  const watch = observeOpenTabs(changed, vi.fn());
  stop = watch.stop;
  await vi.waitFor(() =>
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({ hasAccess: true }),
    ),
  );
  api.tabs.onUpdated.emit(1, { title: 'New title' });
  await vi.waitFor(() => expect(api.tabs.query).toHaveBeenCalledTimes(2));
  api.tabs.onUpdated.emit(1, { status: 'complete' });
  stop();
  expect(api.tabs.onUpdated.removeListener).toHaveBeenCalledOnce();
  expect(api.permissions.onRemoved.removeListener).toHaveBeenCalledOnce();
  api.tabs.onCreated.emit();
  expect(api.tabs.query).toHaveBeenCalledTimes(2);
});

it('clears immediately on revoke and rejects a late in-flight result', async () => {
  const changed = vi.fn();
  let finish: ((tabs: unknown[]) => void) | undefined;
  api.tabs.query.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const watch = observeOpenTabs(changed, vi.fn());
  stop = watch.stop;
  await vi.waitFor(() => expect(api.tabs.query).toHaveBeenCalledOnce());
  api.permissions.onRemoved.emit({ permissions: ['tabs'] });
  finish?.([{ id: 1, windowId: 1, index: 0, url: 'https://private.test/' }]);
  await Promise.resolve();
  expect(changed).toHaveBeenLastCalledWith({ hasAccess: false, tabs: [] });
  expect(changed).toHaveBeenCalledOnce();
});

it('reports query failures and uses fresh data after a new grant', async () => {
  const changed = vi.fn();
  const failed = vi.fn();
  api.tabs.query.mockRejectedValueOnce(new Error('Chrome unavailable'));
  const watch = observeOpenTabs(changed, failed);
  stop = watch.stop;
  await vi.waitFor(() =>
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Chrome unavailable' }),
    ),
  );
  api.permissions.onAdded.emit({ permissions: ['tabs'] });
  await vi.waitFor(() =>
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ hasAccess: true }),
    ),
  );
});
