// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { Card } from 'deck-schema';
import { DeckRepository } from '../storage/repository';
import { click, render, type, type RenderResult } from '../testing/render';
import { createTask } from './quickTask';
import { TaskManager } from './TaskManager';

const DATABASE = 'deck-task-manager';
const repository = new DeckRepository({ databaseName: DATABASE });
let mountedView: RenderResult | undefined;
afterEach(async () => {
  mountedView?.unmount();
  vi.restoreAllMocks();
  await repository.close();
  await deleteDB(DATABASE);
});

it('keeps failed task input for retry, persists completion and soft deletion, and hides deleted parents', async () => {
  const existing = await createTask(repository, 'Existing task');
  const decks = await repository.listDecks();
  const pages = await repository.listPages();
  const onError = vi.fn();
  const offerUndo = vi.fn();
  function Harness() {
    const [cards, setCards] = useState<Card[]>([existing]);
    return (
      <TaskManager
        isOpen
        cards={cards}
        decks={decks}
        pages={pages}
        repository={repository}
        onDataChange={async () => setCards(await repository.listCards())}
        onEditNote={vi.fn()}
        onError={onError}
        offerUndo={offerUndo}
      />
    );
  }
  const view = await render(<Harness />);
  mountedView = view;
  const input = view.get<HTMLInputElement>('[data-deck="task-input"]');
  vi.spyOn(repository, 'upsertCard').mockRejectedValueOnce(
    new Error('disk full'),
  );
  await view.act(() => type(input, 'Keep this draft'));
  await view.act(() => {
    view
      .get('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(input.value).toBe('Keep this draft');
  await vi.waitFor(() =>
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('disk full')),
  );
  await view.act(() => {
    view
      .get('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(input.value).toBe(''));
  await vi.waitFor(async () =>
    expect(await repository.listCards()).toHaveLength(2),
  );
  await view.act(() =>
    click(view.get(`[data-task-id="${existing.id}"] [role="checkbox"]`)),
  );
  await vi.waitFor(async () =>
    expect(
      (await repository.listCards()).find(({ id }) => id === existing.id)?.done,
    ).toBe(true),
  );
  await view.act(() =>
    click(view.getAll('[data-deck="task-filter"]')[1] as HTMLElement),
  );
  expect(view.getAll('[data-task-id]')).toHaveLength(1);
  await view.act(() => click(view.getByLabel('Move task to Trash')));
  await vi.waitFor(async () =>
    expect(
      (await repository.listCards()).find(({ id }) => id === existing.id)
        ?.deletedAt,
    ).toEqual(expect.any(Number)),
  );
  const undo = offerUndo.mock.calls[0]?.[0];
  if (!undo) throw new Error('Missing task Undo');
  await view.act(() => undo.undo());
  expect(
    (await repository.listCards()).find(({ id }) => id === existing.id)
      ?.deletedAt,
  ).toBeNull();
  await view.rerender(
    <TaskManager
      isOpen
      cards={[existing]}
      decks={decks.map((deck) => ({ ...deck, deletedAt: 1 }))}
      pages={pages}
      repository={repository}
      onDataChange={vi.fn()}
      onEditNote={vi.fn()}
      onError={onError}
      offerUndo={offerUndo}
    />,
  );
  expect(view.getAll('[data-task-id]')).toHaveLength(0);
});
