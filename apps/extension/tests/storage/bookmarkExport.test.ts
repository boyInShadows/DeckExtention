// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import {
  SCHEMA_VERSION,
  SETTINGS_DEFAULTS,
  type Card,
  type Deck,
  type Page,
} from 'deck-schema';
import { describe, expect, it } from 'vitest';
import { serializeBookmarks } from '../../src/storage/bookmarkExport';
import { BackupService } from '../../src/storage/backup';
import { openDeckDatabase } from '../../src/storage/database';
import { DeckRepository } from '../../src/storage/repository';
import type { DeckDocument } from '../../src/storage/document';

const base = { createdAt: 1000, updatedAt: 1000, deletedAt: null };
const page: Page = {
  ...base,
  id: 'page_001',
  title: 'Work <&> فارسی',
  order: 'a0',
};
const deck: Deck = {
  ...base,
  id: 'deck_001',
  pageId: page.id,
  title: 'Read "later"',
  order: 'a0',
  kind: 'normal',
  color: null,
  isCollapsed: false,
  note: 'PRIVATE DECK NOTE',
};
const card: Card = {
  ...base,
  id: 'card_001',
  deckId: deck.id,
  title: '<script>alert("x")</script> & \'read\'',
  url: 'https://example.com/?a=1&b="quoted"',
  hostname: 'example.com',
  order: 'a0',
  pinned: true,
  lastOpenedAt: null,
  note: 'PRIVATE CARD NOTE',
};
function fixture(): DeckDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: 1000,
    pages: [page],
    decks: [deck],
    cards: [card],
    settings: SETTINGS_DEFAULTS,
  };
}
function parse(html: string) {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('Netscape bookmark export', () => {
  it('round-trips escaped titles/URLs and nested manual order without mutating records', () => {
    const input = fixture();
    input.pages = [
      { ...page, id: 'page_002', title: 'Second', order: 'a1' },
      page,
    ];
    input.decks = [
      { ...deck, id: 'deck_002', title: 'Second deck', order: 'a1' },
      deck,
    ];
    input.cards = [
      { ...card, id: 'card_002', title: 'Second link', order: 'a1' },
      card,
    ];
    const before = structuredClone(input);
    const html = serializeBookmarks(input);
    const output = parse(html);
    expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    expect(output.querySelectorAll('script')).toHaveLength(0);
    expect(
      [...output.querySelectorAll('h3')].map((node) => node.textContent),
    ).toEqual([page.title, deck.title, 'Second deck', 'Second']);
    expect(
      [...output.querySelectorAll('a')].map((node) => [
        node.textContent,
        node.getAttribute('href'),
      ]),
    ).toEqual([
      [card.title, card.url],
      ['Second link', card.url],
    ]);
    expect(
      output.querySelector('a')?.closest('dl')?.previousElementSibling
        ?.textContent,
    ).toBe(deck.title);
    expect(html).not.toContain('PRIVATE');
    expect(input).toEqual(before);
  });

  it('excludes trash and URL-free tasks, includes linked tasks once, and keeps empty folders', () => {
    const input = fixture();
    input.pages.push({ ...page, id: 'page_trash', deletedAt: 1001 });
    input.decks.push(
      { ...deck, id: 'deck_trash', deletedAt: 1001 },
      { ...deck, id: 'deck_hidden', pageId: 'page_trash' },
    );
    input.cards.push(
      { ...card, id: 'card_trash', deletedAt: 1001 },
      { ...card, id: 'card_hidden', deckId: 'deck_trash' },
      { ...card, id: 'card_parent', deckId: 'deck_hidden' },
      {
        ...card,
        id: 'task_plain',
        kind: 'task',
        url: undefined,
        pinned: false,
      },
      {
        ...card,
        id: 'task_linked',
        kind: 'task',
        title: 'Linked task',
        pinned: false,
      },
    );
    const output = parse(serializeBookmarks(input));
    expect(
      [...output.querySelectorAll('a')].map((node) => node.textContent),
    ).toEqual([card.title, 'Linked task']);
    expect(output.querySelectorAll('h3')).toHaveLength(2);
    expect(
      parse(serializeBookmarks({ ...fixture(), cards: [] })).querySelectorAll(
        'h3',
      ),
    ).toHaveLength(2);
  });

  it('validates documents and rejects executable URL schemes instead of producing unsafe HTML', () => {
    expect(() =>
      serializeBookmarks({
        ...fixture(),
        cards: [{ ...card, url: 'javascript:alert(1)' }],
      }),
    ).toThrow();
    expect(() =>
      serializeBookmarks({
        ...fixture(),
        cards: [{ ...card, title: 42 }],
      } as unknown as DeckDocument),
    ).toThrow();
  });

  it('exports Inbox and sessions once at the root, independent of their page', () => {
    const input = fixture();
    input.decks.push(
      {
        ...deck,
        id: 'deck_inbox',
        kind: 'inbox',
        title: 'Inbox',
        pageId: 'missing_page',
      },
      {
        ...deck,
        id: 'deck_session',
        kind: 'session',
        title: 'Session',
        order: 'a1',
      },
    );
    input.cards.push(
      { ...card, id: 'card_inbox', deckId: 'deck_inbox', title: 'Inbox link' },
      {
        ...card,
        id: 'card_session',
        deckId: 'deck_session',
        title: 'Session link',
      },
    );
    const output = parse(serializeBookmarks(input));
    expect(
      [...output.querySelectorAll('a')].map((node) => node.textContent),
    ).toEqual([card.title, 'Inbox link', 'Session link']);
    expect(
      [...output.querySelectorAll('h3')].map((node) => node.textContent),
    ).toEqual([page.title, deck.title, 'Inbox', 'Session']);
  });

  it('refuses orphaned records rather than silently losing links', () => {
    expect(() => serializeBookmarks({ ...fixture(), pages: [] })).toThrow(
      'missing folder',
    );
    expect(() =>
      serializeBookmarks({
        ...fixture(),
        cards: [{ ...card, deckId: 'missing_deck' }],
      }),
    ).toThrow('missing folder');
  });

  it('serializes snapshot links when the live database is corrupt', async () => {
    const name = `bookmark-export-${crypto.randomUUID()}`;
    const database = openDeckDatabase(name);
    const repository = new DeckRepository({ databaseName: name });
    const backups = new BackupService(repository, database, {
      snapshotStorage: null,
    });
    try {
      await repository.replaceDocument(fixture());
      await backups.createSnapshot();
      await (await database).put('cards', { ...card, title: 42 } as never);
      const result = await backups.exportData();
      expect(result.source).toBe('snapshot');
      expect(
        parse(serializeBookmarks(result.document)).querySelector('a')
          ?.textContent,
      ).toBe(card.title);
    } finally {
      await repository.close();
      (await database).close();
    }
  });
});
