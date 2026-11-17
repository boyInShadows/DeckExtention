import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeckRepository } from '../../src/storage/repository';
import { saveDroppedLink } from '../../src/capture/saveDroppedLink';

const DATABASE = 'external-drop-test';
const page = {
  id: 'page_work',
  title: 'Work',
  order: 'a0',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const deck = {
  id: 'deck_reading',
  pageId: page.id,
  title: 'Reading',
  kind: 'normal' as const,
  color: null,
  isCollapsed: false,
  order: 'a0',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
let repository: DeckRepository;
beforeEach(async () => {
  repository = new DeckRepository({ databaseName: DATABASE });
  await repository.upsertPage(page);
  await repository.upsertDeck(deck);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await repository.close();
  await deleteDB(DATABASE);
});

it.each([
  { kind: 'inbox' },
  { kind: 'pin' },
  { kind: 'deck', deckId: deck.id },
] as const)('persists the explicit destination $kind', async (destination) => {
  const result = await saveDroppedLink(
    repository,
    'https://example.com/new',
    destination,
  );
  expect(result.kind).toBe('saved');
  const cards = await repository.listCards();
  expect(cards).toHaveLength(1);
  expect(cards[0]).toMatchObject({
    pinned: destination.kind === 'pin',
    deckId: destination.kind === 'deck' ? deck.id : 'deck_inbox',
    url: 'https://example.com/new',
  });
});
it('detects normalized duplicates before another write', async () => {
  await saveDroppedLink(repository, 'https://example.com/', {
    kind: 'deck',
    deckId: deck.id,
  });
  const before = await repository.readDocument(1);
  const result = await saveDroppedLink(repository, 'HTTPS://EXAMPLE.COM:443', {
    kind: 'pin',
  });
  expect(result).toMatchObject({
    kind: 'duplicate',
    duplicate: { location: 'Work › Reading' },
  });
  expect(await repository.readDocument(1)).toEqual(before);
});
it('rejects a deleted deck and leaves storage intact', async () => {
  await repository.upsertDeck({ ...deck, deletedAt: 2 });
  const before = await repository.readDocument(1);
  await expect(
    saveDroppedLink(repository, 'https://example.com/new', {
      kind: 'deck',
      deckId: deck.id,
    }),
  ).rejects.toThrow();
  expect(await repository.readDocument(1)).toEqual(before);
});
it('checks the current pin cap and reports writes instead of pretending success', async () => {
  for (let index = 0; index < 12; index += 1)
    await repository.upsertCard({
      id: `saved_pin_${index}`,
      deckId: 'deck_inbox',
      title: 'Pin',
      url: `https://pin${index}.example.com/`,
      hostname: `pin${index}.example.com`,
      order: 'a0',
      pinned: true,
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: null,
      deletedAt: null,
    });
  await expect(
    saveDroppedLink(repository, 'https://example.com/new', { kind: 'pin' }),
  ).rejects.toThrow('12 pins max');
  expect(await repository.listCards()).toHaveLength(12);
});
it('propagates failed reads and writes without adding a card', async () => {
  vi.spyOn(repository, 'listCards').mockRejectedValueOnce(
    new Error('read failed'),
  );
  await expect(
    saveDroppedLink(repository, 'https://example.com/new', { kind: 'inbox' }),
  ).rejects.toThrow('read failed');
  vi.spyOn(repository, 'upsertCard').mockRejectedValueOnce(
    new Error('write failed'),
  );
  await expect(
    saveDroppedLink(repository, 'https://example.com/new', { kind: 'inbox' }),
  ).rejects.toThrow('write failed');
  expect(await repository.listCards()).toHaveLength(0);
});
