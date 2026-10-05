import type { Card, Deck, Op, Page, Snapshot } from 'deck-schema';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export const DATABASE_NAME = 'deck';
export const DATABASE_VERSION = 1;

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

export function openDeckDatabase(
  name = DATABASE_NAME,
): Promise<DeckDatabaseHandle> {
  return openDB<DeckDatabase>(name, DATABASE_VERSION, {
    upgrade(database) {
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
    },
  });
}
