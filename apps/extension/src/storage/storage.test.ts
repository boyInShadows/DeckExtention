import 'fake-indexeddb/auto';

import {
  SCHEMA_VERSION,
  SETTINGS_DEFAULTS,
  type Card,
  type Deck,
  type Page,
} from 'deck-schema';
import { deleteDB, openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackupService, migrateDocument, SNAPSHOT_INTERVAL_MS } from './backup';
import {
  ACTIVE_DATABASE_KEY,
  openDeckDatabase,
  type DeckDatabase,
} from './database';
import { parseDocument, type DeckDocument } from './document';
import { DeckRepository } from './repository';

const NOW = 1_800_000_000_000;
const PURGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DATABASE_NAME = 'deck-storage-test';
const LEGACY_DATABASE_NAME = 'deck-storage-legacy-test';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let idSequence = 0;

function createId(): string {
  idSequence += 1;
  return `id_${String(idSequence).padStart(6, '0')}`;
}

const page: Page = {
  id: 'page_001',
  title: 'Work',
  order: 'a0',
  createdAt: NOW - 2,
  updatedAt: NOW - 2,
  deletedAt: null,
};

const deck: Deck = {
  id: 'deck_001',
  pageId: page.id,
  title: 'Reading',
  kind: 'normal',
  order: 'a0',
  color: null,
  isCollapsed: false,
  createdAt: NOW - 1,
  updatedAt: NOW - 1,
  deletedAt: null,
};

const card: Card = {
  id: 'card_001',
  deckId: deck.id,
  url: 'https://example.com/article',
  title: 'Article',
  hostname: 'example.com',
  order: 'a0',
  pinned: false,
  lastOpenedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

function populatedDocument(): DeckDocument {
  return parseDocument({
    schemaVersion: SCHEMA_VERSION,
    exportedAt: NOW,
    pages: [page],
    decks: [deck],
    cards: [card],
    settings: { ...SETTINGS_DEFAULTS, ownerName: 'Kasra' },
  });
}

function emptyDocument(): DeckDocument {
  return parseDocument({
    schemaVersion: SCHEMA_VERSION,
    exportedAt: NOW,
    pages: [],
    decks: [],
    cards: [],
    settings: SETTINGS_DEFAULTS,
  });
}

async function createServices() {
  const repository = new DeckRepository({
    databaseName: DATABASE_NAME,
    now: () => NOW,
    createId,
  });
  const database = openDeckDatabase(DATABASE_NAME);
  const backups = new BackupService(repository, database, {
    now: () => NOW,
    createId,
  });
  return { repository, database, backups };
}

async function createLegacyDatabase(version = 1) {
  const database = await openDB<DeckDatabase>(LEGACY_DATABASE_NAME, version, {
    upgrade(handle) {
      handle.createObjectStore('pages', { keyPath: 'id' });
      handle.createObjectStore('decks', { keyPath: 'id' });
      handle.createObjectStore('cards', { keyPath: 'id' });
      handle
        .createObjectStore('ops', { keyPath: 'id' })
        .createIndex('by-ts', 'ts');
      handle
        .createObjectStore('snapshots', { keyPath: 'id' })
        .createIndex('by-ts', 'ts');
      handle.createObjectStore('meta', { keyPath: 'key' });
    },
  });
  await database.put('pages', page);
  await database.put('decks', deck);
  await database.put('cards', card);
  await database.put('meta', { key: 'settings', value: SETTINGS_DEFAULTS });
  database.close();
}

beforeEach(() => {
  idSequence = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  const database = await openDeckDatabase(DATABASE_NAME);
  database.close();
  await deleteDB(DATABASE_NAME);
  await deleteDB(LEGACY_DATABASE_NAME);
});

describe('database v1 to current migration', () => {
  it('snapshots the live version when another context has advanced beyond discovery', async () => {
    await createLegacyDatabase(2);
    vi.spyOn(indexedDB, 'databases').mockResolvedValue([
      { name: LEGACY_DATABASE_NAME, version: 1 },
    ]);
    const database = await openDeckDatabase(LEGACY_DATABASE_NAME);
    try {
      expect(database.version).toBe(SCHEMA_VERSION);
      expect(await database.getAll('cards')).toEqual([card]);
      expect(await database.getAll('pages')).toEqual([page]);
      expect(await database.getAll('decks')).toEqual([deck]);
      const [snapshot] = await database.getAll('snapshots');
      expect(snapshot?.schemaVersion).toBe(2);
      expect(JSON.parse(snapshot?.blob ?? '{}')).toMatchObject({
        schemaVersion: 2,
        cards: [card],
        settings: SETTINGS_DEFAULTS,
      });
    } finally {
      database.close();
    }
  });

  it('preserves records and stores a pre-upgrade snapshot', async () => {
    await createLegacyDatabase();
    const database = await openDeckDatabase(LEGACY_DATABASE_NAME);
    expect(database.version).toBe(SCHEMA_VERSION);
    expect(await database.getAll('pages')).toEqual([page]);
    expect(await database.getAll('decks')).toEqual([deck]);
    expect(await database.getAll('cards')).toEqual([card]);
    const snapshots = await database.getAll('snapshots');
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.schemaVersion).toBe(1);
    const snapshot = snapshots[0];
    if (!snapshot) throw new Error('Missing migration snapshot');
    expect(migrateDocument(JSON.parse(snapshot.blob) as unknown).pages).toEqual(
      [page],
    );
    database.close();
  });

  it('leaves the v1 database intact when the migration fails', async () => {
    await createLegacyDatabase();
    await expect(
      openDeckDatabase(LEGACY_DATABASE_NAME, {
        migrateDocument: () => {
          throw new Error('injected v2 failure');
        },
      }),
    ).rejects.toThrow('injected v2 failure');
    const legacy = await openDB<DeckDatabase>(LEGACY_DATABASE_NAME, 1);
    expect(legacy.version).toBe(1);
    expect(await legacy.getAll('pages')).toEqual([page]);
    expect(await legacy.getAll('decks')).toEqual([deck]);
    expect(await legacy.getAll('cards')).toEqual([card]);
    legacy.close();
  });
});

describe('DeckRepository', () => {
  it('writes immutable records and appends one operation per entity write', async () => {
    const { repository, database } = await createServices();
    const input = { ...page };

    const saved = await repository.upsertPage(input);
    input.title = 'Mutated outside';

    expect(saved.title).toBe('Work');
    expect(await repository.listPages()).toEqual([page]);
    expect(await repository.listOps()).toMatchObject([
      { entity: 'page', entityId: page.id, kind: 'upsert', payload: page },
    ]);
    await repository.close();
    (await database).close();
  });

  it('soft-deletes, restores, and only purges records past the cutoff', async () => {
    const { repository, database } = await createServices();
    await repository.upsertPage(page);
    await repository.softDelete('page', page.id);
    expect((await repository.listPages())[0]?.deletedAt).toBe(NOW);

    await repository.restore('page', page.id);
    expect((await repository.listPages())[0]?.deletedAt).toBeNull();
    await repository.softDelete('page', page.id);
    expect(await repository.purge(NOW - 1)).toBe(0);
    expect(await repository.purge(NOW)).toBe(1);

    await repository.close();
    (await database).close();
  });

  it('trashes a deck and its live cards together, then restores their positions', async () => {
    const { repository, database } = await createServices();
    try {
      const alreadyTrashed = {
        ...card,
        id: 'card_old',
        deletedAt: NOW - 100,
      };
      await repository.upsertMany({
        pages: [page],
        decks: [deck],
        cards: [card, alreadyTrashed],
      });

      await repository.trashDeck(deck.id);
      const exported = await repository.readDocument(NOW);
      expect(exported.decks.find(({ id }) => id === deck.id)?.deletedAt).toBe(
        NOW,
      );
      expect(exported.cards.find(({ id }) => id === card.id)?.deletedAt).toBe(
        NOW,
      );
      expect(
        exported.cards.find(({ id }) => id === alreadyTrashed.id)?.deletedAt,
      ).toBe(NOW - 100);

      await repository.restoreDeck(deck.id);
      expect((await repository.listDecks())[0]?.deletedAt).toBeNull();
      expect(
        (await repository.listCards()).find(({ id }) => id === card.id),
      ).toMatchObject({
        order: card.order,
        deletedAt: null,
      });
      expect(
        (await repository.listCards()).find(
          ({ id }) => id === alreadyTrashed.id,
        )?.deletedAt,
      ).toBe(NOW - 100);
    } finally {
      await repository.close();
      (await database).close();
    }
  });

  it('trashes and restores a page with its decks and cards', async () => {
    const { repository, database } = await createServices();
    try {
      const inbox = { ...deck, id: 'deck_inbox', kind: 'inbox' as const };
      const inboxCard = { ...card, id: 'card_inbox', deckId: inbox.id };
      await repository.upsertMany({
        pages: [page],
        decks: [deck, inbox],
        cards: [card, inboxCard],
      });
      await repository.trashPage(page.id);
      expect((await repository.listPages())[0]?.deletedAt).toBe(NOW);
      expect(
        (await repository.listDecks()).find(({ id }) => id === deck.id)
          ?.deletedAt,
      ).toBe(NOW);
      expect(
        (await repository.listCards()).find(({ id }) => id === card.id)
          ?.deletedAt,
      ).toBe(NOW);
      expect(
        (await repository.listDecks()).find(({ id }) => id === inbox.id)
          ?.deletedAt,
      ).toBeNull();
      expect(
        (await repository.listCards()).find(({ id }) => id === inboxCard.id)
          ?.deletedAt,
      ).toBeNull();

      await repository.restorePage(page.id);
      expect((await repository.listPages())[0]?.deletedAt).toBeNull();
      expect(
        (await repository.listDecks()).every(
          ({ deletedAt }) => deletedAt === null,
        ),
      ).toBe(true);
      expect(
        (await repository.listCards()).every(
          ({ deletedAt }) => deletedAt === null,
        ),
      ).toBe(true);
    } finally {
      await repository.close();
      (await database).close();
    }
  });

  it('purges expired rows and ops without orphaning a live card', async () => {
    const { repository, database } = await createServices();
    try {
      const expiredAt = NOW - PURGE_RETENTION_MS - 1;
      await repository.upsertMany({
        pages: [{ ...page, deletedAt: expiredAt }],
        decks: [{ ...deck, deletedAt: expiredAt }],
        cards: [card, { ...card, id: 'card_expired', deletedAt: expiredAt }],
      });
      const firstOp = (await repository.listOps())[0];
      if (!firstOp) throw new Error('Missing seed operation');
      const oldOp = {
        ...firstOp,
        id: 'op_expired',
        ts: expiredAt,
      };
      await (await database).put('ops', oldOp);

      expect(await repository.purge()).toBe(1);
      expect((await repository.listCards()).map(({ id }) => id)).toEqual([
        card.id,
      ]);
      expect(await repository.listDecks()).toHaveLength(1);
      expect(await repository.listPages()).toHaveLength(1);
      expect(
        (await repository.listOps()).some(({ id }) => id === oldOp.id),
      ).toBe(false);
    } finally {
      await repository.close();
      (await database).close();
    }
  });

  it('caps the oplog at the newest 5,000 entries', async () => {
    const { repository, database } = await createServices();
    try {
      await repository.upsertPage(page);
      const handle = await database;
      const template = (await repository.listOps())[0];
      if (!template) throw new Error('Missing seed operation');
      const transaction = handle.transaction('ops', 'readwrite');
      for (let index = 0; index < 5_001; index += 1) {
        void transaction.store.put({
          ...template,
          id: `op_cap_${index}`,
          ts: NOW + index,
        });
      }
      await transaction.done;

      await repository.purge();
      const ops = await repository.listOps();
      expect(ops).toHaveLength(5_000);
      expect(ops.some(({ id }) => id === 'op_cap_0')).toBe(false);
      expect(ops.some(({ id }) => id === 'op_cap_5000')).toBe(true);
    } finally {
      await repository.close();
      (await database).close();
    }
  });

  it('keeps the latest operation for each entity after the 30-day cutoff', async () => {
    const { repository, database } = await createServices();
    try {
      await repository.upsertPage(page);
      const handle = await database;
      const [template] = await repository.listOps();
      if (!template) throw new Error('Missing seed operation');
      const oldTs = NOW - PURGE_RETENTION_MS - 1;
      await handle.put('ops', {
        ...template,
        id: 'op_old_1',
        entityId: 'page_old1',
        ts: oldTs - 1,
      });
      await handle.put('ops', {
        ...template,
        id: 'op_old_2',
        entityId: 'page_old1',
        ts: oldTs,
      });
      await repository.purge();
      const ids = (await repository.listOps()).map(({ id }) => id);
      expect(ids).toContain('op_old_2');
      expect(ids).not.toContain('op_old_1');
    } finally {
      await repository.close();
      (await database).close();
    }
  });
});

describe('BackupService', () => {
  it('round-trips export, wipe, and replace import without losing data', async () => {
    const { repository, database, backups } = await createServices();
    await repository.replaceDocument({
      ...populatedDocument(),
      decks: [{ ...deck, note: '# Reading', isCollapsed: true }],
      cards: [
        {
          ...card,
          note: 'A saved note',
          done: true,
          pinned: true,
          pinLabel: 'Read',
        },
      ],
    });
    const original = await backups.exportData();

    await repository.replaceDocument(emptyDocument());
    await backups.importData(JSON.parse(original.json) as unknown, 'replace');

    expect((await backups.exportData()).document).toEqual(original.document);
    await repository.close();
    (await database).close();
  });

  it('restores the exact pre-import workspace using the returned snapshot ID', async () => {
    const { repository, database, backups } = await createServices();
    await repository.replaceDocument(populatedDocument());
    const before = await repository.readDocument(NOW);
    const { snapshotId } = await backups.importData(emptyDocument(), 'replace');
    expect(await repository.listCards()).toHaveLength(0);
    await backups.restoreSnapshot(snapshotId);
    expect(await repository.readDocument(NOW)).toEqual(before);
    await repository.close();
    (await database).close();
  });

  it('leaves live data intact when imported data fails migration validation', async () => {
    const { repository, database, backups } = await createServices();
    await repository.replaceDocument(populatedDocument());
    const before = await repository.readDocument(NOW);
    const invalid = { ...populatedDocument(), schemaVersion: 0 };
    const migrations = new Map([
      [0, () => ({ schemaVersion: 1, pages: 'broken' })],
    ]);

    expect(() => migrateDocument(invalid, migrations)).toThrow();
    await expect(backups.importData(invalid, 'replace')).rejects.toThrow();
    expect(await repository.readDocument(NOW)).toEqual(before);
    await repository.close();
    (await database).close();
  });

  it('exports the latest snapshot when a live record is corrupt', async () => {
    const { repository, database, backups } = await createServices();
    await repository.replaceDocument(populatedDocument());
    await backups.createSnapshot();
    const handle = await database;
    await handle.put('pages', { ...page, title: 42 } as never);

    const exported = await backups.exportData();

    expect(exported.source).toBe('snapshot');
    expect(exported.document).toEqual(populatedDocument());
    await repository.close();
    handle.close();
  });

  it('restores a valid snapshot even when live records are corrupt', async () => {
    const { repository, database, backups } = await createServices();
    await repository.replaceDocument(populatedDocument());
    const snapshot = await backups.createSnapshot();
    const handle = await database;
    await handle.put('cards', { ...card, url: 'not a URL' } as never);
    const corruptSettings = { ...SETTINGS_DEFAULTS, ownerName: 42 };
    await handle.put('meta', { key: 'settings', value: corruptSettings });

    await backups.restoreSnapshot(snapshot.id);

    expect(await repository.readDocument(NOW)).toEqual(populatedDocument());
    expect(await handle.get('meta', 'quarantine:settings:settings')).toEqual({
      key: 'quarantine:settings:settings',
      value: corruptSettings,
    });
    await repository.close();
    handle.close();
  });

  it('keeps only the seven newest automatic snapshots', async () => {
    const { repository, database, backups } = await createServices();
    await repository.replaceDocument(populatedDocument());
    for (let index = 0; index < 9; index += 1) await backups.createSnapshot();

    expect(await backups.listSnapshots()).toHaveLength(7);
    await repository.close();
    (await database).close();
  });

  it('merges only missing or newer records and reports skipped records', async () => {
    const { repository, database, backups } = await createServices();
    await repository.replaceDocument(populatedDocument());
    const importDocument = populatedDocument();
    importDocument.cards = [
      { ...card, updatedAt: NOW - 1, title: 'Older' },
      { ...card, id: 'card_002', title: 'New card' },
    ];

    expect(await backups.previewImport(importDocument, 'merge')).toEqual({
      pages: 0,
      decks: 0,
      cards: 1,
      skipped: 3,
    });
    await backups.importData(importDocument, 'merge');
    expect(
      (await repository.listCards()).map(({ title }) => title).sort(),
    ).toEqual(['Article', 'New card']);
    await repository.close();
    (await database).close();
  });
});

describe('migrateDocument - refusals', () => {
  it('refuses a document without an integer schemaVersion', () => {
    const document = populatedDocument();
    expect(() =>
      migrateDocument({ ...document, schemaVersion: undefined }),
    ).toThrow('Missing schemaVersion');
    expect(() => migrateDocument({ ...document, schemaVersion: 1.5 })).toThrow(
      'Missing schemaVersion',
    );
    expect(() => migrateDocument(null)).toThrow('Missing schemaVersion');
  });

  it('refuses an export from a newer Deck', () => {
    const newer = { ...populatedDocument(), schemaVersion: SCHEMA_VERSION + 1 };
    expect(() => migrateDocument(newer)).toThrow(
      'Export uses a newer schema version',
    );
  });

  it('refuses an old version that has no migration', () => {
    const old = { ...populatedDocument(), schemaVersion: 0 };
    expect(() => migrateDocument(old)).toThrow(
      'No migration from schema version 0',
    );
  });

  it('refuses a migration that does not advance exactly one version', () => {
    const old = { ...populatedDocument(), schemaVersion: 0 };
    const stuck = new Map([[0, (value: unknown) => value]]);
    expect(() => migrateDocument(old, stuck)).toThrow(
      'Migration 0 did not advance exactly one version',
    );
  });

  it('migrates a copy and never changes the value it was given', () => {
    const old = { ...populatedDocument(), schemaVersion: 0, legacy: true };
    const migrations = new Map([
      [
        0,
        (value: unknown) => {
          const { legacy: _legacy, ...rest } = value as typeof old;
          return { ...rest, schemaVersion: 1 };
        },
      ],
    ]);
    expect(migrateDocument(old, migrations)).toEqual(populatedDocument());
    expect(old).toMatchObject({ schemaVersion: 0, legacy: true });
  });
});

describe('BackupService - snapshots and export fallbacks', () => {
  it('keeps an independent snapshot and can export when IndexedDB cannot open', async () => {
    const values: Record<string, unknown> = {};
    const snapshotStorage = {
      get: async (key: string) => ({ [key]: values[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(values, items);
      },
    };
    const { repository, database } = await createServices();
    await repository.replaceDocument(populatedDocument());
    const backups = new BackupService(repository, database, {
      now: () => NOW,
      createId,
      snapshotStorage,
    });
    const snapshot = await backups.createSnapshot();
    const unavailable = new BackupService(
      {
        readDocument: async () => {
          throw new Error('database unavailable');
        },
      } as unknown as DeckRepository,
      Promise.reject(new Error('database unavailable')),
      { now: () => NOW, createId, snapshotStorage },
    );

    expect((await unavailable.exportData()).document).toEqual(
      populatedDocument(),
    );
    await unavailable.restoreToFreshDatabase(snapshot.id);
    const restoredName = values[ACTIVE_DATABASE_KEY];
    expect(restoredName).toMatch(/^deck-recovery-/);
    const restored = new DeckRepository({ databaseName: String(restoredName) });
    expect(await restored.readDocument(NOW)).toEqual(populatedDocument());

    await restored.close();
    await deleteDB(String(restoredName));
    await repository.close();
    (await database).close();
  });

  it('backfills the independent copy from a recent existing snapshot', async () => {
    const { repository, database, backups } = await createServices();
    await repository.replaceDocument(populatedDocument());
    const snapshot = await backups.createSnapshot();
    const values: Record<string, unknown> = {};
    const upgraded = new BackupService(repository, database, {
      now: () => NOW,
      snapshotStorage: {
        get: async (key) => ({ [key]: values[key] }),
        set: async (items) => {
          Object.assign(values, items);
        },
      },
    });

    expect(await upgraded.ensureDailySnapshot()).toBe(false);
    expect(values.deckLatestSnapshot).toEqual(snapshot);

    await repository.close();
    (await database).close();
  });

  it('keeps invalid records in quarantine while live export remains strict', async () => {
    const { repository, database } = await createServices();
    await repository.replaceDocument(populatedDocument());
    const handle = await database;
    const corrupt = { ...card, title: 42 };
    await handle.put('cards', corrupt as never);

    expect(await repository.listCards()).toEqual([]);
    expect(await repository.listCards()).toEqual([]);
    expect(repository.getRecoveryIssueCount()).toBe(1);
    expect(await handle.get('meta', `quarantine:cards:${card.id}`)).toEqual({
      key: `quarantine:cards:${card.id}`,
      value: corrupt,
    });
    await expect(repository.readDocument(NOW)).rejects.toThrow();

    await repository.close();
    handle.close();
  });

  function servicesWithClock(clock: { now: number }) {
    const repository = new DeckRepository({
      databaseName: DATABASE_NAME,
      createId,
    });
    const database = openDeckDatabase(DATABASE_NAME);
    const backups = new BackupService(repository, database, {
      now: () => clock.now,
      createId,
    });
    return { repository, database, backups };
  }

  it('takes at most one automatic snapshot per day', async () => {
    const clock = { now: NOW };
    const { repository, database, backups } = servicesWithClock(clock);
    await repository.replaceDocument(populatedDocument());

    expect(await backups.ensureDailySnapshot()).toBe(true);
    clock.now = NOW + SNAPSHOT_INTERVAL_MS - 1;
    expect(await backups.ensureDailySnapshot()).toBe(false);
    clock.now = NOW + SNAPSHOT_INTERVAL_MS;
    expect(await backups.ensureDailySnapshot()).toBe(true);
    expect(await backups.listSnapshots()).toHaveLength(2);
    await repository.close();
    (await database).close();
  });

  it('takes a fresh v2 snapshot after a v1 upgrade snapshot', async () => {
    const { repository, database, backups } = await createServices();
    await repository.replaceDocument(populatedDocument());
    const handle = await database;
    await handle.put('snapshots', {
      id: 'legacy_snapshot',
      ts: NOW,
      schemaVersion: 1,
      blob: JSON.stringify({ ...populatedDocument(), schemaVersion: 1 }),
    });

    expect(await backups.ensureDailySnapshot()).toBe(true);
    expect((await backups.listSnapshots())[0]?.schemaVersion).toBe(
      SCHEMA_VERSION,
    );
    await repository.close();
    handle.close();
  });

  it('skips a corrupt newest snapshot and exports the older valid one', async () => {
    const { repository, database, backups } = await createServices();
    await repository.replaceDocument(populatedDocument());
    await backups.createSnapshot();
    const handle = await database;
    await handle.put('snapshots', {
      id: 'snap_broken',
      ts: NOW + 1,
      schemaVersion: SCHEMA_VERSION,
      blob: '{"not":"a document"}',
    });
    await handle.put('snapshots', { id: 'snap_invalid', ts: NOW + 2 } as never);
    await handle.put('pages', { ...page, title: 42 } as never);

    const exported = await backups.exportData();

    expect(exported.source).toBe('snapshot');
    expect(exported.document).toEqual(populatedDocument());
    await repository.close();
    handle.close();
  });

  it('fails loudly, keeping every cause, when live data and all snapshots are corrupt', async () => {
    const { repository, database, backups } = await createServices();
    const handle = await database;
    await handle.put('snapshots', {
      id: 'snap_broken',
      ts: NOW,
      schemaVersion: SCHEMA_VERSION,
      blob: 'not json',
    });
    await handle.put('cards', { ...card, url: 'not a URL' } as never);

    const failure: unknown = await backups.exportData().then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    const { errors, cause } = failure as AggregateError;
    expect(errors).toHaveLength(2);
    expect(cause).toBe(errors[0]);
    await repository.close();
    handle.close();
  });

  it('refuses to restore a missing snapshot and leaves live data intact', async () => {
    const { repository, database, backups } = await createServices();
    await repository.replaceDocument(populatedDocument());
    await expect(backups.restoreSnapshot('snap_missing')).rejects.toThrow();
    expect(await repository.readDocument(NOW)).toEqual(populatedDocument());
    await repository.close();
    (await database).close();
  });
});

describe('BackupService - import', () => {
  it('clamps future created and updated timestamps during import', async () => {
    const { repository, database, backups } = await createServices();
    const future = NOW + SNAPSHOT_INTERVAL_MS;
    const incoming = {
      ...populatedDocument(),
      pages: [{ ...page, createdAt: future, updatedAt: future }],
      decks: [{ ...deck, createdAt: future, updatedAt: future }],
      cards: [{ ...card, createdAt: future, updatedAt: future }],
    };

    expect(await backups.previewImport(incoming, 'replace')).toMatchObject({
      pages: 1,
      decks: 1,
      cards: 1,
    });
    expect(incoming.cards[0]?.updatedAt).toBe(future);
    await backups.importData(incoming, 'replace');
    expect((await repository.listPages())[0]?.updatedAt).toBe(NOW);
    expect((await repository.listDecks())[0]?.createdAt).toBe(NOW);
    expect((await repository.listCards())[0]?.updatedAt).toBe(NOW);
    await repository.close();
    (await database).close();
  });

  it('previews a replace import as the incoming totals, writing nothing', async () => {
    const { repository, database, backups } = await createServices();
    await repository.replaceDocument(populatedDocument());
    expect(await backups.previewImport(emptyDocument(), 'replace')).toEqual({
      pages: 0,
      decks: 0,
      cards: 0,
      skipped: 0,
    });
    expect(await repository.listCards()).toEqual([card]);
    await repository.close();
    (await database).close();
  });

  it('merges newer pages and decks, takes the settings, and snapshots first', async () => {
    const { repository, database, backups } = await createServices();
    await repository.upsertPage(page);
    await repository.upsertDeck(deck);
    const incoming = populatedDocument();
    incoming.pages = [{ ...page, title: 'Renamed', updatedAt: NOW }];
    incoming.decks = [{ ...deck, title: 'Renamed deck', updatedAt: NOW }];

    const preview = await backups.importData(incoming, 'merge');

    expect(preview).toEqual({
      pages: 1,
      decks: 1,
      cards: 1,
      skipped: 0,
      snapshotId: expect.any(String),
    });
    expect((await repository.listPages())[0]?.title).toBe('Renamed');
    expect((await repository.listDecks())[0]?.title).toBe('Renamed deck');
    expect(await repository.listCards()).toEqual([card]);
    expect((await repository.getSettings()).ownerName).toBe('Kasra');
    const [snapshot] = await backups.listSnapshots();
    expect(snapshot && (JSON.parse(snapshot.blob) as unknown)).toMatchObject({
      pages: [page],
      cards: [],
    });
    await repository.close();
    (await database).close();
  });
});

describe('DeckRepository - edges', () => {
  it('returns a fresh copy of the default settings until some are saved', async () => {
    const { repository, database } = await createServices();
    const defaults = await repository.getSettings();
    expect(defaults).toEqual(SETTINGS_DEFAULTS);
    expect(defaults).not.toBe(SETTINGS_DEFAULTS);

    await repository.setSettings({ ...SETTINGS_DEFAULTS, ownerName: 'Kasra' });
    expect((await repository.getSettings()).ownerName).toBe('Kasra');
    await repository.close();
    (await database).close();
  });

  it('stores and reads back a wallpaper blob, and has none by default', async () => {
    const { repository, database } = await createServices();
    expect(await repository.getWallpaperBlob('local')).toBeNull();
    const wallpaper = new Blob(['pixels'], { type: 'image/png' });
    await repository.setWallpaperBlob('local', wallpaper);
    const stored = await repository.getWallpaperBlob('local');
    expect(stored).toBeInstanceOf(Blob);
    expect(await stored?.text()).toBe('pixels');
    await repository.close();
    (await database).close();
  });

  it('refuses a wallpaper that is not a Blob, on the way in and out', async () => {
    const { repository, database } = await createServices();
    await expect(
      repository.setWallpaperBlob('local', 'pixels' as unknown as Blob),
    ).rejects.toThrow('Wallpaper must be a Blob');
    const handle = await database;
    await handle.put('meta', { key: 'wallpaper:local', value: 'pixels' });
    await expect(repository.getWallpaperBlob('local')).rejects.toThrow(
      'Stored wallpaper is not a Blob',
    );
    await repository.close();
    handle.close();
  });

  it('writes a deck with its operation, and validates it first', async () => {
    const { repository, database } = await createServices();
    expect(await repository.upsertDeck(deck)).toEqual(deck);
    expect(await repository.listOps()).toMatchObject([
      { entity: 'deck', entityId: deck.id, kind: 'upsert' },
    ]);
    await expect(
      repository.upsertDeck({ ...deck, kind: 'bogus' } as never),
    ).rejects.toThrow();
    expect(await repository.listDecks()).toEqual([deck]);
    await repository.close();
    (await database).close();
  });

  it('writes pages, decks and cards in one batch', async () => {
    const { repository, database } = await createServices();
    await repository.upsertMany({
      pages: [page],
      decks: [deck],
      cards: [card],
    });
    expect(await repository.readDocument(NOW)).toMatchObject({
      pages: [page],
      decks: [deck],
      cards: [card],
    });
    expect(await repository.listOps()).toHaveLength(3);
    await repository.close();
    (await database).close();
  });

  it('refuses to trash or restore a record that does not exist', async () => {
    const { repository, database } = await createServices();
    await expect(repository.softDelete('card', 'card_missing')).rejects.toThrow(
      'Cannot delete missing card card_missing',
    );
    await expect(repository.restore('deck', 'deck_missing')).rejects.toThrow(
      'Cannot restore missing deck deck_missing',
    );
    expect(await repository.listOps()).toEqual([]);
    await repository.close();
    (await database).close();
  });

  it('defaults to random UUIDs and the real clock', async () => {
    const before = Date.now();
    const repository = new DeckRepository({ databaseName: DATABASE_NAME });
    const database = openDeckDatabase(DATABASE_NAME);
    const backups = new BackupService(repository, database);
    await repository.upsertMany({ cards: [card] });
    const snapshot = await backups.createSnapshot();
    const [op] = await repository.listOps();

    expect(snapshot.id).toMatch(UUID_PATTERN);
    expect(op?.id).toMatch(UUID_PATTERN);
    expect(snapshot.ts).toBeGreaterThanOrEqual(before);
    expect(op?.ts).toBeGreaterThanOrEqual(before);
    await repository.close();
    (await database).close();
  });
});
