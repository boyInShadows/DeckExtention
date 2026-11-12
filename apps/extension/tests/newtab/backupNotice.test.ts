import { afterEach, expect, it, vi } from 'vitest';

import {
  backupFailureNotice,
  watchBackupNotices,
} from '../../src/newtab/pendingNotices';
import { BACKUP_ERROR_KEY } from 'deck-schema';

const schemaError = JSON.stringify([
  {
    code: 'unrecognized_keys',
    keys: ['showGoogleSuggestions'],
    path: ['settings'],
    message: 'Unrecognized key: "showGoogleSuggestions"',
  },
]);

afterEach(() => vi.unstubAllGlobals());

function storageFixture(get = vi.fn(async () => ({}))) {
  const listeners = new Set<
    (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => void
  >();
  const remove = vi.fn();
  vi.stubGlobal('chrome', {
    storage: {
      local: { get, remove },
      onChanged: {
        addListener: (
          listener: (
            changes: Record<string, chrome.storage.StorageChange>,
            area: string,
          ) => void,
        ) => listeners.add(listener),
        removeListener: (
          listener: (
            changes: Record<string, chrome.storage.StorageChange>,
            area: string,
          ) => void,
        ) => listeners.delete(listener),
      },
    },
  });
  const changed = (value: unknown, area = 'local') => {
    for (const listener of listeners)
      listener({ [BACKUP_ERROR_KEY]: { newValue: value } }, area);
  };
  return { listeners, remove, changed };
}

it.each(['removed', 'disposed'])(
  'does not revive a stale initial warning after it was %s',
  async (reason) => {
    let resolveRead: (items: Record<string, unknown>) => void = () => {
      throw new Error('Read not started');
    };
    const pending = new Promise<Record<string, unknown>>((resolve) => {
      resolveRead = resolve;
    });
    const { changed, listeners, remove } = storageFixture(vi.fn(() => pending));
    const notify = vi.fn();
    const clear = vi.fn();
    const stop = watchBackupNotices(notify, clear);
    if (reason === 'removed') changed(undefined);
    else stop();
    resolveRead({
      [BACKUP_ERROR_KEY]: { message: 'stale quota failure', occurredAt: 1 },
    });
    await pending;
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(reason === 'removed' ? 1 : 0);
    stop();
    expect(listeners.size).toBe(0);
  },
);

it('replaces backup notices only on local backup changes and reports malformed records', async () => {
  const { changed, remove } = storageFixture();
  const notify = vi.fn();
  const clear = vi.fn();
  const stop = watchBackupNotices(notify, clear);
  await Promise.resolve();
  changed({ message: 'new quota failure', occurredAt: 1 }, 'sync');
  expect(notify).not.toHaveBeenCalled();
  changed({ message: 'new quota failure', occurredAt: 1 });
  expect(notify).toHaveBeenLastCalledWith(
    backupFailureNotice('new quota failure'),
  );
  changed({ message: 42 });
  expect(notify).toHaveBeenLastCalledWith(
    expect.objectContaining({
      source: 'backup',
      text: expect.stringContaining('Backup failed.'),
    }),
  );
  changed(undefined);
  expect(clear).toHaveBeenCalledTimes(4);
  expect(remove).not.toHaveBeenCalled();
  stop();
});

it('reports a failed initial read instead of hiding it', async () => {
  storageFixture(vi.fn().mockRejectedValue(new Error('read failed')));
  const notify = vi.fn();
  const stop = watchBackupNotices(notify, vi.fn());
  await Promise.resolve();
  expect(notify).toHaveBeenCalledWith({
    kind: 'error',
    text: 'Error: read failed',
  });
  stop();
});

it('offers extension reload for the older settings validator without clearing evidence', () => {
  const reload = vi.fn();
  const remove = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: { reload },
    storage: { local: { remove } },
  });
  const notice = backupFailureNotice(schemaError);
  expect(notice.kind).toBe('error');
  expect(notice.text).toContain('Reload Deck');
  expect(notice.action?.label).toBe('Reload Deck');
  expect(backupFailureNotice(schemaError).action).toBe(notice.action);
  expect(reload).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  notice.action?.run();
  expect(reload).toHaveBeenCalledOnce();
  expect(remove).not.toHaveBeenCalled();
});

it.each([
  'disk full',
  '[invalid JSON',
  JSON.stringify([
    { code: 'unrecognized_keys', keys: ['unknown'], path: ['settings'] },
  ]),
  JSON.stringify([
    {
      code: 'unrecognized_keys',
      keys: ['showGoogleSuggestions'],
      path: ['cards'],
    },
  ]),
  JSON.stringify([
    {
      code: 'invalid_type',
      keys: ['showGoogleSuggestions'],
      path: ['settings'],
    },
  ]),
  JSON.stringify([]),
])('preserves other failures and avoids an unrelated reload: %s', (message) => {
  expect(backupFailureNotice(message)).toEqual({
    source: 'backup',
    kind: 'error',
    text: `Backup failed. ${message}`,
  });
});
