import 'fake-indexeddb/auto';

import type { Card } from 'deck-schema';
import { generateNKeysBetween } from 'fractional-indexing';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { panelStrings as strings } from '../i18n/panelStrings';
import { DeckRepository } from '../storage/repository';
import {
  markOpened,
  moveCards,
  openCard,
  pinCards,
  trashCards,
} from './inboxActions';

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
  repository = new DeckRepository({ databaseName: DATABASE_NAME, now });
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
    const next = await trashCards(repository, cards, ['card_in1']);
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
    const next = await pinCards(repository, cards, ['card_in1'], now);
    expect(next.find(({ id }) => id === 'card_in1')).toMatchObject({
      pinned: true,
      deckId: 'deck_inbox',
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
      pinCards(repository, cards, ['card_in1', 'card_in2'], now),
    ).rejects.toThrow(strings.pinLimitReached);
    const stored = await repository.listCards();
    expect(stored.filter(({ pinned }) => pinned)).toHaveLength(11);
  });

  it('skips cards that are already pinned', async () => {
    const cards = await seed([
      card('card_pin', 'deck_inbox', 'a0', { pinned: true }),
    ]);
    const next = await pinCards(repository, cards, ['card_pin'], now);
    expect(next).toEqual(cards);
  });
});

describe('markOpened', () => {
  it('preserves an intervening note edit and move when opening a stale card', async () => {
    const item = card('card_in1', 'deck_inbox', 'a0');
    await seed([item]);
    const edited = await repository.upsertCard({
      ...item,
      note: 'Newer note from another tab',
      deckId: 'deck_docs0',
      title: 'Edited title',
      order: 'a5',
    });

    const opened = await markOpened(repository, item);

    expect(opened).toEqual({ ...edited, lastOpenedAt: NOW, updatedAt: NOW });
    expect(await repository.listCards()).toEqual([opened]);
    expect(await repository.listOps()).toEqual(
      expect.arrayContaining([expect.objectContaining({ payload: opened })]),
    );
    expect(item.note).toBeUndefined();
  });

  it('stamps lastOpenedAt, which Resurface reads', async () => {
    const [item] = await seed([card('card_in1', 'deck_inbox', 'a0')]);
    if (!item) throw new Error('seed failed');
    const opened = await markOpened(repository, item);
    expect(opened).toEqual({ ...item, lastOpenedAt: NOW, updatedAt: NOW });
  });
});

describe('openCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubNavigation() {
    const open = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal('window', { open });
    vi.stubGlobal('location', { assign });
    return { open, assign };
  }

  it('opens the current stored URL without overwriting an intervening edit', async () => {
    const navigation = stubNavigation();
    const item = card('card_in1', 'deck_inbox', 'a0');
    await seed([item]);
    const edited = await repository.upsertCard({
      ...item,
      url: 'https://edited.test/',
      note: 'Keep this note',
    });

    expect(await openCard(repository, item, false)).toEqual({
      ...edited,
      lastOpenedAt: NOW,
      updatedAt: NOW,
    });
    expect(navigation.assign).toHaveBeenCalledWith(edited.url);
  });

  it('does not resurrect a card deleted since it was displayed', async () => {
    const navigation = stubNavigation();
    const item = card('card_in1', 'deck_inbox', 'a0');
    await seed([item]);
    await repository.softDelete('card', item.id);
    const before = await repository.listCards();
    const ops = await repository.listOps();

    await expect(openCard(repository, item, false)).rejects.toThrow();

    expect(await repository.listCards()).toEqual(before);
    expect(await repository.listOps()).toEqual(ops);
    expect(navigation.assign).not.toHaveBeenCalled();
    expect(navigation.open).not.toHaveBeenCalled();
  });

  it('revalidates a URL changed since the card was displayed', async () => {
    const navigation = stubNavigation();
    const item = card('card_in1', 'deck_inbox', 'a0');
    await seed([item]);
    await repository.upsertCard({ ...item, url: 'ftp://files.test/x' });

    await expect(openCard(repository, item, false)).rejects.toThrow(
      strings.invalidUrl,
    );
    expect(navigation.assign).not.toHaveBeenCalled();
    expect(navigation.open).not.toHaveBeenCalled();
    expect((await repository.listCards())[0]?.url).toBe('ftp://files.test/x');
  });

  it('does not recreate a missing card or navigate after a failed stamp', async () => {
    const navigation = stubNavigation();
    const item = card('card_in1', 'deck_inbox', 'a0');
    await expect(openCard(repository, item, true)).rejects.toThrow();
    expect(await repository.listCards()).toEqual([]);

    await seed([item]);
    vi.spyOn(repository, 'markCardsOpened').mockRejectedValueOnce(
      new Error('Disk failed'),
    );
    await expect(openCard(repository, item, true)).rejects.toThrow(
      'Disk failed',
    );
    expect((await repository.listCards())[0]?.lastOpenedAt).toBeNull();
    expect(navigation.assign).not.toHaveBeenCalled();
    expect(navigation.open).not.toHaveBeenCalled();
  });

  it('stamps lastOpenedAt, then opens the page in this tab', async () => {
    const navigation = stubNavigation();
    const [item] = await seed([card('card_in1', 'deck_inbox', 'a0')]);
    if (!item) throw new Error('seed failed');
    const opened = await openCard(repository, item, false);
    expect(opened.lastOpenedAt).toBe(NOW);
    expect(navigation.assign).toHaveBeenCalledWith(item.url);
    expect(navigation.open).not.toHaveBeenCalled();
    expect(
      (await repository.listCards()).find(({ id }) => id === item.id)
        ?.lastOpenedAt,
    ).toBe(NOW);
  });

  it('opens a new tab without giving the page a handle back', async () => {
    const navigation = stubNavigation();
    const [item] = await seed([card('card_in1', 'deck_inbox', 'a0')]);
    if (!item) throw new Error('seed failed');
    await openCard(repository, item, true);
    expect(navigation.open).toHaveBeenCalledWith(
      item.url,
      '_blank',
      'noopener',
    );
    expect(navigation.assign).not.toHaveBeenCalled();
  });

  it('refuses a non-web URL before writing or navigating anything', async () => {
    const navigation = stubNavigation();
    const [item] = await seed([
      card('card_js', 'deck_inbox', 'a0', { url: 'ftp://files.test/x' }),
    ]);
    if (!item) throw new Error('seed failed');
    await expect(openCard(repository, item, false)).rejects.toThrow(
      strings.invalidUrl,
    );
    expect(navigation.assign).not.toHaveBeenCalled();
    expect((await repository.listCards())[0]?.lastOpenedAt).toBeNull();
  });
});
