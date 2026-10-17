import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';
import { afterEach, expect, it } from 'vitest';
import { CardSchema, SETTINGS_DEFAULTS, SCHEMA_VERSION } from 'deck-schema';
import { openDeckDatabase, type DeckDatabase } from './database';
import { migrateDocument } from './documentMigration';
import { DeckRepository } from './repository';
import { BackupService } from './backup';

const DATABASE = 'deck-task-migration';
const ROLLBACK = 'deck-task-rollback';
const NOW = 1_800_000_000_000;
const page = {
  id: 'page_tasks',
  title: 'Work',
  order: 'a0',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const deck = {
  ...page,
  id: 'deck_tasks',
  pageId: page.id,
  kind: 'normal' as const,
  color: null,
  isCollapsed: false,
};
const link = {
  ...page,
  id: 'card_link',
  deckId: deck.id,
  url: 'https://example.com/',
  hostname: 'example.com',
  pinned: false,
  lastOpenedAt: null,
  note: 'Never lose this',
};
const original = {
  schemaVersion: 2,
  exportedAt: NOW,
  pages: [page],
  decks: [deck],
  cards: [link],
  settings: SETTINGS_DEFAULTS,
};
const task = {
  ...page,
  id: 'card_task',
  deckId: deck.id,
  kind: 'task' as const,
  title: 'Buy milk',
  hostname: '',
  pinned: false,
  done: false,
  note: 'Buy milk',
  lastOpenedAt: null,
};

async function legacy(name = DATABASE, version = 2, shouldSeed = true) {
  const db = await openDB<DeckDatabase>(name, version, {
    upgrade(handle) {
      for (const store of ['pages', 'decks', 'cards'] as const)
        handle.createObjectStore(store, { keyPath: 'id' });
      handle
        .createObjectStore('ops', { keyPath: 'id' })
        .createIndex('by-ts', 'ts');
      handle
        .createObjectStore('snapshots', { keyPath: 'id' })
        .createIndex('by-ts', 'ts');
      handle.createObjectStore('meta', { keyPath: 'key' });
    },
  });
  if (shouldSeed) {
    await db.put('pages', page);
    await db.put('decks', deck);
    await db.put('cards', link);
    await db.put('meta', { key: 'settings', value: SETTINGS_DEFAULTS });
  }
  return db;
}
afterEach(async () => {
  await deleteDB(DATABASE);
  await deleteDB(ROLLBACK);
});

it('permits missing URLs only on explicit tasks and refuses URL-free pins', () => {
  expect(CardSchema.parse(task)).toEqual(task);
  expect(CardSchema.safeParse({ ...task, kind: undefined }).success).toBe(
    false,
  );
  expect(CardSchema.safeParse({ ...task, pinned: true }).success).toBe(false);
  expect(CardSchema.safeParse({ ...task, url: 'not a URL' }).success).toBe(
    false,
  );
  expect(CardSchema.parse(link)).toEqual(link);
});

it('migrates v2 documents without changing legacy links or the caller’s object', () => {
  const saved = structuredClone(original);
  expect(migrateDocument(saved)).toEqual({
    ...original,
    schemaVersion: SCHEMA_VERSION,
  });
  expect(saved).toEqual(original);
});

it.each([1, 2])(
  'upgrades database v%i to v3 after preserving a snapshot of its original records',
  async (version) => {
    const old = await legacy(DATABASE, version);
    old.close();
    const db = await openDeckDatabase(DATABASE);
    try {
      expect(db.version).toBe(3);
      expect(await db.getAll('cards')).toEqual([link]);
      expect(await db.getAll('decks')).toEqual([deck]);
      const snapshots = await db.getAll('snapshots');
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.schemaVersion).toBe(version);
      const snapshot = JSON.parse(snapshots[0]?.blob ?? 'null');
      expect(snapshot.cards).toEqual([link]);
      expect(migrateDocument(snapshot).cards).toEqual([link]);
    } finally {
      db.close();
    }
  },
);

it('a failed v3 migration leaves the v2 version and all user records intact', async () => {
  const old = await legacy();
  old.close();
  await expect(
    openDeckDatabase(DATABASE, {
      migrateDocument: () => {
        throw new Error('injected v3 failure');
      },
    }).then((db) => {
      db.close();
      return db;
    }),
  ).rejects.toThrow('injected v3 failure');
  const db = await openDB<DeckDatabase>(DATABASE, 2);
  try {
    expect(db.version).toBe(2);
    expect(await db.getAll('pages')).toEqual([page]);
    expect(await db.getAll('decks')).toEqual([deck]);
    expect(await db.getAll('cards')).toEqual([link]);
    expect(await db.getAll('snapshots')).toEqual([]);
  } finally {
    db.close();
  }
});

it('the pre-upgrade snapshot can reconstruct a v2 rollback copy without touching the upgraded database', async () => {
  const old = await legacy();
  old.close();
  const db = await openDeckDatabase(DATABASE);
  try {
    const snapshot = (await db.getAll('snapshots'))[0];
    if (!snapshot) throw new Error('Missing rollback snapshot');
    const saved = JSON.parse(snapshot.blob);
    const rollback = await legacy(ROLLBACK, 2, false);
    try {
      await rollback.put('pages', saved.pages[0]);
      await rollback.put('decks', saved.decks[0]);
      await rollback.put('cards', saved.cards[0]);
      await rollback.put('meta', { key: 'settings', value: saved.settings });
      expect(rollback.version).toBe(2);
      expect(await rollback.getAll('pages')).toEqual([page]);
      expect(await rollback.getAll('decks')).toEqual([deck]);
      expect(await rollback.getAll('cards')).toEqual([link]);
      expect(await rollback.get('meta', 'settings')).toEqual({
        key: 'settings',
        value: SETTINGS_DEFAULTS,
      });
      expect(db.version).toBe(3);
      expect(await db.getAll('cards')).toEqual([link]);
    } finally {
      rollback.close();
    }
  } finally {
    db.close();
  }
});

it('exports, wipes and imports a mixed task/link library with task mode and preserves every field', async () => {
  const repository = new DeckRepository({
    databaseName: DATABASE,
    now: () => NOW,
  });
  const database = openDeckDatabase(DATABASE);
  const backups = new BackupService(repository, database, {
    now: () => NOW,
    snapshotStorage: null,
  });
  try {
    await repository.upsertMany({
      pages: [page],
      decks: [{ ...deck, isTaskMode: true }],
      cards: [link, task],
    });
    const saved = (await backups.exportData()).document;
    await repository.replaceDocument({
      ...saved,
      pages: [],
      decks: [],
      cards: [],
    });
    await backups.importData(saved, 'replace');
    expect((await backups.exportData()).document).toEqual(saved);
  } finally {
    await repository.close();
    (await database).close();
  }
});
