import type { Card } from 'deck-schema';
import { useCallback, useLayoutEffect, useRef } from 'react';

import { selectionOf } from './inboxModel';
import { activeCards } from './workspaceModel';

export type TriageWrite = (cards: Card[], ids: string[]) => Promise<Card[]>;

/** The live triage state: kept current on every render, read when a job runs. */
export interface TriageSnapshot {
  cards: Card[];
  cursor: number;
  anchor: number | null;
}

export interface TriageJobCallbacks {
  onCardsChange: (cards: Card[]) => void;
  onError: (error: unknown) => void;
  onSettled: () => void;
}

/**
 * One queued triage write. The selection is resolved when the job starts, not
 * when the key was pressed, and after the write only what this job owns is
 * patched back: the cards, and the anchor - only if nobody moved it meanwhile.
 * Restoring the whole pre-write snapshot would rewind cursor moves made while
 * the write was in flight and aim the next queued key at the wrong card.
 */
export async function runTriageJob(
  latest: { current: TriageSnapshot },
  inboxId: string | undefined,
  write: TriageWrite,
  callbacks: TriageJobCallbacks,
): Promise<void> {
  const started = latest.current;
  const ids = inboxId
    ? activeCards(started.cards, inboxId).map(({ id }) => id)
    : [];
  const targets = selectionOf(ids, started.cursor, started.anchor);
  if (targets.length === 0) return;
  try {
    const next = await write(started.cards, targets);
    const live = latest.current;
    latest.current = {
      ...live,
      cards: next,
      anchor: live.anchor === started.anchor ? null : live.anchor,
    };
    callbacks.onCardsChange(next);
  } catch (error) {
    callbacks.onError(error);
  }
  callbacks.onSettled();
}

interface TriageQueueOptions extends TriageJobCallbacks, TriageSnapshot {
  inboxId: string | undefined;
}

/**
 * Runs triage writes one at a time. Keys arrive faster than IndexedDB
 * answers; without the queue, five quick `x` presses all read the same render
 * and four keystrokes are silently lost.
 */
export function useTriageQueue(options: TriageQueueOptions) {
  const { cards, inboxId, cursor, anchor } = options;
  const { onCardsChange, onError, onSettled } = options;
  const latest = useRef<TriageSnapshot>({ cards, cursor, anchor });
  const queue = useRef<Promise<void>>(Promise.resolve());

  useLayoutEffect(() => {
    latest.current = { cards, cursor, anchor };
  }, [anchor, cards, cursor]);

  return useCallback(
    (write: TriageWrite) => {
      queue.current = queue.current.then(() =>
        runTriageJob(latest, inboxId, write, {
          onCardsChange,
          onError,
          onSettled,
        }),
      );
    },
    [inboxId, onCardsChange, onError, onSettled],
  );
}
