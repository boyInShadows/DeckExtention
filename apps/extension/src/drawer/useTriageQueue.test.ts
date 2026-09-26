import type { Card } from 'deck-schema';
import { describe, expect, it, vi } from 'vitest';

import { runTriageJob, type TriageSnapshot } from './useTriageQueue';

const INBOX = 'deck_inbox';

const card = (id: string, order: string): Card => ({
  id,
  deckId: INBOX,
  url: `https://${id}.test/`,
  title: id,
  hostname: `${id}.test`,
  order,
  pinned: false,
  lastOpenedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

const ABCD = [
  card('A', 'a0'),
  card('B', 'a1'),
  card('C', 'a2'),
  card('D', 'a3'),
];

/** A fake trash that resolves only when the test says so. */
function deferredTrash() {
  const calls: string[][] = [];
  let release = () => {};
  const write = (cards: Card[], ids: string[]) => {
    calls.push(ids);
    return new Promise<Card[]>((resolve) => {
      release = () =>
        resolve(
          cards.map((item) =>
            ids.includes(item.id) ? { ...item, deletedAt: 1 } : item,
          ),
        );
    });
  };
  return { calls, write, release: () => release() };
}

const callbacks = () => ({
  onCardsChange: vi.fn(),
  onError: vi.fn(),
  onSettled: vi.fn(),
});

describe('runTriageJob', () => {
  it('keeps cursor moves made while a write was in flight', async () => {
    const latest: { current: TriageSnapshot } = {
      current: { cards: ABCD, cursor: 0, anchor: null },
    };
    const trash = deferredTrash();
    const first = runTriageJob(latest, INBOX, trash.write, callbacks());

    // Two ArrowDowns land during the write: the cursor now shows C.
    latest.current = { ...latest.current, cursor: 2 };
    trash.release();
    await first;

    // After A is gone the list is [B, C, D]; C sits at index 1, but the
    // user's cursor stays at 2 -> D. What matters: it is not rewound to 0.
    expect(latest.current.cursor).toBe(2);
    expect(trash.calls).toEqual([['A']]);

    const second = runTriageJob(latest, INBOX, trash.write, callbacks());
    trash.release();
    await second;
    expect(trash.calls[1]).toEqual(['D']);
    expect(trash.calls[1]).not.toEqual(['B']);
  });

  it('acts on the latest cards when jobs queue behind each other', async () => {
    const latest: { current: TriageSnapshot } = {
      current: { cards: ABCD, cursor: 0, anchor: null },
    };
    const trash = deferredTrash();
    const first = runTriageJob(latest, INBOX, trash.write, callbacks());
    trash.release();
    await first;
    const second = runTriageJob(latest, INBOX, trash.write, callbacks());
    trash.release();
    await second;
    expect(trash.calls).toEqual([['A'], ['B']]);
  });

  it('clears a used range, but not one the user changed mid-write', async () => {
    const latest: { current: TriageSnapshot } = {
      current: { cards: ABCD, cursor: 1, anchor: 0 },
    };
    const trash = deferredTrash();
    const job = runTriageJob(latest, INBOX, trash.write, callbacks());
    trash.release();
    await job;
    expect(trash.calls).toEqual([['A', 'B']]);
    expect(latest.current.anchor).toBeNull();

    const next = runTriageJob(latest, INBOX, trash.write, callbacks());
    latest.current = { ...latest.current, anchor: 1 };
    trash.release();
    await next;
    expect(latest.current.anchor).toBe(1);
  });

  it('reports a failed write and leaves the cards untouched', async () => {
    const latest: { current: TriageSnapshot } = {
      current: { cards: ABCD, cursor: 0, anchor: null },
    };
    const spies = callbacks();
    await runTriageJob(
      latest,
      INBOX,
      () => Promise.reject(new Error('disk full')),
      spies,
    );
    expect(spies.onError).toHaveBeenCalledWith(new Error('disk full'));
    expect(spies.onCardsChange).not.toHaveBeenCalled();
    expect(spies.onSettled).toHaveBeenCalledOnce();
    expect(latest.current.cards).toBe(ABCD);
  });

  it('does nothing when there is nothing under the cursor', async () => {
    const latest: { current: TriageSnapshot } = {
      current: { cards: [], cursor: 0, anchor: null },
    };
    const write = vi.fn();
    await runTriageJob(latest, INBOX, write, callbacks());
    await runTriageJob(latest, undefined, write, callbacks());
    expect(write).not.toHaveBeenCalled();
  });
});
