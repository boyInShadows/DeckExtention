import 'fake-indexeddb/auto';

import type { Card } from 'deck-schema';
import { generateNKeysBetween } from 'fractional-indexing';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { panelStrings as strings } from '../i18n/panelStrings';
import { DeckRepository } from '../storage/repository';
import { markOpened, moveCards, pinCards, trashCards } from './inboxActions';

const DATABASE_NAME = 'deck-inbox-actions-test';
const NOW = 1_900_000_000_000;
const now = () => NOW;
let repository: DeckRepository;

const card = (id: string, deckId: string, order: string, extra = {}): Card => ({
  id,
  deckId,
  url: `https://${id}.test/`,
  title: id,
  hostname: `${id}.test`,
  order,
  pinned: false,
  lastOpenedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  ...extra,
});

function byId(cards: Card[], id: string): Card {
  const found = cards.find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

async function seed(cards: Card[]): Promise<Card[]> {
  for (const item of cards) await repository.upsertCard(item);
  return cards;
}

beforeEach(() => {
  repository = new DeckRepository({ databaseName: DATABASE_NAME });
});

afterEach(async () => {
  await repository.close();
  await deleteDB(DATABASE_NAME);
});

describe('moveCards', () => {
  it('appends to the target deck in list order, without renumbering it', async () => {
    const cards = await seed([
      card('card_in1', 'deck_inbox', 'a0'),
      card('card_in2', 'deck_inbox', 'a1'),
      card('card_dst', 'deck_docs0', 'a5'),
    ]);
    const next = await moveCards(
      repository,
      cards,
      ['card_in2', 'card_in1'],
      'deck_docs0',
      now,
    );
    const moved = next.filter(({ deckId }) => deckId === 'deck_docs0');
    const second = byId(moved, 'card_in2');
    const first = byId(moved, 'card_in1');
    expect(second.order > 'a5').toBe(true);
    expect(first.order > second.order).toBe(true);
    expect(next.find(({ id }) => id === 'card_dst')?.order).toBe('a5');
    expect(await repository.listCards()).toEqual(expect.arrayContaining(moved));
    expect(cards[0]?.deckId).toBe('deck_inbox');
  });

  it('ignores ids that are not in the list', async () => {
    const cards = await seed([card('card_in1', 'deck_inbox', 'a0')]);
    const next = await moveCards(
      repository,
      cards,
      ['card_gone'],
      'deck_docs0',
      now,
    );
    expect(next).toEqual(cards);
  });
});

describe('trashCards', () => {
  it('soft-deletes so every trashed card stays recoverable', async () => {
    const cards = await seed([
      card('card_in1', 'deck_inbox', 'a0'),
      card('card_in2', 'deck_inbox', 'a1'),
    ]);
    const next = await trashCards(repository, cards, ['card_in1'], now);
    expect(next.find(({ id }) => id === 'card_in1')?.deletedAt).toBe(NOW);
    const stored = await repository.listCards();
    expect(stored).toHaveLength(2);
    expect(
      stored.find(({ id }) => id === 'card_in1')?.deletedAt,
    ).not.toBeNull();
    expect(stored.find(({ id }) => id === 'card_in2')?.deletedAt).toBeNull();
  });
});

describe('pinCards', () => {
  it('pins after the last pin and moves the card out of the Inbox', async () => {
    const cards = await seed([
      card('card_pin', 'deck_home0', 'a8', { pinned: true }),
      card('card_in1', 'deck_inbox', 'a0'),
    ]);
    const next = await pinCards(
      repository,
      cards,
      ['card_in1'],
      'deck_home0',
      now,
    );
    expect(next.find(({ id }) => id === 'card_in1')).toMatchObject({
      pinned: true,
      deckId: 'deck_home0',
    });
    expect(byId(next, 'card_in1').order > 'a8').toBe(true);
  });

  it('refuses the whole batch past twelve pins and writes nothing', async () => {
    const pins = generateNKeysBetween(null, 'a0', 11).map((order, index) =>
      card(`card_pin${index}`, 'deck_home0', order, { pinned: true }),
    );
    const cards = await seed([
      ...pins,
      card('card_in1', 'deck_inbox', 'a1'),
      card('card_in2', 'deck_inbox', 'a2'),
    ]);
    await expect(
      pinCards(repository, cards, ['card_in1', 'card_in2'], 'deck_home0', now),
    ).rejects.toThrow(strings.pinLimitReached);
    const stored = await repository.listCards();
    expect(stored.filter(({ pinned }) => pinned)).toHaveLength(11);
  });

  it('skips cards that are already pinned', async () => {
    const cards = await seed([
      card('card_pin', 'deck_inbox', 'a0', { pinned: true }),
    ]);
    const next = await pinCards(
      repository,
      cards,
      ['card_pin'],
      'deck_home0',
      now,
    );
    expect(next).toEqual(cards);
  });
});

describe('markOpened', () => {
  it('stamps lastOpenedAt, which Resurface reads', async () => {
    const [item] = await seed([card('card_in1', 'deck_inbox', 'a0')]);
    if (!item) throw new Error('seed failed');
    const opened = await markOpened(repository, item, now);
    expect(opened).toEqual({ ...item, lastOpenedAt: NOW, updatedAt: NOW });
  });
});
