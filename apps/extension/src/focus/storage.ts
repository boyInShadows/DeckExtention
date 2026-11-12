import { CardSchema } from 'deck-schema';
import type { DeckDatabaseHandle } from '../storage/database';
import { panelStrings as strings } from '../i18n/panelStrings';
import {
  emptyFocus,
  FOCUS_CHANNEL,
  FOCUS_KEY,
  FocusStateSchema,
  FocusActionSchema,
  transitionFocus,
  type FocusAction,
  type FocusState,
  type FocusEntry,
} from './model';

export function broadcastFocus(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(FOCUS_CHANNEL);
  channel.postMessage(null);
  channel.close();
}

export async function changeFocus(
  database: DeckDatabaseHandle,
  action: FocusAction,
  now: number,
  createId: () => string,
): Promise<FocusState> {
  FocusActionSchema.parse(action);
  const tx = database.transaction(['meta', 'cards'], 'readwrite');
  const record = await tx.objectStore('meta').get(FOCUS_KEY);
  const stored = record ? FocusStateSchema.parse(record.value) : emptyFocus();
  let task = null;
  if (action.type === 'start' && action.taskId) {
    const card = CardSchema.parse(
      await tx.objectStore('cards').get(action.taskId),
    );
    if (card.kind !== 'task' || card.deletedAt !== null || card.done)
      throw new Error(strings.focusInvalidTask);
    task = { id: card.id, title: card.title };
  }
  const state = FocusStateSchema.parse(
    transitionFocus(
      stored,
      action,
      now,
      action.type === 'start' ? createId() : undefined,
      task,
    ),
  );
  const isChanged = JSON.stringify(state) !== JSON.stringify(stored);
  if (isChanged)
    await Promise.all([
      tx.objectStore('meta').put({ key: FOCUS_KEY, value: state }),
      tx.done,
    ]);
  else await tx.done;
  if (isChanged) broadcastFocus();
  return state;
}

export async function takeFocusCompletion(
  database: DeckDatabaseHandle,
): Promise<FocusEntry | null> {
  const tx = database.transaction('meta', 'readwrite');
  const record = await tx.store.get(FOCUS_KEY);
  const state = record ? FocusStateSchema.parse(record.value) : emptyFocus();
  const completed =
    state.history.find(({ id }) => id === state.unreadId) ?? null;
  if (completed)
    await Promise.all([
      tx.store.put({ key: FOCUS_KEY, value: { ...state, unreadId: null } }),
      tx.done,
    ]);
  else await tx.done;
  return completed;
}

export function mergedFocus(
  current: FocusState,
  incoming: FocusState,
): FocusState {
  const entries = new Map(current.history.map((entry) => [entry.id, entry]));
  for (const entry of incoming.history) {
    const previous = entries.get(entry.id);
    if (
      (previous && JSON.stringify(previous) !== JSON.stringify(entry)) ||
      current.active?.id === entry.id
    )
      throw new Error(strings.focusMergeConflict);
    entries.set(entry.id, entry);
  }
  const active =
    incoming.active && !entries.has(incoming.active.id)
      ? incoming.active
      : null;
  if (
    active &&
    current.active &&
    JSON.stringify(active) !== JSON.stringify(current.active)
  )
    throw new Error(strings.focusMergeConflict);
  return FocusStateSchema.parse({
    ...current,
    active: current.active ?? active,
    history: [...entries.values()].toSorted(
      (a, b) => a.endedAt - b.endedAt || a.id.localeCompare(b.id),
    ),
    unreadId: current.unreadId ?? incoming.unreadId,
  });
}

export async function mergeFocus(
  database: DeckDatabaseHandle,
  incoming: FocusState,
  isPreview: boolean,
): Promise<void> {
  const tx = database.transaction('meta', 'readwrite');
  const record = await tx.store.get(FOCUS_KEY);
  const state = mergedFocus(
    record ? FocusStateSchema.parse(record.value) : emptyFocus(),
    incoming,
  );
  if (!isPreview)
    await Promise.all([
      tx.store.put({ key: FOCUS_KEY, value: state }),
      tx.done,
    ]);
  else await tx.done;
  if (!isPreview) broadcastFocus();
}
