// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import type * as DndCore from '@dnd-kit/core';
import { SETTINGS_DEFAULTS, type Card } from 'deck-schema';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { panelStrings as strings } from '../i18n/panelStrings';
import { resolveKeymap } from '../keys/keymap';
import { DeckRepository } from '../storage/repository';
import { openDeckDatabase } from '../storage/database';
import { click, render, type RenderResult } from '../testing/render';
import { CardRow } from './CardRow';

vi.mock('@dnd-kit/core', async (importOriginal) => ({
  ...(await importOriginal<typeof DndCore>()),
  useDndContext: () => ({ collisions: null }),
}));

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    setNodeRef: () => undefined,
    setActivatorNodeRef: () => undefined,
    transform: null,
  }),
}));
vi.mock('../newtab/FaviconTile', () => ({ default: () => null }));

const DATABASE = 'deck-incognito-opening-test';
const NOW = 1_900_000_000_000;
const CARD: Card = {
  id: 'card_private',
  deckId: 'deck_private',
  title: 'Private reading',
  url: 'https://original.test/',
  hostname: 'original.test',
  order: 'a0',
  pinned: false,
  lastOpenedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
let repository: DeckRepository;
let view: RenderResult | undefined;
let create: ReturnType<typeof vi.fn>;
let isAllowed: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  repository = new DeckRepository({ databaseName: DATABASE, now: () => NOW });
  await repository.upsertCard(CARD);
  create = vi.fn().mockResolvedValue({ incognito: true });
  isAllowed = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('chrome', {
    extension: { isAllowedIncognitoAccess: isAllowed },
    windows: { create },
  });
});

afterEach(async () => {
  view?.unmount();
  view = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await repository.close();
  await deleteDB(DATABASE);
});

async function mountRow() {
  const onError = vi.fn();
  const onCardsChange = vi.fn();
  view = await render(
    <CardRow
      card={CARD}
      cards={[CARD]}
      decks={[]}
      pages={[]}
      isOpen
      keymap={resolveKeymap([])}
      data={{
        cards: [CARD],
        decks: [],
        pages: [],
        defaultDeckId: CARD.deckId,
        settings: SETTINGS_DEFAULTS,
        repository,
      }}
      onCardsChange={onCardsChange}
      onDecksChange={vi.fn()}
      onEditNote={vi.fn()}
      onError={onError}
    />,
  );
  return { onError, onCardsChange };
}

async function openIncognito() {
  const current = view;
  if (!current) throw new Error('Missing mounted card');
  await current.act(() => click(current.getByLabel(strings.cardMenu)));
  await current.act(() => click(current.getByText(strings.openIncognito)));
}

it('stamps the current card and opens its updated URL without losing its note', async () => {
  const { onCardsChange } = await mountRow();
  const edited = await repository.upsertCard({
    ...CARD,
    url: 'https://edited.test/',
    note: 'Newer note',
  });
  await openIncognito();
  await vi.waitFor(() =>
    expect(create).toHaveBeenCalledWith({ url: edited.url, incognito: true }),
  );
  const opened = { ...edited, lastOpenedAt: NOW, updatedAt: NOW };
  expect(await repository.listCards()).toEqual([opened]);
  expect(onCardsChange).toHaveBeenCalledWith([opened]);
});

it.each(['deleted', 'missing', 'non-web'])(
  'does not open a stale %s target',
  async (state) => {
    const { onError } = await mountRow();
    if (state === 'deleted') await repository.softDelete('card', CARD.id);
    if (state === 'missing') {
      const database = await openDeckDatabase(DATABASE);
      await database.delete('cards', CARD.id);
      database.close();
    }
    if (state === 'non-web')
      await repository.upsertCard({ ...CARD, url: 'ftp://files.test/x' });
    const before = await repository.listCards();
    await openIncognito();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(create).not.toHaveBeenCalled();
    if (state !== 'non-web')
      expect(await repository.listCards()).toEqual(before);
    else
      expect((await repository.listCards())[0]?.url).toBe('ftp://files.test/x');
  },
);

it('does not open or stamp when incognito access is disabled', async () => {
  isAllowed.mockResolvedValue(false);
  const { onError } = await mountRow();
  await openIncognito();
  await vi.waitFor(() =>
    expect(onError).toHaveBeenCalledWith(strings.incognitoUnavailable),
  );
  expect(create).not.toHaveBeenCalled();
  expect((await repository.listCards())[0]?.lastOpenedAt).toBeNull();
});

it('reports a failed timestamp write without opening a window', async () => {
  const { onError } = await mountRow();
  vi.spyOn(repository, 'markCardsOpened').mockRejectedValueOnce(
    new Error('Disk failed'),
  );
  await openIncognito();
  await vi.waitFor(() =>
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('Disk failed'),
    ),
  );
  expect(create).not.toHaveBeenCalled();
  expect((await repository.listCards())[0]?.lastOpenedAt).toBeNull();
});
