import type { Card, Deck, Op, Page, Snapshot } from 'deck-schema';
import { SETTINGS_DEFAULTS } from 'deck-schema/constants';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { migrateDocument } from './documentMigration';

export const DATABASE_NAME = 'deck';
export const DATABASE_VERSION = 3;
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
  version: number,
  validation: MigrationValidation,
): Promise<void> {
  const legacy = await openDB<DeckDatabase>(name, version, {
    blocking(_current, _next, event) {
      (event.target as IDBDatabase).close();
    },
  });
  try {
    const tx = legacy.transaction(['pages', 'decks', 'cards', 'meta']);
    const [pages, decks, cards, settings] = await Promise.all([
      tx.objectStore('pages').getAll(),
      tx.objectStore('decks').getAll(),
      tx.objectStore('cards').getAll(),
      tx.objectStore('meta').get('settings'),
    ]);
    await tx.done;
    const now = Date.now();
    const original = {
      schemaVersion: version,
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
      schemaVersion: version,
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
  if (![1, 2].includes(oldVersion) || !isPrepared)
    throw new Error('Database migration was not prepared');
  // v3 accepts existing link records unchanged. The version transaction commits
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
  if (version !== undefined && version > 0 && version < DATABASE_VERSION) {
    const validator = validation ?? (await import('./documentMigration'));
    try {
      await prepareMigration(selectedName, version, validator);
      isPrepared = true;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'VersionError'))
        throw error;
    }
  }
  return openDB<DeckDatabase>(selectedName, DATABASE_VERSION, {
    blocking(_current, _next, event) {
      (event.target as IDBDatabase).close();
    },
    upgrade(database, oldVersion) {
      upgradeDatabase(database, oldVersion, isPrepared);
    },
  });
}
