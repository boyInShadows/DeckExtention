import { SETTINGS_DEFAULTS, type Card, type Settings } from 'deck-schema';

import { strings } from '../i18n/strings';
import { DeckRepository } from '../storage';

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
  defaultDeckId: string;
  settings: Settings;
  repository: DeckRepository;
}

export async function hydrateSurface(): Promise<SurfaceData> {
  const repository = new DeckRepository();
  const existingCards = await repository.listCards();
  const settings = await repository.getSettings();
  if (existingCards.length > 0) {
    const decks = await repository.listDecks();
    const defaultDeck = decks.find((item) => item.deletedAt === null);
    if (!defaultDeck)
      throw new Error('Deck: cards exist without an active deck.');
    return {
      cards: existingCards,
      defaultDeckId: defaultDeck.id,
      settings,
      repository,
    };
  }

  await repository.upsertPage({
    id: EXAMPLE_PAGE_ID,
    title: strings.examplesPage,
    order: 'a0',
    createdAt: EXAMPLE_CREATED_AT,
    updatedAt: EXAMPLE_CREATED_AT,
    deletedAt: null,
  });
  await repository.upsertDeck({
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
  return {
    cards,
    defaultDeckId: EXAMPLE_DECK_ID,
    settings: { ...SETTINGS_DEFAULTS, ...settings },
    repository,
  };
}
