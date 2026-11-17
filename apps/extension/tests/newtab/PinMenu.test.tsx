// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Card } from 'deck-schema';
import PinMenu from '../../src/newtab/PinMenu';
import { panelStrings as strings } from '../../src/i18n/panelStrings';
import { DeckRepository } from '../../src/storage/repository';
import { openDeckDatabase } from '../../src/storage/database';
import { click, render, type RenderResult } from '../../src/testing/render';

const NOW = 1_900_000_000_000;
const CARD: Card = {
  id: 'pin_private',
  deckId: 'deck_inbox',
  title: 'Private reading',
  url: 'https://original.example/',
  hostname: 'original.example',
  order: 'a0',
  pinned: true,
  lastOpenedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
let name: string;
let repository: DeckRepository;
let view: RenderResult | undefined;
let anchor: HTMLButtonElement;
let create: ReturnType<typeof vi.fn>;
let isAllowed: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  name = `pin-incognito-${crypto.randomUUID()}`;
  repository = new DeckRepository({ databaseName: name, now: () => NOW });
  await repository.upsertCard(CARD);
  create = vi.fn().mockResolvedValue({ incognito: true });
  isAllowed = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('chrome', {
    extension: { isAllowedIncognitoAccess: isAllowed },
    windows: { create },
  });
  anchor = document.createElement('button');
  document.body.append(anchor);
});

afterEach(async () => {
  view?.unmount();
  view = undefined;
  anchor.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await repository.close();
  await deleteDB(name);
});

async function openMenu() {
  const onOpened = vi.fn();
  const onError = vi.fn();
  const onClose = vi.fn();
  view = await render(
    <PinMenu
      card={CARD}
      anchor={anchor}
      repository={repository}
      onOpened={onOpened}
      onError={onError}
      onClose={onClose}
      onUpdate={vi.fn()}
    />,
  );
  return { onOpened, onError, onClose };
}

async function openIncognito() {
  const current = view;
  if (!current) throw new Error('Missing pin menu');
  await current.act(() => click(current.getByText(strings.openIncognito)));
}

it('opens the current validated pin URL and preserves its newer note and label', async () => {
  const { onOpened, onClose, onError } = await openMenu();
  const edited = await repository.upsertCard({
    ...CARD,
    url: 'https://edited.example/',
    note: 'Newer note',
    pinLabel: 'New label',
  });
  await openIncognito();
  await vi.waitFor(() =>
    expect(create).toHaveBeenCalledExactlyOnceWith({
      url: edited.url,
      incognito: true,
    }),
  );
  const saved = { ...edited, lastOpenedAt: NOW, updatedAt: NOW };
  expect(await repository.listCards()).toEqual([saved]);
  expect(onOpened).toHaveBeenCalledWith(saved);
  expect(onOpened.mock.invocationCallOrder[0]).toBeLessThan(
    create.mock.invocationCallOrder[0] ?? 0,
  );
  expect(onClose).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(anchor);
  expect(onError).not.toHaveBeenCalled();
});

it.each(['deleted', 'missing', 'non-web'])(
  'rejects a current %s record without navigating or overwriting newer fields',
  async (state) => {
    const { onError } = await openMenu();
    if (state === 'deleted') await repository.softDelete('card', CARD.id);
    if (state === 'missing') {
      const database = await openDeckDatabase(name);
      await database.delete('cards', CARD.id);
      database.close();
    }
    if (state === 'non-web')
      await repository.upsertCard({
        ...CARD,
        url: 'javascript:alert(1)',
        note: 'Keep me',
      });
    const before = await repository.listCards();
    await openIncognito();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(create).not.toHaveBeenCalled();
    if (state !== 'non-web')
      expect(await repository.listCards()).toEqual(before);
    else
      expect((await repository.listCards())[0]).toMatchObject({
        url: 'javascript:alert(1)',
        note: 'Keep me',
      });
  },
);

it('explains unavailable access without stamping or opening', async () => {
  isAllowed.mockResolvedValue(false);
  const { onError, onOpened } = await openMenu();
  await openIncognito();
  await vi.waitFor(() =>
    expect(onError).toHaveBeenCalledWith(strings.incognitoUnavailable),
  );
  expect(create).not.toHaveBeenCalled();
  expect(onOpened).not.toHaveBeenCalled();
  expect(await repository.listCards()).toEqual([CARD]);
});

it('reports a failed stamp without opening or changing the saved pin', async () => {
  const { onError } = await openMenu();
  vi.spyOn(repository, 'markCardsOpened').mockRejectedValueOnce(
    new Error('Disk full'),
  );
  await openIncognito();
  await vi.waitFor(() =>
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Disk full')),
  );
  expect(create).not.toHaveBeenCalled();
  expect(await repository.listCards()).toEqual([CARD]);
});

it('surfaces native creation failure while preserving the attempted-open stamp', async () => {
  const { onError, onOpened } = await openMenu();
  create.mockRejectedValueOnce(new Error('Window creation failed'));
  await openIncognito();
  await vi.waitFor(() =>
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('Window creation failed'),
    ),
  );
  expect((await repository.listCards())[0]?.lastOpenedAt).toBe(NOW);
  expect(onOpened).toHaveBeenCalled();
});

it.each([undefined, { incognito: false }])(
  'explains a browser response %s that did not create a private window',
  async (response) => {
    create.mockResolvedValueOnce(response);
    const { onError } = await openMenu();
    await openIncognito();
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith(strings.incognitoUnavailable),
    );
  },
);

it('surfaces a failed access check without stamping or navigating', async () => {
  isAllowed.mockRejectedValueOnce(new Error('Chrome access check failed'));
  const { onError } = await openMenu();
  await openIncognito();
  await vi.waitFor(() =>
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('Chrome access check failed'),
    ),
  );
  expect(create).not.toHaveBeenCalled();
  expect(await repository.listCards()).toEqual([CARD]);
});
