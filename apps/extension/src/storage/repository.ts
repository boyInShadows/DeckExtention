import {
  SCHEMA_VERSION,
  SETTINGS_DEFAULTS,
  SETTINGS_ENTITY_ID,
} from 'deck-schema/constants';
import {
  type Card,
  type Deck,
  type Op,
  type OpEntity,
  type Page,
  type Settings,
} from 'deck-schema';
import type { StoreNames } from 'idb';

import {
  openDeckDatabase,
  type DeckDatabase,
  type DeckDatabaseHandle,
} from './database';
import type { DeckDocument } from './document';
import type {
  parseCard,
  parseDeck,
  parseDocument,
  migrateDocument,
  parseOps,
  parsePage,
  parseSettings,
} from './writeValidation';
import {
  hydratedSettings,
  isCard,
  isDeck,
  isId,
  isPage,
  isSettings,
} from './hydrationValidation';
import type { purgeDeleted as PurgeDeletedFunction } from './trashMaintenance';
import type { expireSessions as ExpireSessionsFunction } from './sessionExpiry';
import type { markCardsOpened as MarkCardsOpenedFunction } from './cardOpened';

const SETTINGS_KEY = 'settings';
const CLIENT_ID_KEY = 'clientId';
const WALLPAPER_BLOB_PREFIX = 'wallpaper:';
const QUARANTINE_PREFIX = 'quarantine:';
const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
type PurgeDeleted = typeof PurgeDeletedFunction;
type ValidationModule = {
  parseCard: typeof parseCard;
  parseDeck: typeof parseDeck;
  parseDocument: typeof parseDocument;
  migrateDocument: typeof migrateDocument;
  parseOps: typeof parseOps;
  parsePage: typeof parsePage;
  parseSettings: typeof parseSettings;
};

type EntityRecord = Page | Deck | Card;
type EntityStore = Extract<
  StoreNames<DeckDatabase>,
  'pages' | 'decks' | 'cards'
>;

export interface RepositoryOptions {
  databaseName?: string;
  now?: () => number;
  createId?: () => string;
  validation?: ValidationModule;
}

function defaultId(): string {
  return crypto.randomUUID();
}

function storeFor(entity: Exclude<OpEntity, 'settings'>): EntityStore {
  return `${entity}s` as EntityStore;
}

export class DeckRepository {
  readonly #database: Promise<DeckDatabaseHandle>;
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #validationModule: RepositoryOptions['validation'];
  readonly #recoveryIssues = new Set<string>();

  constructor(options: RepositoryOptions = {}) {
    this.#database = openDeckDatabase(options.databaseName, options.validation);
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? defaultId;
    this.#validationModule = options.validation;
  }

  async #validation(): Promise<ValidationModule> {
    return this.#validationModule ?? import('./writeValidation');
  }

  async close(): Promise<void> {
    (await this.#database).close();
  }

  async getSettings(): Promise<Settings> {
    const record = await (await this.#database).get('meta', SETTINGS_KEY);
    if (!record) return structuredClone(SETTINGS_DEFAULTS);
    if (isSettings(record.value)) return hydratedSettings(record.value);
    await this.#quarantine('settings', SETTINGS_KEY, record.value);
    return structuredClone(SETTINGS_DEFAULTS);
  }

  getRecoveryIssueCount(): number {
    return this.#recoveryIssues.size;
  }

  async setSettings(value: Settings): Promise<Settings> {
    const { parseSettings } = await this.#validation();
    const settings = parseSettings(value);
    const database = await this.#database;
    const clientId = await this.#clientId();
    const op = this.#makeOp(
      clientId,
      'settings',
      SETTINGS_ENTITY_ID,
      'upsert',
      settings,
    );
    const transaction = database.transaction(['meta', 'ops'], 'readwrite');
    await transaction
      .objectStore('meta')
      .put({ key: SETTINGS_KEY, value: settings });
    await transaction.objectStore('ops').put(op);
    await transaction.done;
    return structuredClone(settings);
  }

  async getWallpaperBlob(key: string): Promise<Blob | null> {
    const record = await (
      await this.#database
    ).get('meta', `${WALLPAPER_BLOB_PREFIX}${key}`);
    if (!record) return null;
    if (!(record.value instanceof Blob))
      throw new Error('Stored wallpaper is not a Blob');
    return record.value;
  }

  async setWallpaperBlob(key: string, blob: Blob): Promise<void> {
    if (!(blob instanceof Blob)) throw new Error('Wallpaper must be a Blob');
    await (
      await this.#database
    ).put('meta', {
      key: `${WALLPAPER_BLOB_PREFIX}${key}`,
      value: blob,
    });
  }

  async upsertPage(value: Page): Promise<Page> {
    const { parsePage } = await this.#validation();
    return this.#upsert('page', parsePage(value));
  }

  async upsertDeck(value: Deck): Promise<Deck> {
    const { parseDeck } = await this.#validation();
    return this.#upsert('deck', parseDeck(value));
  }

  async upsertCard(value: Card): Promise<Card> {
    const { parseCard } = await this.#validation();
    return this.#upsert('card', parseCard(value));
  }

  /**
   * Many records in one transaction, one Op each - what a bulk import needs
   * to stay fast (FableTasks P2.S7: 1,000 bookmarks under 2 s). All or
   * nothing: one invalid record rejects the whole batch before any write.
   */
  async upsertMany(batch: {
    pages?: Page[];
    decks?: Deck[];
    cards?: Card[];
  }): Promise<void> {
    const { parsePage, parseDeck, parseCard } = await this.#validation();
    const records = [
      ...(batch.pages ?? []).map((page) => ({
        entity: 'page' as const,
        value: parsePage(page),
      })),
      ...(batch.decks ?? []).map((deck) => ({
        entity: 'deck' as const,
        value: parseDeck(deck),
      })),
      ...(batch.cards ?? []).map((card) => ({
        entity: 'card' as const,
        value: parseCard(card),
      })),
    ];
    if (records.length === 0) return;
    const database = await this.#database;
    const clientId = await this.#clientId();
    const prepared = records.map(({ entity, value }) => ({
      entity,
      value,
      op: this.#makeOp(clientId, entity, value.id, 'upsert', value),
    }));
    const transaction = database.transaction(
      ['pages', 'decks', 'cards', 'ops'],
      'readwrite',
    );
    const writes = prepared.flatMap(({ entity, value, op }) => [
      transaction.objectStore(storeFor(entity)).put(value),
      transaction.objectStore('ops').put(op),
    ]);
    await Promise.all([...writes, transaction.done]);
  }

  async listPages(): Promise<Page[]> {
    return this.#listValid('pages', isPage);
  }

  async listDecks(): Promise<Deck[]> {
    return this.#listValid('decks', isDeck);
  }

  async listCards(): Promise<Card[]> {
    return this.#listValid('cards', isCard);
  }

  async markCardsOpened(
    ids: string[],
    workerMark?: typeof MarkCardsOpenedFunction,
  ): Promise<void> {
    if (!ids.length) return;
    const mark = workerMark ?? (await import('./cardOpened')).markCardsOpened;
    const clientId = await this.#clientId();
    await mark(await this.#database, ids, this.#now(), (card) =>
      this.#makeOp(clientId, 'card', card.id, 'upsert', card),
    );
  }

  async listOps(): Promise<Op[]> {
    const { parseOps } = await this.#validation();
    return parseOps(await (await this.#database).getAll('ops'));
  }

  async readDocument(exportedAt = this.#now()): Promise<DeckDocument> {
    const { parseDocument } = await this.#validation();
    const database = await this.#database;
    const [pages, decks, cards, settingsRecord] = await Promise.all([
      database.getAll('pages'),
      database.getAll('decks'),
      database.getAll('cards'),
      database.get('meta', SETTINGS_KEY),
    ]);
    return parseDocument({
      schemaVersion: SCHEMA_VERSION,
      exportedAt,
      pages,
      decks,
      cards,
      settings: settingsRecord?.value ?? SETTINGS_DEFAULTS,
    });
  }

  async #listValid<T>(
    store: 'pages' | 'decks' | 'cards',
    isValid: (value: unknown) => value is T,
  ): Promise<T[]> {
    const database = await this.#database;
    const records = await database.getAll(store);
    const valid: T[] = [];
    for (const record of records) {
      if (isValid(record)) valid.push(record);
      else await this.#quarantine(store, record.id, record);
    }
    return valid;
  }

  async #quarantine(
    store: 'pages' | 'decks' | 'cards' | 'settings',
    key: string,
    value: unknown,
  ): Promise<void> {
    const quarantineKey = `${QUARANTINE_PREFIX}${store}:${key}`;
    this.#recoveryIssues.add(quarantineKey);
    await (await this.#database).put('meta', { key: quarantineKey, value });
  }

  async replaceDocument(value: DeckDocument): Promise<void> {
    const { parseDocument } = await this.#validation();
    const document = parseDocument(structuredClone(value));
    const database = await this.#database;
    const clientId = await this.#clientId();
    const { replaceDocument } = await import('./replaceDocument');
    await replaceDocument(database, document, (entity, id, kind, payload) =>
      this.#makeOp(clientId, entity, id, kind, payload),
    );
  }

  async softDelete(
    entity: Exclude<OpEntity, 'settings'>,
    id: string,
  ): Promise<void> {
    await this.#changeDeletion(entity, id, this.#now());
  }

  async restore(
    entity: Exclude<OpEntity, 'settings'>,
    id: string,
  ): Promise<void> {
    await this.#changeDeletion(entity, id, null);
  }

  async trashDeck(id: string): Promise<void> {
    await this.#changeTree('deck', id, false);
  }

  async restoreDeck(id: string): Promise<void> {
    await this.#changeTree('deck', id, true);
  }

  async trashPage(id: string): Promise<void> {
    await this.#changeTree('page', id, false);
  }

  async restorePage(id: string): Promise<void> {
    await this.#changeTree('page', id, true);
  }

  async trashCards(ids: string[]): Promise<Card[]> {
    return this.#changeCards(ids, false);
  }

  async restoreCards(ids: string[]): Promise<Card[]> {
    return this.#changeCards(ids, true);
  }

  async #changeCards(ids: string[], isRestore: boolean): Promise<Card[]> {
    const { changeCards } = await import('./trashWrites');
    const clientId = await this.#clientId();
    return changeCards(
      await this.#database,
      ids,
      isRestore,
      this.#now,
      (entity, id, kind) => this.#makeOp(clientId, entity, id, kind, null),
    );
  }

  async #changeTree(
    entity: 'page' | 'deck',
    id: string,
    isRestore: boolean,
  ): Promise<void> {
    const { changeTree } = await import('./trashWrites');
    const clientId = await this.#clientId();
    await changeTree(
      await this.#database,
      entity,
      id,
      isRestore,
      this.#now,
      (itemEntity, itemId, kind) =>
        this.#makeOp(clientId, itemEntity, itemId, kind, null),
    );
  }

  async purge(
    cutoff = this.#now() - PURGE_AFTER_MS,
    workerPurge?: PurgeDeleted,
  ): Promise<number> {
    const purgeDeleted =
      workerPurge ?? (await import('./trashMaintenance')).purgeDeleted;
    return purgeDeleted(
      await this.#database,
      cutoff,
      this.#now() - PURGE_AFTER_MS,
    );
  }

  async expireSessions(
    workerExpire?: typeof ExpireSessionsFunction,
  ): Promise<number> {
    const expire =
      workerExpire ?? (await import('./sessionExpiry')).expireSessions;
    const clientId = await this.#clientId();
    return expire(await this.#database, this.#now(), (entity, id) =>
      this.#makeOp(clientId, entity, id, 'delete', null),
    );
  }

  async #upsert<T extends EntityRecord>(
    entity: Exclude<OpEntity, 'settings'>,
    value: T,
  ): Promise<T> {
    const database = await this.#database;
    const storeName = storeFor(entity);
    const clientId = await this.#clientId();
    const op = this.#makeOp(clientId, entity, value.id, 'upsert', value);
    const transaction = database.transaction([storeName, 'ops'], 'readwrite');
    await transaction.objectStore(storeName).put(value);
    await transaction.objectStore('ops').put(op);
    await transaction.done;
    return structuredClone(value);
  }

  async #changeDeletion(
    entity: Exclude<OpEntity, 'settings'>,
    id: string,
    deletedAt: number | null,
  ): Promise<void> {
    const { changeDeletion } = await import('./trashWrites');
    const clientId = await this.#clientId();
    await changeDeletion(
      await this.#database,
      entity,
      id,
      deletedAt,
      this.#now,
      (itemEntity, itemId, itemKind) =>
        this.#makeOp(clientId, itemEntity, itemId, itemKind, null),
    );
  }

  #makeOp(
    clientId: string,
    entity: OpEntity,
    entityId: string,
    kind: Op['kind'],
    payload: EntityRecord | Settings | null,
  ): Op {
    const id = this.#createId();
    const ts = this.#now();
    if (
      !isId(id) ||
      !isId(clientId) ||
      !isId(entityId) ||
      !Number.isSafeInteger(ts) ||
      ts < 0 ||
      (kind === 'upsert' && payload === null)
    )
      throw new Error('Invalid operation');
    return {
      id,
      ts,
      kind,
      clientId,
      entity,
      entityId,
      payload,
    } as Op;
  }

  async #clientId(): Promise<string> {
    const database = await this.#database;
    const existing = await database.get('meta', CLIENT_ID_KEY);
    if (existing) {
      if (!isId(existing.value)) throw new Error('Stored client ID is invalid');
      return existing.value;
    }
    const value = this.#createId();
    if (!isId(value)) throw new Error('Generated client ID is invalid');
    await database.put('meta', { key: CLIENT_ID_KEY, value });
    return value;
  }
}
