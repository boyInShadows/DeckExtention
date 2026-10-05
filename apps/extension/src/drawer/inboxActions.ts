import type { Card } from 'deck-schema';
import { generateNKeysBetween } from 'fractional-indexing';

import { panelStrings as strings } from '../i18n/panelStrings';
import type { DeckRepository } from '../storage/repository';
import { compareOrder } from './workspaceModel';

/**
 * Inbox triage writes (FableTasks P2.S5). Each returns the next `cards` state
 * as a new array, built only from records the repository confirmed - a write
 * that throws leaves the caller's state untouched and surfaces the error.
 */

const MAX_PIN_COUNT = 12;

function lastOrder(cards: Card[], matches: (card: Card) => boolean) {
  return (
    cards
      .filter((card) => card.deletedAt === null && matches(card))
      .map(({ order }) => order)
      .toSorted(compareOrder)
      .at(-1) ?? null
  );
}

function pick(cards: Card[], ids: string[]): Card[] {
  return ids
    .map((id) => cards.find((card) => card.id === id))
    .filter((card): card is Card => card !== undefined);
}

function merge(cards: Card[], saved: Card[]): Card[] {
  const byId = new Map(saved.map((card) => [card.id, card]));
  return cards.map((card) => byId.get(card.id) ?? card);
}

/** Appends to the target deck in the order the cards were listed. */
export async function moveCards(
  repository: DeckRepository,
  cards: Card[],
  ids: string[],
  targetDeckId: string,
  now: () => number = Date.now,
): Promise<Card[]> {
  const moving = pick(cards, ids);
  const keys = generateNKeysBetween(
    lastOrder(cards, (card) => card.deckId === targetDeckId),
    null,
    moving.length,
  );
  const saved: Card[] = [];
  for (const [index, card] of moving.entries()) {
    saved.push(
      await repository.upsertCard({
        ...card,
        deckId: targetDeckId,
        order: keys[index] ?? card.order,
        updatedAt: now(),
      }),
    );
  }
  return merge(cards, saved);
}

/** Soft delete: recoverable for 30 days (FableTasks P1.S2). */
export async function trashCards(
  repository: DeckRepository,
  cards: Card[],
  ids: string[],
  now: () => number = Date.now,
): Promise<Card[]> {
  const trashed: Card[] = [];
  for (const card of pick(cards, ids)) {
    await repository.softDelete('card', card.id);
    trashed.push({ ...card, deletedAt: now() });
  }
  return merge(cards, trashed);
}

/**
 * Pinning is a triage decision too: the card leaves the Inbox for the deck
 * the surface files its pins in, so Inbox zero stays reachable.
 */
export async function pinCards(
  repository: DeckRepository,
  cards: Card[],
  ids: string[],
  homeDeckId: string,
  now: () => number = Date.now,
): Promise<Card[]> {
  const pinning = pick(cards, ids).filter(({ pinned }) => !pinned);
  const pinCount = cards.filter(
    (card) => card.pinned && card.deletedAt === null,
  ).length;
  if (pinCount + pinning.length > MAX_PIN_COUNT) {
    throw new Error(strings.pinLimitReached);
  }
  const keys = generateNKeysBetween(
    lastOrder(cards, ({ pinned }) => pinned),
    null,
    pinning.length,
  );
  const saved: Card[] = [];
  for (const [index, card] of pinning.entries()) {
    saved.push(
      await repository.upsertCard({
        ...card,
        deckId: homeDeckId,
        pinned: true,
        order: keys[index] ?? card.order,
        updatedAt: now(),
      }),
    );
  }
  return merge(cards, saved);
}

/** Resurface (MasterPlan I6) selects on `lastOpenedAt`, so opening counts. */
export async function markOpened(
  repository: DeckRepository,
  card: Card,
  now: () => number = Date.now,
): Promise<Card> {
  const time = now();
  return repository.upsertCard({
    ...card,
    lastOpenedAt: time,
    updatedAt: time,
  });
}

/**
 * Opens a card here or in a new tab, stamping `lastOpenedAt` first. Imported
 * data could carry any scheme, so only web pages are ever opened.
 */
export async function openCard(
  repository: DeckRepository,
  card: Card,
  isNewTab: boolean,
  now: () => number = Date.now,
): Promise<Card> {
  if (!/^https?:\/\//i.test(card.url)) throw new Error(strings.invalidUrl);
  const opened = await markOpened(repository, card, now);
  if (isNewTab) window.open(card.url, '_blank', 'noopener');
  else location.assign(card.url);
  return opened;
}
