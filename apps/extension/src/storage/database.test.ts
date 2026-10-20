import 'fake-indexeddb/auto';

import { deleteDB } from 'idb';
import { afterEach, expect, it, vi } from 'vitest';

import { ACTIVE_DATABASE_KEY, openDeckDatabase } from './database';

const RECOVERY_DATABASE = 'deck-recovery-opening-test';

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await deleteDB(RECOVERY_DATABASE);
});

it('starts version discovery while the active-database lookup is pending', async () => {
  let resolveStorage!: (value: Record<string, unknown>) => void;
  const storage = new Promise<Record<string, unknown>>((resolve) => {
    resolveStorage = resolve;
  });
  const get = vi.fn(() => storage);
  vi.stubGlobal('chrome', { storage: { local: { get } } });
  const databases = vi.spyOn(indexedDB, 'databases');
  const open = vi.spyOn(indexedDB, 'open');
  const opening = openDeckDatabase();
  try {
    expect(get).toHaveBeenCalledWith(ACTIVE_DATABASE_KEY);
    expect(databases).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  } finally {
    resolveStorage({ [ACTIVE_DATABASE_KEY]: RECOVERY_DATABASE });
    const database = await opening;
    expect(database.name).toBe(RECOVERY_DATABASE);
    database.close();
  }
});

it('waits for version discovery before opening the selected database', async () => {
  let resolveDatabases!: (value: IDBDatabaseInfo[]) => void;
  vi.spyOn(indexedDB, 'databases').mockImplementation(
    () => new Promise((resolve) => (resolveDatabases = resolve)),
  );
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({
          [ACTIVE_DATABASE_KEY]: RECOVERY_DATABASE,
        }),
      },
    },
  });
  const open = vi.spyOn(indexedDB, 'open');
  const opening = openDeckDatabase();
  try {
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
  } finally {
    resolveDatabases([]);
    const database = await opening;
    expect(database.name).toBe(RECOVERY_DATABASE);
    database.close();
  }
});

it('rejects an invalid active database without opening or upgrading it', async () => {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({ [ACTIVE_DATABASE_KEY]: 'other' }),
      },
    },
  });
  const open = vi.spyOn(indexedDB, 'open');
  await expect(openDeckDatabase()).rejects.toThrow('Bad database');
  expect(open).not.toHaveBeenCalled();
});

it.each(['selection', 'versions'])(
  'propagates failed %s reads without opening a database',
  async (failure) => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(() =>
            failure === 'selection'
              ? Promise.reject(new Error('selection unavailable'))
              : Promise.resolve({ [ACTIVE_DATABASE_KEY]: RECOVERY_DATABASE }),
          ),
        },
      },
    });
    if (failure === 'versions')
      vi.spyOn(indexedDB, 'databases').mockRejectedValue(
        new Error('versions unavailable'),
      );
    const open = vi.spyOn(indexedDB, 'open');
    await expect(openDeckDatabase()).rejects.toThrow(`${failure} unavailable`);
    expect(open).not.toHaveBeenCalled();
  },
);
