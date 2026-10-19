import { NOTE_MAX_LENGTH, TITLE_MAX_LENGTH, type Card } from 'deck-schema';
import { generateKeyBetween } from 'fractional-indexing';
import { ensureInbox } from '../capture/quickSave';
import { panelStrings as strings } from '../i18n/panelStrings';
import type { DeckRepository } from '../storage/repository';

export async function createTask(
  repository: DeckRepository,
  input: string,
): Promise<Card> {
  const note = input.trim();
  if (!note) throw new Error(strings.taskRequired);
  if (note.length > NOTE_MAX_LENGTH) throw new Error(strings.taskTooLong);
  const [pages, decks, cards] = await Promise.all([
    repository.listPages(),
    repository.listDecks(),
    repository.listCards(),
  ]);
  const time = Date.now();
  const inbox = await ensureInbox(
    repository,
    decks.filter((deck) => deck.deletedAt === null),
    pages,
    time,
  );
  const first = cards
    .filter((card) => card.deckId === inbox.id && card.deletedAt === null)
    .map((card) => card.order)
    .toSorted()[0];
  return repository.upsertCard({
    id: crypto.randomUUID(),
    deckId: inbox.id,
    kind: 'task',
    title: note.slice(0, TITLE_MAX_LENGTH),
    note,
    hostname: '',
    order: generateKeyBetween(null, first ?? null),
    pinned: false,
    done: false,
    lastOpenedAt: null,
    createdAt: time,
    updatedAt: time,
    deletedAt: null,
  });
}
