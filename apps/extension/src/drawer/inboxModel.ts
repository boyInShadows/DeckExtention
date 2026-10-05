import type { Deck, Page } from 'deck-schema';

import { compareOrder } from './workspaceModel';

/**
 * Inbox triage (FableTasks P2.S5): the pure parts - who a card can move to,
 * how the "move to…" mini-Line ranks them, and range selection.
 */

export const RECENT_TARGETS_KEY = 'deck:recent-move-targets';
export const RECENT_TARGET_LIMIT = 3;
export const MOVE_RESULT_LIMIT = 8;

export interface MoveTarget {
  deckId: string;
  /** "Work › Docs" - what the user types against. */
  label: string;
}

/** Every live normal deck on a live page, in rail then grid order. */
export function moveTargets(decks: Deck[], pages: Page[]): MoveTarget[] {
  const livePages = pages
    .filter(({ deletedAt }) => deletedAt === null)
    .toSorted((left, right) => compareOrder(left.order, right.order));
  return livePages.flatMap((page) =>
    decks
      .filter(
        (deck) =>
          deck.deletedAt === null &&
          deck.kind === 'normal' &&
          deck.pageId === page.id,
      )
      .toSorted((left, right) => compareOrder(left.order, right.order))
      .map((deck) => ({
        deckId: deck.id,
        label: `${page.title} › ${deck.title}`,
      })),
  );
}

const SCORE_CONTAINS = 1_000;
const SCORE_WORD_START = 500;
const SCORE_SUBSEQUENCE = 100;

/**
 * Higher is better; null means no match. A contiguous hit beats a word-start
 * hit beats a scattered subsequence ("wdoc" still finds "Work › Docs").
 */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return 0;
  const haystack = text.toLocaleLowerCase();
  const index = haystack.indexOf(needle);
  if (index >= 0) {
    const isWordStart = index === 0 || /[\s›]/.test(haystack[index - 1] ?? '');
    return SCORE_CONTAINS + (isWordStart ? SCORE_WORD_START : 0) - index;
  }
  let position = 0;
  let gaps = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, position);
    if (found < 0) return null;
    gaps += found - position;
    position = found + 1;
  }
  return SCORE_SUBSEQUENCE - gaps;
}

/**
 * Empty query: the last few destinations first, then the rest in order.
 * Otherwise: fuzzy-ranked, recent ones winning ties.
 */
export function rankMoveTargets(
  targets: MoveTarget[],
  query: string,
  recentDeckIds: string[],
): MoveTarget[] {
  const recency = (deckId: string) => {
    const index = recentDeckIds.indexOf(deckId);
    return index < 0 ? recentDeckIds.length : index;
  };
  if (!query.trim()) {
    return targets
      .map((target, index) => ({ target, index }))
      .toSorted(
        (left, right) =>
          recency(left.target.deckId) - recency(right.target.deckId) ||
          left.index - right.index,
      )
      .map(({ target }) => target)
      .slice(0, MOVE_RESULT_LIMIT);
  }
  return targets
    .map((target) => ({ target, score: fuzzyScore(query, target.label) }))
    .filter(
      (entry): entry is { target: MoveTarget; score: number } =>
        entry.score !== null,
    )
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        recency(left.target.deckId) - recency(right.target.deckId),
    )
    .map(({ target }) => target)
    .slice(0, MOVE_RESULT_LIMIT);
}

/** Most recent first, no repeats, at most three. */
export function rememberTarget(recent: string[], deckId: string): string[] {
  return [deckId, ...recent.filter((id) => id !== deckId)].slice(
    0,
    RECENT_TARGET_LIMIT,
  );
}

export function parseRecentTargets(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
          .filter((id): id is string => typeof id === 'string')
          .slice(0, RECENT_TARGET_LIMIT)
      : [];
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

/** Ids from the anchor to the cursor, inclusive, in list order. */
export function rangeSelection(
  ids: string[],
  anchor: number,
  cursor: number,
): string[] {
  const start = Math.min(anchor, cursor);
  const end = Math.max(anchor, cursor);
  return ids.slice(start, end + 1);
}

export function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

/** What a triage key acts on: the anchored range, or just the cursor card. */
export function selectionOf(
  ids: string[],
  cursor: number,
  anchor: number | null,
): string[] {
  const position = clampIndex(cursor, ids.length);
  return anchor === null
    ? ids.slice(position, position + 1)
    : rangeSelection(ids, clampIndex(anchor, ids.length), position);
}
