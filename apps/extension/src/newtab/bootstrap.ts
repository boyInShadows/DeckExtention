import {
  INBOX_DECK_ID,
  SETTINGS_DEFAULTS,
  type Card,
  type Deck,
  type Page,
  type Settings,
} from 'deck-schema';

import { strings } from '../i18n/strings';
import { DeckRepository } from '../storage/repository';

const EXAMPLE_PAGE_ID = 'page_examples';
const EXAMPLE_DECK_ID = 'deck_examples';
const EXAMPLE_CREATED_AT = 1;

const EXAMPLES = [
  ['example_mdn', strings.examples[0], 'https://developer.mozilla.org/'],
  ['example_github', strings.examples[1], 'https://github.com/'],
  ['example_archive', strings.examples[2], 'https://archive.org/'],
  ['example_wikipedia', strings.examples[3], 'https://www.wikipedia.org/'],
  ['example_standard', strings.examples[4], 'https://www.w3.org/'],
  [
    'example_typescript',
    strings.examples[5],
    'https://www.typescriptlang.org/',
  ],
] as const;

export interface SurfaceData {
  cards: Card[];
  decks: Deck[];
  pages: Page[];
  defaultDeckId: string;
  settings: Settings;
  repository: DeckRepository;
}

export async function hydrateSurface(
  repository = new DeckRepository(),
): Promise<SurfaceData> {
  const existingCards = await repository.listCards();
  const existingDecks = await repository.listDecks();
  const existingPages = await repository.listPages();
  const settings = await repository.getSettings();
  const defaultDeck = existingDecks.find(
    (item) => item.deletedAt === null && item.kind === 'normal',
  );
  if (defaultDeck) {
    const decks = await ensureInbox(
      repository,
      existingDecks,
      defaultDeck.pageId,
    );
    return {
      cards: existingCards,
      decks,
      pages: existingPages,
      defaultDeckId: defaultDeck.id,
      settings,
      repository,
    };
  }

  if (!isFreshStore(existingPages, existingDecks, existingCards)) {
    return recoverDefaultDeck(
      repository,
      existingPages,
      existingDecks,
      existingCards,
      settings,
    );
  }

  /*
   * A first run, or Quick Save wrote only the Inbox before any new tab
   * opened. Nothing but the Inbox exists, so the fixed example ids below
   * cannot collide with anything the user made.
   */
  const page = await repository.upsertPage({
    id: EXAMPLE_PAGE_ID,
    title: strings.examplesPage,
    order: 'a0',
    createdAt: EXAMPLE_CREATED_AT,
    updatedAt: EXAMPLE_CREATED_AT,
    deletedAt: null,
  });
  const deck = await repository.upsertDeck({
    id: EXAMPLE_DECK_ID,
    pageId: EXAMPLE_PAGE_ID,
    title: strings.examplesDeck,
    kind: 'normal',
    order: 'a0',
    color: null,
    isCollapsed: false,
    createdAt: EXAMPLE_CREATED_AT,
    updatedAt: EXAMPLE_CREATED_AT,
    deletedAt: null,
  });
  const cards = await Promise.all(
    EXAMPLES.map(([id, title, url], index) => {
      const parsedUrl = new URL(url);
      return repository.upsertCard({
        id,
        deckId: EXAMPLE_DECK_ID,
        url,
        title,
        hostname: parsedUrl.hostname,
        order: `a${index}`,
        pinned: false,
        lastOpenedAt: null,
        createdAt: EXAMPLE_CREATED_AT,
        updatedAt: EXAMPLE_CREATED_AT,
        deletedAt: null,
      });
    }),
  );
  const decks = await ensureInbox(
    repository,
    [...existingDecks, deck],
    EXAMPLE_PAGE_ID,
  );
  return {
    cards: [...existingCards, ...cards],
    decks,
    pages: [page],
    defaultDeckId: EXAMPLE_DECK_ID,
    settings: { ...SETTINGS_DEFAULTS, ...settings },
    repository,
  };
}

/** True when nothing exists except, possibly, the Inbox and its cards. */
function isFreshStore(pages: Page[], decks: Deck[], cards: Card[]): boolean {
  return (
    pages.length === 0 &&
    decks.every(({ kind }) => kind === 'inbox') &&
    cards.every(({ deckId }) => deckId === INBOX_DECK_ID)
  );
}

/*
 * An established store with no active deck: the user trashed the last one.
 * Never reseed over their records - add one empty deck under a new id, on
 * their first live page (or a new page if they trashed those too).
 */
async function recoverDefaultDeck(
  repository: DeckRepository,
  pages: Page[],
  decks: Deck[],
  cards: Card[],
  settings: Settings,
): Promise<SurfaceData> {
  const now = Date.now();
  const livePage = pages.find(({ deletedAt }) => deletedAt === null);
  const page =
    livePage ??
    (await repository.upsertPage({
      id: crypto.randomUUID(),
      title: strings.newPage,
      order: 'a0',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }));
  const deck = await repository.upsertDeck({
    id: crypto.randomUUID(),
    pageId: page.id,
    title: strings.newDeck,
    kind: 'normal',
    order: 'a0',
    color: null,
    isCollapsed: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  return {
    cards,
    decks: await ensureInbox(repository, [...decks, deck], page.id),
    pages: livePage ? pages : [...pages, page],
    defaultDeckId: deck.id,
    settings,
    repository,
  };
}

async function ensureInbox(
  repository: DeckRepository,
  decks: Deck[],
  pageId: string,
): Promise<Deck[]> {
  if (decks.some((deck) => deck.kind === 'inbox' && deck.deletedAt === null))
    return decks;
  const now = Date.now();
  const inbox = await repository.upsertDeck({
    id: INBOX_DECK_ID,
    pageId,
    title: strings.inbox,
    kind: 'inbox',
    order: 'z0',
    color: null,
    isCollapsed: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  return [...decks, inbox];
}
