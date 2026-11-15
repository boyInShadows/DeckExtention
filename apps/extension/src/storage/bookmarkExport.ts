import type { Card, Deck } from 'deck-schema';
import { panelStrings as strings } from '../i18n/panelStrings';
import { parseDocument, type DeckDocument } from './document';

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) => HTML_ENTITIES[character] ?? character,
  );
const byOrder = (a: { order: string }, b: { order: string }) =>
  a.order < b.order ? -1 : a.order > b.order ? 1 : 0;
const folder = (title: string, contents: string) =>
  `<DT><H3>${escapeHtml(title)}</H3>\n<DL><p>\n${contents}</DL><p>\n`;
const BOOKMARK_PROTOCOLS = [
  'http:',
  'https:',
  'ftp:',
  'file:',
  'mailto:',
  'chrome:',
];

function bookmark(card: Card): string {
  if (!card.url) return '';
  if (!BOOKMARK_PROTOCOLS.includes(new URL(card.url).protocol)) {
    throw new Error(strings.exportBookmarksUnsafeUrl);
  }
  return `<DT><A HREF="${escapeHtml(card.url)}">${escapeHtml(card.title)}</A>\n`;
}

function assertFolders(document: DeckDocument): void {
  if (
    document.decks.some(
      (deck) =>
        deck.deletedAt === null &&
        deck.kind === 'normal' &&
        !document.pages.some((page) => page.id === deck.pageId),
    ) ||
    document.cards.some(
      (card) =>
        card.deletedAt === null &&
        card.url &&
        !document.decks.some((deck) => deck.id === card.deckId),
    )
  ) {
    throw new Error(strings.exportBookmarksMissingParent);
  }
}

export function serializeBookmarks(value: DeckDocument): string {
  const document = parseDocument(value);
  assertFolders(document);
  const pages = document.pages
    .filter((page) => page.deletedAt === null)
    .toSorted(byOrder);
  const decks = document.decks
    .filter((deck) => deck.deletedAt === null)
    .toSorted(byOrder);
  const cards = document.cards
    .filter((card) => card.deletedAt === null)
    .toSorted(byOrder);
  const renderDeck = (deck: Deck) =>
    folder(
      deck.title,
      cards
        .filter((card) => card.deckId === deck.id)
        .map(bookmark)
        .join(''),
    );
  const contents = pages
    .map((page) =>
      folder(
        page.title,
        decks
          .filter((deck) => deck.kind === 'normal' && deck.pageId === page.id)
          .map(renderDeck)
          .join(''),
      ),
    )
    .join('');
  const systemDecks = decks
    .filter((deck) => deck.kind !== 'normal')
    .map(renderDeck)
    .join('');
  return (
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Deck</TITLE>\n<H1>Deck</H1>\n<DL><p>\n' +
    contents +
    systemDecks +
    '</DL><p>\n'
  );
}
