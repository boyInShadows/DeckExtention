import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS, type Card, type Deck } from 'deck-schema';
import { DeckRepository } from './repository';
import { openDeckDatabase } from './database';
import { resolveResurface } from './resurface';

const DATABASE = 'deck-resurface-test';
const DAY_MS = 86_400_000;
const NOW = new Date(2026, 9, 17, 12).getTime();
let time = NOW;
let repository: DeckRepository;
const deck = (id: string, change: Partial<Deck> = {}): Deck => ({
  id,
  pageId: 'page_example',
  title: id,
  kind: 'normal',
  order: 'a0',
  color: null,
  isCollapsed: false,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  ...change,
});
const card = (id: string, change: Partial<Card> = {}): Card => ({
  id,
  deckId: 'deck_normal',
  title: id,
  url: `https://example.com/${id}`,
  hostname: 'example.com',
  pinned: false,
  order: 'a0',
  lastOpenedAt: null,
  createdAt: NOW - 61 * DAY_MS,
  updatedAt: 1,
  deletedAt: null,
  ...change,
});
beforeEach(async () => {
  time = NOW;
  repository = new DeckRepository({ databaseName: DATABASE, now: () => time });
  await repository.upsertMany({
    pages: [
      {
        id: 'page_example',
        title: 'Work',
        order: 'a0',
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      },
    ],
    decks: [
      deck('deck_normal'),
      deck('deck_session', { kind: 'session' }),
      deck('deck_deleted', { deletedAt: 1 }),
    ],
  });
});
afterEach(async () => {
  await repository.close();
  await deleteDB(DATABASE);
});

it('chooses only an old, unopened, unpinned, unreviewed web link in a live non-session deck', async () => {
  await repository.upsertMany({
    cards: [
      card('card_valid'),
      card('card_recent', { createdAt: NOW - 60 * DAY_MS }),
      card('card_opened', { lastOpenedAt: 1 }),
      card('card_pinned', { pinned: true }),
      card('card_session', { deckId: 'deck_session' }),
      card('card_deleted', { deletedAt: 1 }),
      card('card_parent', { deckId: 'deck_deleted' }),
      card('card_orphan', { deckId: 'deck_missing' }),
      card('card_internal', { url: 'chrome://settings/' }),
      card('card_reviewed', { reviewedAt: 1 }),
    ],
  });
  expect((await repository.getResurface()).card?.id).toBe('card_valid');
  const original = await repository.readDocument();
  await repository.replaceDocument(original);
  expect(await repository.readDocument()).toEqual(original);
});

it('locks one choice across concurrent tabs and never replaces it during the same day', async () => {
  await repository.upsertMany({
    cards: [card('card_first'), card('card_second')],
  });
  const other = new DeckRepository({ databaseName: DATABASE, now: () => time });
  try {
    const [first, second] = await Promise.all([
      repository.getResurface(),
      other.getResurface(),
    ]);
    expect(second).toEqual(first);
    if (!first.card) throw new Error('Missing daily card');
    await repository.trashCards([first.card.id]);
    expect((await other.getResurface()).card).toBeNull();
    time += DAY_MS;
    expect((await other.getResurface()).card?.id).not.toBe(first.card.id);
  } finally {
    await other.close();
  }
});

it('dismisses only today, keeps the saved record untouched and becomes available tomorrow', async () => {
  const saved = card('card_first');
  await repository.upsertCard(saved);
  const daily = await repository.getResurface();
  await repository.resolveResurface(saved, daily.day, 'dismiss');
  expect((await repository.getResurface()).card).toBeNull();
  expect(await repository.listCards()).toEqual([saved]);
  time = new Date(2026, 9, 18, 0).getTime();
  expect((await repository.getResurface()).card).toEqual(saved);
});

it('Keep records a review without pretending the link was opened, and export preserves that decision', async () => {
  const saved = card('card_first');
  await repository.upsertCard(saved);
  const daily = await repository.getResurface();
  await repository.resolveResurface(saved, daily.day, 'keep');
  const original = await repository.readDocument();
  expect(original.cards[0]).toMatchObject({
    reviewedAt: NOW,
    lastOpenedAt: null,
    deletedAt: null,
  });
  await repository.replaceDocument({ ...original, cards: [] });
  await repository.replaceDocument(original);
  expect(await repository.readDocument()).toEqual(original);
  time += DAY_MS;
  expect((await repository.getResurface()).card).toBeNull();
});

it('Trash is recoverable and Open stamps the fresh record without overwriting an intervening note edit', async () => {
  await repository.upsertCard(card('card_first'));
  const daily = await repository.getResurface();
  if (!daily.card) throw new Error('Missing daily card');
  await repository.upsertCard({ ...daily.card, note: 'New note' });
  expect(
    await repository.resolveResurface(daily.card, daily.day, 'open'),
  ).toMatchObject({ note: 'New note', lastOpenedAt: NOW });
  time += DAY_MS;
  await repository.upsertCard(card('card_second'));
  const next = await repository.getResurface();
  if (!next.card) throw new Error('Missing daily card');
  await repository.resolveResurface(next.card, next.day, 'trash');
  expect(
    (await repository.listCards()).find(({ id }) => id === next.card?.id)
      ?.deletedAt,
  ).toBe(time);
  await repository.restoreCards([next.card.id]);
  expect(
    (await repository.listCards()).find(({ id }) => id === next.card?.id)
      ?.deletedAt,
  ).toBeNull();
});

it('refuses changed URLs, stale dates, disabled access and already resolved actions without losing cards', async () => {
  const saved = card('card_first');
  await repository.upsertCard(saved);
  const daily = await repository.getResurface();
  await repository.upsertCard({ ...saved, url: 'https://changed.test/' });
  await expect(
    repository.resolveResurface(saved, daily.day, 'trash'),
  ).rejects.toThrow();
  await repository.upsertCard(saved);
  await expect(
    repository.resolveResurface(saved, '2026-10-16', 'trash'),
  ).rejects.toThrow();
  await repository.setSettings({ ...SETTINGS_DEFAULTS, showResurface: false });
  expect((await repository.getResurface()).card).toBeNull();
  await expect(
    repository.resolveResurface(saved, daily.day, 'trash'),
  ).rejects.toThrow();
  await repository.setSettings(SETTINGS_DEFAULTS);
  await repository.resolveResurface(saved, daily.day, 'dismiss');
  await expect(
    repository.resolveResurface(saved, daily.day, 'trash'),
  ).rejects.toThrow();
  expect(await repository.listCards()).toEqual([saved]);
});

it('reports malformed daily state and card data, preserving the underlying records', async () => {
  const database = await openDeckDatabase(DATABASE);
  try {
    await database.put('meta', { key: 'resurface', value: { day: 42 } });
    await expect(repository.getResurface()).rejects.toThrow();
    await database.delete('meta', 'resurface');
    const invalid = { ...card('card_first'), reviewedAt: -1 };
    await database.put('cards', invalid);
    await expect(repository.getResurface()).rejects.toThrow();
    expect(await database.get('cards', invalid.id)).toEqual(invalid);
  } finally {
    database.close();
  }
});

it('a failed operation preparation leaves the daily choice and original card intact', async () => {
  await repository.upsertCard(card('card_first'));
  const daily = await repository.getResurface();
  if (!daily.card) throw new Error('Missing daily card');
  const original = await repository.readDocument();
  const database = await openDeckDatabase(DATABASE);
  try {
    await expect(
      resolveResurface(database, daily.card, daily.day, 'trash', NOW, () => {
        throw new Error('Could not create operation');
      }),
    ).rejects.toThrow('Could not create operation');
    expect(await repository.getResurface()).toEqual(daily);
    expect(await repository.readDocument()).toEqual(original);
  } finally {
    database.close();
  }
});
