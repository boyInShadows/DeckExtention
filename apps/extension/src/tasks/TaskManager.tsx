import { NOTE_MAX_LENGTH, type Card, type Deck, type Page } from 'deck-schema';
import { useEffect, useRef, useState } from 'react';
import { panelStrings as strings } from '../i18n/panelStrings';
import { Icon } from '../newtab/Icon';
import type { DeckRepository } from '../storage/repository';
import type { UndoAction } from '../drawer/UndoToast';
import { createTask } from './quickTask';
import './taskManager.css';

interface TaskManagerProps {
  isOpen: boolean;
  cards: Card[];
  decks: Deck[];
  pages: Page[];
  repository: DeckRepository;
  onDataChange: () => Promise<void>;
  onEditNote: (card: Card) => void;
  onError: (message: string) => void;
  offerUndo: (action: UndoAction) => void;
}

export function TaskManager({
  isOpen,
  cards,
  decks,
  pages,
  repository,
  onDataChange,
  onEditNote,
  onError,
  offerUndo,
}: TaskManagerProps) {
  const [draft, setDraft] = useState('');
  const [isCompleted, setIsCompleted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const managerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (isOpen) managerRef.current?.focus();
  }, [isOpen]);
  const activePageIds = new Set(
    pages.filter(({ deletedAt }) => deletedAt === null).map(({ id }) => id),
  );
  const activeDeckIds = new Set(
    decks
      .filter(
        (deck) =>
          deck.deletedAt === null &&
          (deck.kind !== 'normal' || activePageIds.has(deck.pageId)),
      )
      .map(({ id }) => id),
  );
  const tasks = cards.filter(
    (card) =>
      card.kind === 'task' &&
      card.deletedAt === null &&
      activeDeckIds.has(card.deckId),
  );
  const visible = tasks
    .filter((card) => Boolean(card.done) === isCompleted)
    .toSorted((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const run = async (write: () => Promise<void>) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await write();
      await onDataChange();
    } catch (error) {
      onError(
        `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsSaving(false);
    }
  };
  const add = () =>
    run(async () => {
      await createTask(repository, draft);
      setDraft('');
      setIsCompleted(false);
      inputRef.current?.focus();
    });
  const toggle = (card: Card) =>
    run(async () => {
      await repository.upsertCard({
        ...card,
        done: !card.done,
        updatedAt: Date.now(),
      });
    });
  const trash = (card: Card) =>
    run(async () => {
      await repository.softDelete('card', card.id);
      offerUndo({
        label: strings.trashedCards(1),
        undo: async () => {
          await repository.restore('card', card.id);
          await onDataChange();
        },
      });
    });
  return (
    <section
      ref={managerRef}
      tabIndex={-1}
      data-deck="task-manager"
      className="deck-task-manager"
      aria-label={strings.tasks}
      aria-busy={isSaving}
    >
      <header data-deck="tasks-header">
        <h1 data-deck="tasks-title">{strings.tasks}</h1>
        <p data-deck="tasks-description">{strings.tasksDescription}</p>
      </header>
      <form
        data-deck="task-add"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <input
          ref={inputRef}
          data-deck="task-input"
          aria-label={strings.taskPlaceholder}
          placeholder={strings.taskPlaceholder}
          value={draft}
          maxLength={NOTE_MAX_LENGTH}
          readOnly={isSaving}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <button
          data-deck="task-submit"
          type="submit"
          disabled={isSaving || !draft.trim()}
        >
          {strings.addTask}
        </button>
      </form>
      <div
        data-deck="task-filters"
        className="deck-task-filters"
        role="group"
        aria-label={strings.taskStatus}
      >
        {[false, true].map((completed) => (
          <button
            key={String(completed)}
            type="button"
            data-deck="task-filter"
            aria-pressed={isCompleted === completed}
            onClick={() => setIsCompleted(completed)}
          >
            {completed ? strings.completedTasks : strings.openTasks}{' '}
            <span data-deck="task-count">
              {tasks.filter((card) => Boolean(card.done) === completed).length}
            </span>
          </button>
        ))}
      </div>
      <ul data-deck="task-list" className="deck-task-list">
        {visible.map((card) => (
          <li
            key={card.id}
            data-deck="task"
            data-task-id={card.id}
            data-done={card.done || undefined}
          >
            <button
              type="button"
              role="checkbox"
              data-deck="task-done"
              aria-checked={Boolean(card.done)}
              aria-label={strings.toggleTask(card.title)}
              disabled={isSaving}
              onClick={() => void toggle(card)}
            >
              <Icon name="check" />
            </button>
            <button
              type="button"
              data-deck="task-note"
              className="deck-blurrable"
              onClick={() => onEditNote(card)}
            >
              {card.title}
            </button>
            <button
              type="button"
              data-deck="task-trash"
              aria-label={strings.trashTask}
              title={strings.trashTask}
              disabled={isSaving}
              onClick={() => void trash(card)}
            >
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      {!visible.length && (
        <p data-deck="tasks-empty" className="deck-tasks-empty" role="status">
          {isCompleted ? strings.noCompletedTasks : strings.noOpenTasks}
        </p>
      )}
    </section>
  );
}
