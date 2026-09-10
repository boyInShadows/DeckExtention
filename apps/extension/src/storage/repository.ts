import {
  CardSchema,
  DeckSchema,
  IdSchema,
  OpSchema,
  PageSchema,
  SETTINGS_DEFAULTS,
  SETTINGS_ENTITY_ID,
  SettingsSchema,
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
import { parseDocument, type DeckDocument } from './document';

const SETTINGS_KEY = 'settings';
const CLIENT_ID_KEY = 'clientId';
const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

type EntityRecord = Page | Deck | Card;
type EntityStore = Extract<
  StoreNames<DeckDatabase>,
  'pages' | 'decks' | 'cards'
>;

export interface RepositoryOptions {
  databaseName?: string;
  now?: () => number;
  createId?: () => string;
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

  constructor(options: RepositoryOptions = {}) {
    this.#database = openDeckDatabase(options.databaseName);
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? defaultId;
  }

  async close(): Promise<void> {
    (await this.#database).close();
  }

  async getSettings(): Promise<Settings> {
    const record = await (await this.#database).get('meta', SETTINGS_KEY);
    return record
      ? SettingsSchema.parse(record.value)
      : structuredClone(SETTINGS_DEFAULTS);
  }

  async setSettings(value: Settings): Promise<Settings> {
    const settings = SettingsSchema.parse(structuredClone(value));
    const database = await this.#database;
    const clientId = await this.#clientId();
    const transaction = database.transaction(['meta', 'ops'], 'readwrite');
    await transaction
      .objectStore('meta')
      .put({ key: SETTINGS_KEY, value: settings });
    await transaction
      .objectStore('ops')
      .put(
        this.#makeOp(
          clientId,
          'settings',
          SETTINGS_ENTITY_ID,
          'upsert',
          settings,
        ),
      );
    await transaction.done;
    return structuredClone(settings);
  }

  async upsertPage(value: Page): Promise<Page> {
    return this.#upsert('page', PageSchema.parse(structuredClone(value)));
  }

  async upsertDeck(value: Deck): Promise<Deck> {
    return this.#upsert('deck', DeckSchema.parse(structuredClone(value)));
  }

  async upsertCard(value: Card): Promise<Card> {
    return this.#upsert('card', CardSchema.parse(structuredClone(value)));
  }

  async listPages(): Promise<Page[]> {
    return PageSchema.array().parse(
      await (await this.#database).getAll('pages'),
    );
  }

  async listDecks(): Promise<Deck[]> {
    return DeckSchema.array().parse(
      await (await this.#database).getAll('decks'),
    );
  }

  async listCards(): Promise<Card[]> {
    return CardSchema.array().parse(
      await (await this.#database).getAll('cards'),
    );
  }

  async listOps(): Promise<Op[]> {
    return OpSchema.array().parse(await (await this.#database).getAll('ops'));
  }

  async readDocument(exportedAt = this.#now()): Promise<DeckDocument> {
    const [pages, decks, cards, settings] = await Promise.all([
      this.listPages(),
      this.listDecks(),
      this.listCards(),
      this.getSettings(),
    ]);
    return parseDocument({
      schemaVersion: 1,
      exportedAt,
      pages,
      decks,
      cards,
      settings,
    });
  }

  async replaceDocument(value: DeckDocument): Promise<void> {
    const document = parseDocument(structuredClone(value));
    const database = await this.#database;
    const clientId = await this.#clientId();
    const transaction = database.transaction(
      ['pages', 'decks', 'cards', 'meta', 'ops'],
      'readwrite',
    );
    const [oldPages, oldDecks, oldCards] = await Promise.all([
      transaction.objectStore('pages').getAll(),
      transaction.objectStore('decks').getAll(),
      transaction.objectStore('cards').getAll(),
    ]);
    await Promise.all([
      transaction.objectStore('pages').clear(),
      transaction.objectStore('decks').clear(),
      transaction.objectStore('cards').clear(),
    ]);
    for (const oldPage of oldPages) {
      await transaction
        .objectStore('ops')
        .put(this.#makeOp(clientId, 'page', oldPage.id, 'delete', null));
    }
    for (const oldDeck of oldDecks) {
      await transaction
        .objectStore('ops')
        .put(this.#makeOp(clientId, 'deck', oldDeck.id, 'delete', null));
    }
    for (const oldCard of oldCards) {
      await transaction
        .objectStore('ops')
        .put(this.#makeOp(clientId, 'card', oldCard.id, 'delete', null));
    }
    for (const page of document.pages) {
      await transaction.objectStore('pages').put(page);
      await transaction
        .objectStore('ops')
        .put(this.#makeOp(clientId, 'page', page.id, 'upsert', page));
    }
    for (const deck of document.decks) {
      await transaction.objectStore('decks').put(deck);
      await transaction
        .objectStore('ops')
        .put(this.#makeOp(clientId, 'deck', deck.id, 'upsert', deck));
    }
    for (const card of document.cards) {
      await transaction.objectStore('cards').put(card);
      await transaction
        .objectStore('ops')
        .put(this.#makeOp(clientId, 'card', card.id, 'upsert', card));
    }
    await transaction.objectStore('meta').put({
      key: SETTINGS_KEY,
      value: document.settings,
    });
    await transaction
      .objectStore('ops')
      .put(
        this.#makeOp(
          clientId,
          'settings',
          SETTINGS_ENTITY_ID,
          'upsert',
          document.settings,
        ),
      );
    await transaction.done;
  }

  async softDelete(
    entity: Exclude<OpEntity, 'settings'>,
    id: string,
  ): Promise<void> {
    await this.#changeDeletion(entity, id, this.#now(), 'delete');
  }

  async restore(
    entity: Exclude<OpEntity, 'settings'>,
    id: string,
  ): Promise<void> {
    await this.#changeDeletion(entity, id, null, 'restore');
  }

  async purge(cutoff = this.#now() - PURGE_AFTER_MS): Promise<number> {
    const database = await this.#database;
    let count = 0;
    for (const storeName of ['pages', 'decks', 'cards'] as const) {
      const transaction = database.transaction(storeName, 'readwrite');
      let cursor = await transaction.store.openCursor();
      while (cursor) {
        const { deletedAt } = cursor.value;
        if (deletedAt !== null && deletedAt <= cutoff) {
          await cursor.delete();
          count += 1;
        }
        cursor = await cursor.continue();
      }
      await transaction.done;
    }
    return count;
  }

  async #upsert<T extends EntityRecord>(
    entity: Exclude<OpEntity, 'settings'>,
    value: T,
  ): Promise<T> {
    const database = await this.#database;
    const storeName = storeFor(entity);
    const clientId = await this.#clientId();
    const transaction = database.transaction([storeName, 'ops'], 'readwrite');
    await transaction.objectStore(storeName).put(value);
    await transaction
      .objectStore('ops')
      .put(this.#makeOp(clientId, entity, value.id, 'upsert', value));
    await transaction.done;
    return structuredClone(value);
  }

  async #changeDeletion(
    entity: Exclude<OpEntity, 'settings'>,
    id: string,
    deletedAt: number | null,
    kind: 'delete' | 'restore',
  ): Promise<void> {
    const database = await this.#database;
    const storeName = storeFor(entity);
    const clientId = await this.#clientId();
    const transaction = database.transaction([storeName, 'ops'], 'readwrite');
    const existing = await transaction.objectStore(storeName).get(id);
    if (!existing) throw new Error(`Cannot ${kind} missing ${entity} ${id}`);
    const next = { ...existing, deletedAt, updatedAt: this.#now() };
    await transaction.objectStore(storeName).put(next);
    await transaction
      .objectStore('ops')
      .put(this.#makeOp(clientId, entity, id, kind, null));
    await transaction.done;
  }

  #makeOp(
    clientId: string,
    entity: OpEntity,
    entityId: string,
    kind: Op['kind'],
    payload: EntityRecord | Settings | null,
  ): Op {
    return OpSchema.parse({
      id: this.#createId(),
      ts: this.#now(),
      kind,
      clientId,
      entity,
      entityId,
      payload,
    });
  }

  async #clientId(): Promise<string> {
    const database = await this.#database;
    const existing = await database.get('meta', CLIENT_ID_KEY);
    if (existing) return IdSchema.parse(existing.value);
    const value = this.#createId();
    await database.put('meta', { key: CLIENT_ID_KEY, value });
    return value;
  }
}
