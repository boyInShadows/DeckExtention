import {
  CardSchema,
  DeckSchema,
  IdSchema,
  PageSchema,
  SETTINGS_ENTITY_ID,
  SettingsSchema,
  type Card,
  type Deck,
  type Op,
  type OpEntity,
  type Page,
  type Settings,
} from 'deck-schema';

import type { DeckDatabaseHandle } from './database';
import type { DeckDocument } from './document';

type MakeOp = (
  entity: OpEntity,
  id: string,
  kind: Op['kind'],
  payload: Page | Deck | Card | Settings | null,
) => Op;

export async function replaceDocument(
  database: DeckDatabaseHandle,
  document: DeckDocument,
  makeOp: MakeOp,
): Promise<void> {
  const transaction = database.transaction(
    ['pages', 'decks', 'cards', 'meta', 'ops'],
    'readwrite',
  );
  const groups = [
    {
      store: 'pages',
      entity: 'page',
      schema: PageSchema,
      old: await transaction.objectStore('pages').getAll(),
      next: document.pages,
    },
    {
      store: 'decks',
      entity: 'deck',
      schema: DeckSchema,
      old: await transaction.objectStore('decks').getAll(),
      next: document.decks,
    },
    {
      store: 'cards',
      entity: 'card',
      schema: CardSchema,
      old: await transaction.objectStore('cards').getAll(),
      next: document.cards,
    },
  ] as const;

  for (const { store, entity, schema, old, next } of groups) {
    for (const record of old) {
      if (!schema.safeParse(record).success) {
        await transaction.objectStore('meta').put({
          key: `quarantine:${store}:${record.id}`,
          value: record,
        });
      }
      if (IdSchema.safeParse(record.id).success) {
        await transaction
          .objectStore('ops')
          .put(makeOp(entity, record.id, 'delete', null));
      }
    }
    await transaction.objectStore(store).clear();
    for (const record of next) {
      await transaction.objectStore(store).put(record);
      await transaction
        .objectStore('ops')
        .put(makeOp(entity, record.id, 'upsert', record));
    }
  }
  const oldSettings = await transaction.objectStore('meta').get('settings');
  if (oldSettings && !SettingsSchema.safeParse(oldSettings.value).success) {
    await transaction.objectStore('meta').put({
      key: 'quarantine:settings:settings',
      value: oldSettings.value,
    });
  }
  await transaction.objectStore('meta').put({
    key: 'settings',
    value: document.settings,
  });
  await transaction
    .objectStore('ops')
    .put(makeOp('settings', SETTINGS_ENTITY_ID, 'upsert', document.settings));
  await transaction.done;
}
