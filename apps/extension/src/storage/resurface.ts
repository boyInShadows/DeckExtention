import {
  CardSchema,
  DeckSchema,
  PageSchema,
  SettingsSchema,
  SETTINGS_DEFAULTS,
  IdSchema,
  type Card,
  type Deck,
  type Page,
  type Op,
} from 'deck-schema';
import { z } from 'zod';
import type { IDBPTransaction } from 'idb';
import type { DeckDatabase, DeckDatabaseHandle } from './database';
import { panelStrings as strings } from '../i18n/panelStrings';

const DAILY_KEY = 'resurface';
const DAY_MS = 86_400_000;
const MIN_AGE_MS = 60 * DAY_MS;
const STORES = ['meta', 'pages', 'decks', 'cards', 'ops'] as const;
const DailySchema = z.strictObject({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cardId: IdSchema.nullable(),
  isDismissed: z.boolean(),
});
type Transaction = IDBPTransaction<DeckDatabase, typeof STORES, 'readwrite'>;
export type ResurfaceAction = 'keep' | 'trash' | 'open' | 'dismiss';
export interface DailyResurface {
  day: string;
  card: Card | null;
}

export function localDay(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function readWorkspace(tx: Transaction, time: number) {
  const [rawPages, rawDecks, rawCards, rawSettings, rawDaily] =
    await Promise.all([
      tx.objectStore('pages').getAll(),
      tx.objectStore('decks').getAll(),
      tx.objectStore('cards').getAll(),
      tx.objectStore('meta').get('settings'),
      tx.objectStore('meta').get(DAILY_KEY),
    ]);
  const pages = z.array(PageSchema).parse(rawPages);
  const decks = z.array(DeckSchema).parse(rawDecks);
  const cards = z.array(CardSchema).parse(rawCards);
  const settings = SettingsSchema.parse(
    rawSettings?.value ?? SETTINGS_DEFAULTS,
  );
  const daily = rawDaily ? DailySchema.parse(rawDaily.value) : null;
  return {
    eligible: eligibleCards(cards, decks, pages, time),
    daily,
    isEnabled: settings.showResurface,
  };
}

function eligibleCards(
  cards: Card[],
  decks: Deck[],
  pages: Page[],
  time: number,
): Card[] {
  const livePages = new Set(
    pages.filter((page) => page.deletedAt === null).map((page) => page.id),
  );
  const liveDecks = new Set(
    decks
      .filter(
        (deck) =>
          deck.deletedAt === null &&
          deck.kind !== 'session' &&
          livePages.has(deck.pageId),
      )
      .map((deck) => deck.id),
  );
  return cards
    .filter(
      (card) =>
        card.deletedAt === null &&
        card.createdAt < time - MIN_AGE_MS &&
        card.lastOpenedAt === null &&
        card.reviewedAt === undefined &&
        !card.pinned &&
        liveDecks.has(card.deckId) &&
        /^https?:\/\//i.test(card.url),
    )
    .toSorted((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export async function getResurface(
  database: DeckDatabaseHandle,
  time: number,
): Promise<DailyResurface> {
  const tx = database.transaction(STORES, 'readwrite');
  const { eligible, daily: stored, isEnabled } = await readWorkspace(tx, time);
  const day = localDay(time);
  if (!isEnabled) {
    await tx.done;
    return { day, card: null };
  }
  const date = new Date(time);
  const ordinal = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS,
  );
  const daily =
    stored?.day === day
      ? stored
      : {
          day,
          cardId: eligible.length
            ? (eligible[ordinal % eligible.length]?.id ?? null)
            : null,
          isDismissed: false,
        };
  if (stored?.day !== day)
    await tx.objectStore('meta').put({ key: DAILY_KEY, value: daily });
  await tx.done;
  return {
    day,
    card: daily.isDismissed
      ? null
      : (eligible.find((card) => card.id === daily.cardId) ?? null),
  };
}

function resolvedCard(card: Card, action: ResurfaceAction, time: number): Card {
  if (action === 'dismiss') return card;
  return CardSchema.parse({
    ...card,
    updatedAt: time,
    ...(action === 'keep'
      ? { reviewedAt: time }
      : action === 'trash'
        ? { deletedAt: time }
        : { lastOpenedAt: time }),
  });
}

export async function resolveResurface(
  database: DeckDatabaseHandle,
  selected: Pick<Card, 'id' | 'url'>,
  day: string,
  action: ResurfaceAction,
  time: number,
  makeOp: (card: Card) => Op,
): Promise<Card> {
  const tx = database.transaction(STORES, 'readwrite');
  const { eligible, daily, isEnabled } = await readWorkspace(tx, time);
  const card = eligible.find((item) => item.id === selected.id);
  if (
    !isEnabled ||
    !daily ||
    daily.isDismissed ||
    day !== localDay(time) ||
    daily.day !== day ||
    daily.cardId !== selected.id ||
    !card ||
    card.url !== selected.url
  )
    throw new Error(strings.resurfaceChanged);
  const next = resolvedCard(card, action, time);
  const op = action === 'dismiss' ? null : makeOp(next);
  const writes = [
    tx
      .objectStore('meta')
      .put({ key: DAILY_KEY, value: { ...daily, isDismissed: true } }),
  ];
  if (op) {
    writes.push(tx.objectStore('cards').put(next));
    writes.push(tx.objectStore('ops').put(op));
  }
  await Promise.all([...writes, tx.done]);
  return next;
}
