import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NOTE_MAX_LENGTH, TITLE_MAX_LENGTH } from 'deck-schema';
import { DeckRepository } from '../storage/repository';
import { createTask } from './quickTask';
import { buildSearchIndex } from '../newtab/lineSearch';
import { pinCards } from '../drawer/inboxActions';

const DATABASE = 'deck-quick-task';
let repository: DeckRepository;
beforeEach(() => {
  repository = new DeckRepository({ databaseName: DATABASE });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await repository.close();
  await deleteDB(DATABASE);
});

it('saves immediately to Inbox without a URL and puts the next task first', async () => {
  const first = await createTask(repository, '  Buy milk  ');
  const second = await createTask(repository, 'Read the paper');
  expect(first).toMatchObject({
    kind: 'task',
    note: 'Buy milk',
    title: 'Buy milk',
    hostname: '',
    pinned: false,
    done: false,
  });
  expect(first).not.toHaveProperty('url');
  expect(second.order < first.order).toBe(true);
  expect(
    (await repository.listDecks()).filter((deck) => deck.kind === 'inbox'),
  ).toHaveLength(1);
  const result = buildSearchIndex([first, second])('milk');
  expect(result.cards).toEqual([]);
  expect(result.notes.map(({ card }) => card.id)).toEqual([first.id]);
  expect(
    buildSearchIndex([{ ...first, note: undefined }])('milk').notes[0]?.snippet,
  ).toContain('milk');
});

it('preserves long text in the note and rejects blank or oversized input before writing', async () => {
  const text = 'a'.repeat(TITLE_MAX_LENGTH + 50);
  const task = await createTask(repository, text);
  expect(task.title).toHaveLength(TITLE_MAX_LENGTH);
  expect(task.note).toBe(text);
  await expect(createTask(repository, ' ')).rejects.toThrow('Type a task');
  await expect(
    createTask(repository, 'a'.repeat(NOTE_MAX_LENGTH + 1)),
  ).rejects.toThrow('too long');
  expect(await repository.listCards()).toEqual([task]);
});

it('reports a failed save without overwriting existing cards, and refuses a URL-free pin', async () => {
  const saved = await createTask(repository, 'Keep this text');
  vi.spyOn(repository, 'upsertCard').mockRejectedValueOnce(
    new Error('disk full'),
  );
  await expect(createTask(repository, 'Do not lose this')).rejects.toThrow(
    'disk full',
  );
  await expect(pinCards(repository, [saved], [saved.id])).rejects.toThrow(
    'Only links',
  );
  expect(await repository.listCards()).toEqual([saved]);
});
