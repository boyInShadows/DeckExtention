import 'fake-indexeddb/auto';

import { INBOX_DECK_ID, type Card, type Deck, type Page } from 'deck-schema';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DeckRepository } from '../storage/repository';
import {
  addNoteToCard,
  captureTarget,
  saveToInbox,
  undoSave,
  type SaveResult,
} from './quickSave';

const NOW = 1_800_000_000_000;
const DATABASE_NAME = 'deck-quick-save-test';
let sequence = 0;
let repository: DeckRepository;

function createId(): string {
  sequence += 1;
  return `qs_${String(sequence).padStart(6, '0')}`;
}

const options = { now: () => NOW, createId };

const workPage: Page = {
  id: 'page_work',
  title: 'Work',
  order: 'a0',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

const docsDeck: Deck = {
  id: 'deck_docs',
  pageId: workPage.id,
  title: 'Docs',
  kind: 'normal',
  order: 'a0',
  color: null,
  isCollapsed: false,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

function card(overrides: Partial<Card>): Card {
  return {
    id: 'card_existing',
    deckId: docsDeck.id,
    url: 'https://example.com/docs',
    title: 'Docs',
    hostname: 'example.com',
    order: 'a0',
    pinned: false,
    lastOpenedAt: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  };
}

function savedCard(result: SaveResult): Card {
  if (result.kind !== 'saved')
    throw new Error(`expected saved, got ${result.kind}`);
  return result.card;
}

beforeEach(() => {
  sequence = 0;
  repository = new DeckRepository({ databaseName: DATABASE_NAME, ...options });
});

afterEach(async () => {
  await repository.close();
  await deleteDB(DATABASE_NAME);
});

describe('captureTarget', () => {
  it('keeps the tab title and derives the hostname without a network call', () => {
    expect(captureTarget('https://example.com/a?b=1', '  A page  ')).toEqual({
      url: 'https://example.com/a?b=1',
      hostname: 'example.com',
      title: 'A page',
    });
  });

  it('falls back to the hostname when the tab has no title', () => {
    expect(captureTarget('http://example.org/', '')?.title).toBe('example.org');
    expect(captureTarget('http://example.org/', undefined)?.title).toBe(
      'example.org',
    );
  });

  it('rejects pages Deck cannot save', () => {
    expect(captureTarget(undefined, 'x')).toBeNull();
    expect(captureTarget('chrome://settings', 'Settings')).toBeNull();
    expect(
      captureTarget('chrome-extension://abc/index.html', 'Deck'),
    ).toBeNull();
    expect(captureTarget('file:///C:/notes.txt', 'notes')).toBeNull();
    expect(captureTarget('not a url', 'x')).toBeNull();
  });

  it('clamps an oversized title to the schema limit', () => {
    const target = captureTarget('https://example.com/', 'x'.repeat(400));
    expect(target?.title).toHaveLength(300);
  });
});

describe('saveToInbox', () => {
  it('creates the Inbox on first save and lands the card in it', async () => {
    const result = await saveToInbox(
      repository,
      { url: 'https://example.com/', hostname: 'example.com', title: 'Ex' },
      options,
    );
    const saved = savedCard(result);
    expect(saved.deckId).toBe(INBOX_DECK_ID);
    const decks = await repository.listDecks();
    expect(decks).toEqual([
      expect.objectContaining({ id: INBOX_DECK_ID, kind: 'inbox' }),
    ]);
    // With no pages yet, the Inbox waits on the page the new tab will seed.
    expect(decks[0]?.pageId).toBe('page_examples');
    expect(await repository.listCards()).toEqual([saved]);
  });

  it('puts the Inbox on the first real page when one exists', async () => {
    await repository.upsertPage(workPage);
    await repository.upsertDeck(docsDeck);
    await saveToInbox(
      repository,
      { url: 'https://a.test/', hostname: 'a.test', title: 'A' },
      options,
    );
    const inbox = (await repository.listDecks()).find(
      (deck) => deck.kind === 'inbox',
    );
    expect(inbox?.pageId).toBe(workPage.id);
  });

  it('orders saves newest first without renumbering older cards', async () => {
    const first = savedCard(
      await saveToInbox(
        repository,
        { url: 'https://a.test/', hostname: 'a.test', title: 'A' },
        options,
      ),
    );
    const second = savedCard(
      await saveToInbox(
        repository,
        { url: 'https://b.test/', hostname: 'b.test', title: 'B' },
        options,
      ),
    );
    expect(second.order < first.order).toBe(true);
    const stored = await repository.listCards();
    expect(stored.find(({ id }) => id === first.id)?.order).toBe(first.order);
  });

  it('reports a duplicate with its page and deck instead of saving twice', async () => {
    await repository.upsertPage(workPage);
    await repository.upsertDeck(docsDeck);
    await repository.upsertCard(card({}));
    const result = await saveToInbox(
      repository,
      {
        url: 'https://example.com/docs',
        hostname: 'example.com',
        title: 'Docs',
      },
      options,
    );
    expect(result).toEqual({
      kind: 'duplicate',
      card: expect.objectContaining({ id: 'card_existing' }),
      pageId: workPage.id,
      location: 'Work › Docs',
    });
    expect(await repository.listCards()).toHaveLength(1);
  });

  it('points an Inbox duplicate at the Inbox page', async () => {
    const target = {
      url: 'https://a.test/',
      hostname: 'a.test',
      title: 'A',
    };
    await saveToInbox(repository, target, options);
    const result = await saveToInbox(repository, target, options);
    expect(result).toMatchObject({
      kind: 'duplicate',
      pageId: 'inbox',
      location: null,
    });
  });

  it('saves again when the earlier copy is trashed or its deck is', async () => {
    await repository.upsertPage(workPage);
    await repository.upsertDeck({ ...docsDeck, deletedAt: 5 });
    await repository.upsertCard(card({}));
    await repository.upsertCard(
      card({ id: 'card_trashed', deckId: INBOX_DECK_ID, deletedAt: 5 }),
    );
    const result = await saveToInbox(
      repository,
      {
        url: 'https://example.com/docs',
        hostname: 'example.com',
        title: 'Docs',
      },
      options,
    );
    expect(result.kind).toBe('saved');
  });

  it('writes every save to the oplog', async () => {
    await saveToInbox(
      repository,
      { url: 'https://a.test/', hostname: 'a.test', title: 'A' },
      options,
    );
    const ops = await repository.listOps();
    expect(ops.map((op) => `${op.entity}:${op.kind}`).toSorted()).toEqual([
      'card:upsert',
      'deck:upsert',
    ]);
  });
});

describe('toast follow-ups', () => {
  it('undo soft-deletes the saved card so it stays recoverable', async () => {
    const saved = savedCard(
      await saveToInbox(
        repository,
        { url: 'https://a.test/', hostname: 'a.test', title: 'A' },
        options,
      ),
    );
    await undoSave(repository, saved.id);
    const [stored] = await repository.listCards();
    expect(stored?.deletedAt).toBe(NOW);
  });

  it('adds a note to the current record, not the copy taken at save time', async () => {
    const saved = savedCard(
      await saveToInbox(
        repository,
        { url: 'https://a.test/', hostname: 'a.test', title: 'A' },
        options,
      ),
    );
    // Moved and pinned in the drawer while the toast was still open.
    const moved = await repository.upsertCard({
      ...saved,
      deckId: docsDeck.id,
      pinned: true,
    });
    const noted = await addNoteToCard(repository, saved.id, 'later', () => 9);
    expect(noted).toEqual({ ...moved, note: 'later', updatedAt: 9 });
  });

  it('refuses to note a card that was trashed meanwhile', async () => {
    const saved = savedCard(
      await saveToInbox(
        repository,
        { url: 'https://a.test/', hostname: 'a.test', title: 'A' },
        options,
      ),
    );
    await undoSave(repository, saved.id);
    await expect(addNoteToCard(repository, saved.id, 'x')).rejects.toThrow(
      'no longer in Deck',
    );
    await expect(addNoteToCard(repository, 'qs_missing', 'x')).rejects.toThrow(
      'no longer in Deck',
    );
  });
});
