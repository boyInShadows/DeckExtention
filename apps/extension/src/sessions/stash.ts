import type { Card, Deck, Page } from 'deck-schema';
import { generateKeyBetween } from 'fractional-indexing';

import { captureTarget, type CaptureTarget } from '../capture/quickSave';
import { panelStrings as strings } from '../i18n/panelStrings';
import type { DeckRepository } from '../storage/repository';
import { SESSION_LIFETIME_MS } from './constants';
import { openDeck } from './openDeck';

interface StashTab {
  id: number;
  target: CaptureTarget;
}
export interface StashResult {
  deckId: string;
  count: number;
  remaining: number;
  tabId: number;
}

function eligibleTabs(tabs: chrome.tabs.Tab[]): StashTab[] {
  return tabs
    .toSorted((a, b) => a.index - b.index)
    .flatMap((tab) => {
      const target = captureTarget(tab.pendingUrl ?? tab.url, tab.title);
      return !tab.pinned && tab.id !== undefined && target
        ? [{ id: tab.id, target }]
        : [];
    });
}

function sessionDeck(
  decks: Deck[],
  pageId: string,
  count: number,
  time: number,
): Deck {
  return {
    id: crypto.randomUUID(),
    pageId,
    title: strings.sessionTitle(time, count),
    kind: 'session',
    order: generateKeyBetween(
      null,
      decks
        .filter(
          ({ kind, deletedAt }) => kind === 'session' && deletedAt === null,
        )
        .map(({ order }) => order)
        .toSorted()[0] ?? null,
    ),
    expiresAt: time + SESSION_LIFETIME_MS,
    color: null,
    isCollapsed: false,
    createdAt: time,
    updatedAt: time,
    deletedAt: null,
  };
}

function sessionCards(tabs: StashTab[], deckId: string, time: number): Card[] {
  let previous: string | null = null;
  return tabs.map(({ target }) => {
    const order = generateKeyBetween(previous, null);
    previous = order;
    return {
      ...target,
      id: crypto.randomUUID(),
      deckId,
      order,
      pinned: false,
      lastOpenedAt: null,
      createdAt: time,
      updatedAt: time,
      deletedAt: null,
    };
  });
}

async function saveSession(
  repository: DeckRepository,
  tabs: StashTab[],
  time: number,
): Promise<string> {
  const [pages, decks] = await Promise.all([
    repository.listPages(),
    repository.listDecks(),
  ]);
  const page = pages.find(({ deletedAt }) => deletedAt === null);
  const fallback: Page = {
    id: crypto.randomUUID(),
    title: strings.examplesTitle,
    order: 'a0',
    createdAt: time,
    updatedAt: time,
    deletedAt: null,
  };
  const deck = sessionDeck(decks, page?.id ?? fallback.id, tabs.length, time);
  await repository.upsertMany({
    pages: page ? [] : [fallback],
    decks: [deck],
    cards: sessionCards(tabs, deck.id, time),
  });
  return deck.id;
}

export async function stashWindow(
  repository: DeckRepository,
  windowId: number,
  now: () => number = Date.now,
): Promise<StashResult | null> {
  const tabs = eligibleTabs(await chrome.tabs.query({ windowId }));
  if (!tabs.length) return null;
  const deckId = await saveSession(repository, tabs, now());
  // Keep the window alive before closing its last eligible tab.
  const summary = await chrome.tabs.create({
    windowId,
    url: 'about:blank',
    active: false,
  });
  if (summary.id === undefined) throw new Error(strings.stashFailed);
  let remaining = 0;
  for (const tab of tabs) {
    try {
      const current = await chrome.tabs.get(tab.id);
      const target = captureTarget(
        current.pendingUrl ?? current.url,
        current.title,
      );
      if (
        current.pinned ||
        current.windowId !== windowId ||
        target?.url !== tab.target.url
      ) {
        remaining += 1;
        continue;
      }
      await chrome.tabs.remove(tab.id);
    } catch {
      // The saved session is intact; the result explicitly reports unclosed tabs.
      remaining += 1;
    }
  }
  return { deckId, count: tabs.length, remaining, tabId: summary.id };
}

export async function undoStash(
  repository: DeckRepository,
  deckId: string,
  windowId: number,
): Promise<void> {
  await openDeck(repository, deckId, windowId, 'restore');
}
