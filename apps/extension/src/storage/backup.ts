import {
  SCHEMA_VERSION,
  SnapshotSchema,
  type Card,
  type Deck,
  type Page,
  type Snapshot,
} from 'deck-schema';

import { ACTIVE_DATABASE_KEY, type DeckDatabaseHandle } from './database';
import {
  parseDocument,
  serializeDocument,
  type DeckDocument,
} from './document';
import { migrateDocument } from './documentMigration';
export { migrateDocument } from './documentMigration';
import { DeckRepository } from './repository';

const SNAPSHOT_RETENTION = 7;
const INDEPENDENT_SNAPSHOT_KEY = 'deckLatestSnapshot';
export const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type ImportMode = 'merge' | 'replace';

export interface ImportPreview {
  pages: number;
  decks: number;
  cards: number;
  skipped: number;
}

export interface ImportResult extends ImportPreview {
  snapshotId: string;
}

export interface ExportResult {
  document: DeckDocument;
  json: string;
  source: 'live' | 'snapshot';
}

export interface BackupOptions {
  now?: () => number;
  createId?: () => string;
  snapshotStorage?: {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  } | null;
}

export class BackupService {
  readonly #repository: DeckRepository;
  readonly #database: Promise<DeckDatabaseHandle>;
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #snapshotStorage: BackupOptions['snapshotStorage'];

  constructor(
    repository: DeckRepository,
    database: Promise<DeckDatabaseHandle>,
    options: BackupOptions = {},
  ) {
    this.#repository = repository;
    this.#database = database;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#snapshotStorage =
      options.snapshotStorage === undefined
        ? typeof chrome !== 'undefined'
          ? chrome.storage?.local
          : null
        : options.snapshotStorage;
  }

  async createSnapshot(): Promise<Snapshot> {
    const document = await this.#repository.readDocument(this.#now());
    const snapshot = SnapshotSchema.parse({
      id: this.#createId(),
      ts: this.#now(),
      schemaVersion: SCHEMA_VERSION,
      blob: serializeDocument(document),
    });
    const database = await this.#database;
    await database.put('snapshots', snapshot);
    await this.#trimSnapshots(database);
    await this.#snapshotStorage?.set({ [INDEPENDENT_SNAPSHOT_KEY]: snapshot });
    return structuredClone(snapshot);
  }

  async ensureDailySnapshot(): Promise<boolean> {
    const latest = await this.#latestSnapshots();
    const valid = latest.find((snapshot) => {
      if (snapshot.schemaVersion !== SCHEMA_VERSION) return false;
      try {
        migrateDocument(JSON.parse(snapshot.blob) as unknown);
        return true;
      } catch {
        return false;
      }
    });
    if (valid && this.#now() - valid.ts < SNAPSHOT_INTERVAL_MS) {
      await this.#snapshotStorage?.set({ [INDEPENDENT_SNAPSHOT_KEY]: valid });
      return false;
    }
    await this.createSnapshot();
    return true;
  }

  async listSnapshots(): Promise<Snapshot[]> {
    return (await this.#latestSnapshots()).map((snapshot) =>
      structuredClone(snapshot),
    );
  }

  async restoreSnapshot(id: string): Promise<void> {
    const snapshot = (await this.#latestSnapshots()).find(
      (item) => item.id === id,
    );
    if (!snapshot) throw new Error('Snapshot not found');
    const document = migrateDocument(JSON.parse(snapshot.blob) as unknown);
    await this.#repository.replaceDocument(document);
  }

  async restoreToFreshDatabase(id: string): Promise<void> {
    if (!this.#snapshotStorage)
      throw new Error('Independent snapshot storage is unavailable');
    const snapshot = (await this.#latestSnapshots()).find(
      (item) => item.id === id,
    );
    if (!snapshot) throw new Error('Snapshot not found');
    const document = migrateDocument(JSON.parse(snapshot.blob) as unknown);
    const name = `deck-recovery-${this.#createId()}`;
    const repository = new DeckRepository({ databaseName: name });
    try {
      await repository.replaceDocument(document);
      await this.#snapshotStorage.set({ [ACTIVE_DATABASE_KEY]: name });
    } finally {
      await repository.close();
    }
  }

  async exportData(): Promise<ExportResult> {
    try {
      const document = await this.#repository.readDocument(this.#now());
      return { document, json: serializeDocument(document), source: 'live' };
    } catch (liveError) {
      let snapshots: Snapshot[];
      try {
        snapshots = await this.#latestSnapshots();
      } catch (snapshotAccessError) {
        throw new AggregateError(
          [liveError, snapshotAccessError],
          'Live data and snapshots cannot be read',
          { cause: snapshotAccessError },
        );
      }
      const failures: unknown[] = [liveError];
      for (const snapshot of snapshots) {
        try {
          const document = migrateDocument(
            JSON.parse(snapshot.blob) as unknown,
          );
          return {
            document,
            json: serializeDocument(document),
            source: 'snapshot',
          };
        } catch (snapshotError) {
          failures.push(snapshotError);
        }
      }
      throw new AggregateError(
        failures,
        'Live data is corrupt and no valid snapshot exists',
        { cause: liveError },
      );
    }
  }

  previewImport(value: unknown, mode: ImportMode): Promise<ImportPreview> {
    const incoming = normalizeImportedTimestamps(
      migrateDocument(value),
      this.#now(),
    );
    return this.#preview(incoming, mode);
  }

  async importData(value: unknown, mode: ImportMode): Promise<ImportResult> {
    const incoming = normalizeImportedTimestamps(
      migrateDocument(value),
      this.#now(),
    );
    const preview = await this.#preview(incoming, mode);
    const snapshot = await this.createSnapshot();
    if (mode === 'replace') {
      await this.#repository.replaceDocument(incoming);
      return { ...preview, snapshotId: snapshot.id };
    }
    await this.#merge(incoming);
    await this.#repository.setSettings(incoming.settings);
    return { ...preview, snapshotId: snapshot.id };
  }

  async #preview(
    document: DeckDocument,
    mode: ImportMode,
  ): Promise<ImportPreview> {
    if (mode === 'replace') {
      return {
        pages: document.pages.length,
        decks: document.decks.length,
        cards: document.cards.length,
        skipped: 0,
      };
    }
    const [pages, decks, cards] = await Promise.all([
      this.#repository.listPages(),
      this.#repository.listDecks(),
      this.#repository.listCards(),
    ]);
    const pageCount = countMerge(document.pages, pages);
    const deckCount = countMerge(document.decks, decks);
    const cardCount = countMerge(document.cards, cards);
    return {
      pages: pageCount.changed,
      decks: deckCount.changed,
      cards: cardCount.changed,
      skipped: pageCount.skipped + deckCount.skipped + cardCount.skipped,
    };
  }

  async #merge(document: DeckDocument): Promise<void> {
    const [pages, decks, cards] = await Promise.all([
      this.#repository.listPages(),
      this.#repository.listDecks(),
      this.#repository.listCards(),
    ]);
    for (const page of selectNewer(document.pages, pages)) {
      await this.#repository.upsertPage(page);
    }
    for (const deck of selectNewer(document.decks, decks)) {
      await this.#repository.upsertDeck(deck);
    }
    for (const card of selectNewer(document.cards, cards)) {
      await this.#repository.upsertCard(card);
    }
  }

  async #latestSnapshots(): Promise<Snapshot[]> {
    let values: unknown[] = [];
    let databaseError: unknown;
    try {
      const database = await this.#database;
      values = await database.getAllFromIndex('snapshots', 'by-ts');
    } catch (error) {
      databaseError = error;
    }
    if (this.#snapshotStorage) {
      try {
        const stored = await this.#snapshotStorage.get(
          INDEPENDENT_SNAPSHOT_KEY,
        );
        if (stored[INDEPENDENT_SNAPSHOT_KEY])
          values = [...values, stored[INDEPENDENT_SNAPSHOT_KEY]];
      } catch (error) {
        if (databaseError)
          throw new AggregateError(
            [databaseError, error],
            'Neither snapshot store can be read',
            { cause: error },
          );
      }
    }
    if (databaseError && values.length === 0) throw databaseError;
    return values
      .map((value) => SnapshotSchema.safeParse(value))
      .filter((result) => result.success)
      .map((result) => result.data)
      .filter(
        (snapshot, index, snapshots) =>
          snapshots.findIndex((item) => item.id === snapshot.id) === index,
      )
      .toSorted((a, b) => b.ts - a.ts);
  }

  async #trimSnapshots(database: DeckDatabaseHandle): Promise<void> {
    const snapshots = await this.#latestSnapshots();
    const expired = snapshots.slice(SNAPSHOT_RETENTION);
    const transaction = database.transaction('snapshots', 'readwrite');
    await Promise.all(expired.map(({ id }) => transaction.store.delete(id)));
    await transaction.done;
  }
}

function normalizeImportedTimestamps(
  document: DeckDocument,
  now: number,
): DeckDocument {
  const normalize = <T extends Page | Deck | Card>(records: T[]): T[] =>
    records.map((record) => ({
      ...record,
      createdAt: Math.min(record.createdAt, now),
      updatedAt: Math.min(record.updatedAt, now),
    }));
  return parseDocument({
    ...document,
    pages: normalize(document.pages),
    decks: normalize(document.decks),
    cards: normalize(document.cards),
  });
}

function selectNewer<T extends Page | Deck | Card>(
  incoming: T[],
  existing: T[],
): T[] {
  const current = new Map(existing.map((record) => [record.id, record]));
  return incoming.filter((record) => {
    const match = current.get(record.id);
    return !match || record.updatedAt > match.updatedAt;
  });
}

function countMerge<T extends Page | Deck | Card>(
  incoming: T[],
  existing: T[],
): { changed: number; skipped: number } {
  const changed = selectNewer(incoming, existing).length;
  return { changed, skipped: incoming.length - changed };
}
