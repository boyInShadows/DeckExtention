import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeckRepository } from '../../src/storage/repository';
import { openDeckDatabase } from '../../src/storage/database';
import { BackupService } from '../../src/storage/backup';
import { FOCUS_KEY } from '../../src/focus/model';

const DATABASE = 'deck-focus-tests';
const MINUTE = 60_000;
let now = new Date(2026, 10, 9, 10).getTime();
let sequence = 0;
let repository: DeckRepository;
beforeEach(() => {
  now = new Date(2026, 10, 9, 10).getTime();
  sequence = 0;
  repository = new DeckRepository({
    databaseName: DATABASE,
    now: () => now,
    createId: () => `focus_id_${++sequence}`,
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await repository.close();
  await deleteDB(DATABASE);
});

it('keeps the saved running session intact when a pause write fails', async () => {
  const started = await repository.changeFocus({ type: 'start', minutes: 25 });
  if (!started.active) throw new Error('Session missing');
  const put = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementationOnce(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
  await expect(
    repository.changeFocus({ type: 'pause', id: started.active.id }),
  ).rejects.toThrow('Storage full');
  put.mockRestore();
  expect(await repository.changeFocus({ type: 'sync' })).toEqual(started);
});

it('exports the last snapshot if the live focus record is corrupt', async () => {
  const database = await openDeckDatabase(DATABASE);
  try {
    const backups = new BackupService(repository, Promise.resolve(database), {
      now: () => now,
      snapshotStorage: null,
    });
    const original = await repository.changeFocus({
      type: 'start',
      minutes: 25,
    });
    await backups.createSnapshot();
    await database.put('meta', { key: FOCUS_KEY, value: { broken: true } });
    const exported = await backups.exportData();
    expect(exported.source).toBe('snapshot');
    expect(exported.document.focus).toEqual(original);
  } finally {
    database.close();
  }
});

it('persists the countdown across repository instances and completes only once across tabs', async () => {
  const started = await repository.changeFocus({ type: 'start', minutes: 1 });
  const other = new DeckRepository({ databaseName: DATABASE, now: () => now });
  try {
    now += 30_000;
    expect((await other.changeFocus({ type: 'sync' })).active?.id).toBe(
      started.active?.id,
    );
    now += MINUTE;
    const states = await Promise.all([
      repository.changeFocus({ type: 'sync' }),
      other.changeFocus({ type: 'sync' }),
    ]);
    expect(states.map(({ history }) => history.length)).toEqual([1, 1]);
    const notices = await Promise.all([
      repository.takeFocusCompletion(),
      other.takeFocusCompletion(),
    ]);
    expect(notices.filter(Boolean)).toHaveLength(1);
    expect(
      (await repository.changeFocus({ type: 'sync' })).unreadId,
    ).toBeNull();
  } finally {
    await other.close();
  }
});

it('allows only one concurrent start and preserves the successful session', async () => {
  const writes = await Promise.allSettled([
    repository.changeFocus({ type: 'start', minutes: 1 }),
    repository.changeFocus({ type: 'start', minutes: 5 }),
  ]);
  expect(writes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
  expect(
    (await repository.changeFocus({ type: 'sync' })).active,
  ).not.toBeNull();
});

it('rejects a deleted/missing task before changing the active state', async () => {
  await expect(
    repository.changeFocus({
      type: 'start',
      minutes: 25,
      taskId: 'missing_task',
    }),
  ).rejects.toThrow();
  expect((await repository.changeFocus({ type: 'sync' })).active).toBeNull();
});

it('preserves corrupt focus state and surfaces the error instead of resetting it', async () => {
  const database = await openDeckDatabase(DATABASE);
  try {
    const broken = { active: 'lost' };
    await database.put('meta', { key: FOCUS_KEY, value: broken });
    await expect(repository.changeFocus({ type: 'sync' })).rejects.toThrow();
    expect((await database.get('meta', FOCUS_KEY))?.value).toEqual(broken);
  } finally {
    database.close();
  }
});

it('exports, wipes, imports and restores focus history and an active session without losing data', async () => {
  const database = await openDeckDatabase(DATABASE);
  try {
    const backups = new BackupService(repository, Promise.resolve(database), {
      now: () => now,
      snapshotStorage: null,
    });
    const first = await repository.changeFocus({ type: 'start', minutes: 1 });
    now += 20_000;
    if (!first.active) throw new Error('Session missing');
    await repository.changeFocus({ type: 'stop', id: first.active.id });
    await repository.changeFocus({ type: 'start', minutes: 25 });
    const exported = await backups.exportData();
    const original = exported.document.focus;
    expect(original?.history).toHaveLength(1);
    await repository.replaceDocument({
      ...exported.document,
      focus: undefined,
    });
    expect((await repository.changeFocus({ type: 'sync' })).history).toEqual(
      [],
    );
    await backups.importData(JSON.parse(exported.json), 'replace');
    expect((await backups.exportData()).document.focus).toEqual(original);
    const snapshot = await backups.createSnapshot();
    await repository.replaceDocument({
      ...exported.document,
      focus: undefined,
    });
    await backups.restoreSnapshot(snapshot.id);
    expect((await backups.exportData()).document.focus).toEqual(original);
  } finally {
    database.close();
  }
});

it('merges duplicate history idempotently and rejects incompatible active sessions', async () => {
  const database = await openDeckDatabase(DATABASE);
  try {
    const backups = new BackupService(repository, Promise.resolve(database), {
      now: () => now,
      snapshotStorage: null,
    });
    await repository.changeFocus({ type: 'start', minutes: 1 });
    now += MINUTE;
    await repository.changeFocus({ type: 'sync' });
    const exported = await backups.exportData();
    await backups.importData(exported.document, 'merge');
    await backups.importData(exported.document, 'merge');
    expect(
      (await repository.changeFocus({ type: 'sync' })).history,
    ).toHaveLength(1);
    await repository.changeFocus({ type: 'start', minutes: 5 });
    const incoming = {
      ...exported.document,
      focus: {
        ...exported.document.focus,
        active: {
          ...(await repository.changeFocus({ type: 'sync' })).active,
          id: 'another_session',
        },
      },
    };
    await expect(backups.importData(incoming, 'merge')).rejects.toThrow();
    expect(
      (await repository.changeFocus({ type: 'sync' })).history,
    ).toHaveLength(1);
  } finally {
    database.close();
  }
});
