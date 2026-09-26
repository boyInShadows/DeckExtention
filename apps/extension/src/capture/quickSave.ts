import {
  INBOX_DECK_ID,
  TITLE_MAX_LENGTH,
  type Card,
  type Deck,
  type Page,
} from 'deck-schema';
import { generateKeyBetween } from 'fractional-indexing';

import { captureStrings } from '../i18n/captureStrings';
import type { DeckRepository } from '../storage/repository';

/**
 * Quick Save's data path (FableTasks P2.S4, MasterPlan I3): one keystroke
 * lands the page in the Inbox with zero decisions. Nothing here touches the
 * network - the title comes from the tab, or defaults to the hostname.
 */

/**
 * The Inbox's page when nothing exists yet (saved before the first new tab).
 * It matches the page the new tab seeds on first run, so the two meet.
 */
const FALLBACK_PAGE_ID = 'page_examples';

export interface CaptureTarget {
  url: string;
  hostname: string;
  title: string;
}

export type SaveResult =
  | { kind: 'saved'; card: Card }
  | {
      kind: 'duplicate';
      card: Card;
      /** Drawer page to open: a page id, or 'inbox'. */
      pageId: string;
      /** Human path, e.g. "Work › Docs". Null when the card is in the Inbox. */
      location: string | null;
    };

export interface SaveOptions {
  now?: () => number;
  createId?: () => string;
}

/**
 * Turns whatever the tab reported into a savable target, or null for pages
 * Deck cannot save (`chrome://`, `file://`, the extension's own pages).
 */
export function captureTarget(
  url: string | undefined,
  title: string | undefined,
): CaptureTarget | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const cleanTitle = (title ?? '').trim().slice(0, TITLE_MAX_LENGTH);
  return {
    url: parsed.href,
    hostname: parsed.hostname,
    title: cleanTitle || parsed.hostname,
  };
}

export async function saveToInbox(
  repository: DeckRepository,
  target: CaptureTarget,
  options: SaveOptions = {},
): Promise<SaveResult> {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => crypto.randomUUID());
  const [pages, decks, cards] = await Promise.all([
    repository.listPages(),
    repository.listDecks(),
    repository.listCards(),
  ]);
  const activeDecks = decks.filter((deck) => deck.deletedAt === null);
  const duplicate = cards.find(
    (card) =>
      card.deletedAt === null &&
      card.url === target.url &&
      activeDecks.some((deck) => deck.id === card.deckId),
  );
  if (duplicate) return describeDuplicate(duplicate, activeDecks, pages);

  const inbox = await ensureInbox(repository, activeDecks, pages, now());
  const firstInInbox = cards
    .filter((card) => card.deckId === inbox.id && card.deletedAt === null)
    .map((card) => card.order)
    .toSorted()[0];
  const timestamp = now();
  const card = await repository.upsertCard({
    id: createId(),
    deckId: inbox.id,
    url: target.url,
    title: target.title,
    hostname: target.hostname,
    // Newest first: every save goes in front of the current head.
    order: generateKeyBetween(null, firstInInbox ?? null),
    pinned: false,
    lastOpenedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  });
  return { kind: 'saved', card };
}

/** Undo only flags the card deleted, so it stays recoverable from Trash. */
export async function undoSave(
  repository: DeckRepository,
  cardId: string,
): Promise<void> {
  await repository.softDelete('card', cardId);
}

/**
 * Re-reads the card first: the toast can stay open a while, and writing back
 * the copy taken at save time would undo anything changed meanwhile.
 */
export async function addNoteToCard(
  repository: DeckRepository,
  cardId: string,
  note: string,
  now: () => number = Date.now,
): Promise<Card> {
  const current = (await repository.listCards()).find(
    ({ id }) => id === cardId,
  );
  if (!current || current.deletedAt !== null) {
    throw new Error(`Card ${cardId} is no longer in Deck`);
  }
  return repository.upsertCard({ ...current, note, updatedAt: now() });
}

function describeDuplicate(
  card: Card,
  decks: Deck[],
  pages: Page[],
): SaveResult {
  const deck = decks.find((item) => item.id === card.deckId);
  if (!deck || deck.kind === 'inbox') {
    return { kind: 'duplicate', card, pageId: 'inbox', location: null };
  }
  const page = pages.find((item) => item.id === deck.pageId);
  const location = page ? `${page.title} › ${deck.title}` : deck.title;
  return { kind: 'duplicate', card, pageId: deck.pageId, location };
}

async function ensureInbox(
  repository: DeckRepository,
  decks: Deck[],
  pages: Page[],
  timestamp: number,
): Promise<Deck> {
  const existing = decks.find((deck) => deck.kind === 'inbox');
  if (existing) return existing;
  const pageId =
    decks.find((deck) => deck.kind === 'normal')?.pageId ??
    pages.find((page) => page.deletedAt === null)?.id ??
    FALLBACK_PAGE_ID;
  return repository.upsertDeck({
    id: INBOX_DECK_ID,
    pageId,
    title: captureStrings.inbox,
    kind: 'inbox',
    order: 'z0',
    color: null,
    isCollapsed: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  });
}
