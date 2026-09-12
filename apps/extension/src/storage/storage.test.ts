import 'fake-indexeddb/auto';

import {
  SETTINGS_DEFAULTS,
  type Card,
  type Deck,
  type Page,
} from 'deck-schema';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BackupService, migrateDocument } from './backup';
import { openDeckDatabase } from './database';
import { parseDocument, type DeckDocument } from './document';
import { DeckRepository } from './repository';

const NOW = 1_800_000_000_000;
const DATABASE_NAME = 'deck-storage-test';
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
    schemaVersion: 1,
    exportedAt: NOW,
    pages: [page],
    decks: [deck],
    cards: [card],
    settings: { ...SETTINGS_DEFAULTS, ownerName: 'Kasra' },
  });
}

function emptyDocument(): DeckDocument {
  return parseDocument({
    schemaVersion: 1,
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

beforeEach(() => {
  idSequence = 0;
});

afterEach(async () => {
  const database = await openDeckDatabase(DATABASE_NAME);
  database.close();
  await deleteDB(DATABASE_NAME);
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
});

describe('BackupService', () => {
  it('round-trips export, wipe, and replace import without losing data', async () => {
    const { repository, database, backups } = await createServices();
    await repository.replaceDocument(populatedDocument());
    const original = await backups.exportData();

    await repository.replaceDocument(emptyDocument());
    await backups.importData(JSON.parse(original.json) as unknown, 'replace');

    expect((await backups.exportData()).document).toEqual(original.document);
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

    await backups.restoreSnapshot(snapshot.id);

    expect(await repository.readDocument(NOW)).toEqual(populatedDocument());
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
