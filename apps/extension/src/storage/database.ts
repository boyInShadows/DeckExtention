import type { Card, Deck, Op, Page, Snapshot } from 'deck-schema';
import { SETTINGS_DEFAULTS } from 'deck-schema/constants';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { migrateDocument } from './documentMigration';

export const DATABASE_NAME = 'deck';
export const DATABASE_VERSION = 2;
export const ACTIVE_DATABASE_KEY = 'deckDb';

export interface MetaRecord {
  key: string;
  value: unknown;
}

export interface DeckDatabase extends DBSchema {
  pages: { key: string; value: Page };
  decks: { key: string; value: Deck };
  cards: { key: string; value: Card };
  ops: { key: string; value: Op; indexes: { 'by-ts': number } };
  snapshots: {
    key: string;
    value: Snapshot;
    indexes: { 'by-ts': number };
  };
  meta: { key: string; value: MetaRecord };
}

export type DeckDatabaseHandle = IDBPDatabase<DeckDatabase>;
type MigrationValidation = { migrateDocument: typeof migrateDocument };

async function prepareMigration(
  name: string,
  validation: MigrationValidation,
): Promise<void> {
  const legacy = await openDB<DeckDatabase>(name, 1);
  try {
    const [pages, decks, cards, settings] = await Promise.all([
      legacy.getAll('pages'),
      legacy.getAll('decks'),
      legacy.getAll('cards'),
      legacy.get('meta', 'settings'),
    ]);
    const now = Date.now();
    const original = {
      schemaVersion: 1,
      exportedAt: now,
      pages,
      decks,
      cards,
      settings: settings?.value ?? SETTINGS_DEFAULTS,
    };
    validation.migrateDocument(original);
    const snapshot: Snapshot = {
      id: crypto.randomUUID(),
      ts: now,
      schemaVersion: 1,
      blob: JSON.stringify(original),
    };
    await legacy.put('snapshots', snapshot);
    if (typeof chrome !== 'undefined' && chrome.storage?.local)
      await chrome.storage.local.set({ deckLatestSnapshot: snapshot });
  } finally {
    legacy.close();
  }
}

function upgradeDatabase(
  database: DeckDatabaseHandle,
  oldVersion: number,
  isPrepared: boolean,
): void {
  if (oldVersion === 0) {
    database.createObjectStore('pages', { keyPath: 'id' });
    database.createObjectStore('decks', { keyPath: 'id' });
    database.createObjectStore('cards', { keyPath: 'id' });
    const ops = database.createObjectStore('ops', { keyPath: 'id' });
    ops.createIndex('by-ts', 'ts');
    const snapshots = database.createObjectStore('snapshots', {
      keyPath: 'id',
    });
    snapshots.createIndex('by-ts', 'ts');
    database.createObjectStore('meta', { keyPath: 'key' });
    return;
  }
  if (oldVersion !== 1 || !isPrepared)
    throw new Error('Database migration was not prepared');
  // v1 records already use the v2 shape. The version transaction commits
  // atomically without overwriting writes made since the snapshot.
}

export async function openDeckDatabase(
  name = DATABASE_NAME,
  validation?: MigrationValidation,
): Promise<DeckDatabaseHandle> {
  const activeName =
    name === DATABASE_NAME &&
    typeof chrome !== 'undefined' &&
    chrome.storage?.local
      ? (await chrome.storage.local.get(ACTIVE_DATABASE_KEY))[
          ACTIVE_DATABASE_KEY
        ]
      : undefined;
  if (
    activeName !== undefined &&
    (typeof activeName !== 'string' || !activeName.startsWith('deck-recovery-'))
  ) {
    throw new Error('Bad database');
  }
  const selectedName = activeName ?? name;
  const version = (await indexedDB.databases()).find(
    (entry) => entry.name === selectedName,
  )?.version;
  let isPrepared = false;
  if (version === 1) {
    const validator = validation ?? (await import('./documentMigration'));
    try {
      await prepareMigration(selectedName, validator);
      isPrepared = true;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'VersionError'))
        throw error;
    }
  }
  return openDB<DeckDatabase>(selectedName, DATABASE_VERSION, {
    upgrade(database, oldVersion) {
      upgradeDatabase(database, oldVersion, isPrepared);
    },
  });
}
