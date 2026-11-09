import { describe, expect, it } from 'vitest';
import {
  emptyFocus,
  focusElapsed,
  transitionFocus,
  focusSummary,
  FocusStateSchema,
} from '../../src/focus/model';

const START = new Date(2026, 10, 9, 10).getTime();
const MINUTE = 60_000;
const task = { id: 'task_focus', title: 'Read a chapter' };
const begin = () =>
  transitionFocus(
    emptyFocus(),
    { type: 'start', minutes: 25 },
    START,
    'focus_1',
  );
const active = (state: ReturnType<typeof emptyFocus>) => {
  if (!state.active) throw new Error('Session missing');
  return state.active;
};

describe('focus countdown', () => {
  it('starts standalone and computes elapsed time without timer ticks', () => {
    const state = begin();
    expect(state.active?.task).toBeNull();
    expect(focusElapsed(active(state), START + MINUTE)).toBe(MINUTE);
    expect(focusElapsed(active(state), START - MINUTE)).toBe(0);
    expect(emptyFocus().minutes).toBe(25);
  });

  it('excludes paused time and keeps a stopped partial task session', () => {
    const started = transitionFocus(
      emptyFocus(),
      { type: 'start', minutes: 25 },
      START,
      'focus_1',
      task,
    );
    const paused = transitionFocus(
      started,
      { type: 'pause', id: 'focus_1' },
      START + MINUTE,
    );
    expect(focusElapsed(active(paused), START + 10 * MINUTE)).toBe(MINUTE);
    const resumed = transitionFocus(
      paused,
      { type: 'resume', id: 'focus_1' },
      START + 10 * MINUTE,
    );
    const stopped = transitionFocus(
      resumed,
      { type: 'stop', id: 'focus_1' },
      START + 11 * MINUTE,
    );
    expect(stopped.active).toBeNull();
    expect(stopped.history[0]).toMatchObject({
      elapsedMs: 2 * MINUTE,
      isCompleted: false,
      task,
    });
    expect(focusSummary(stopped, START + 11 * MINUTE)).toMatchObject({
      totalMs: 2 * MINUTE,
      streak: 0,
    });
    expect(started.active?.elapsedMs).toBe(0);
  });

  it('settles completion at the deadline after a closed-page gap, exactly once', () => {
    const state = begin();
    const ended = transitionFocus(state, { type: 'sync' }, START + 30 * MINUTE);
    expect(ended.active).toBeNull();
    expect(ended.history).toHaveLength(1);
    expect(ended.history[0]).toMatchObject({
      endedAt: START + 25 * MINUTE,
      elapsedMs: 25 * MINUTE,
      isCompleted: true,
    });
    expect(ended.unreadId).toBe('focus_1');
    expect(
      transitionFocus(ended, { type: 'sync' }, START + 40 * MINUTE),
    ).toEqual(ended);
  });

  it('rejects overlapping starts and stale actions without replacing the timer', () => {
    const state = begin();
    expect(() =>
      transitionFocus(state, { type: 'start', minutes: 5 }, START),
    ).toThrow();
    expect(() =>
      transitionFocus(state, { type: 'stop', id: 'other_1' }, START),
    ).toThrow();
    expect(() =>
      transitionFocus(
        emptyFocus(),
        { type: 'start', minutes: 0 },
        START,
        'focus_1',
      ),
    ).toThrow();
    expect(() =>
      transitionFocus(
        emptyFocus(),
        { type: 'start', minutes: 181 },
        START,
        'focus_1',
      ),
    ).toThrow();
  });

  it('counts one completed streak day and includes yesterday until today ends', () => {
    const first = transitionFocus(
      begin(),
      { type: 'sync' },
      START + 25 * MINUTE,
    );
    const second = transitionFocus(
      first,
      { type: 'start', minutes: 1 },
      START + 30 * MINUTE,
      'focus_2',
    );
    const done = transitionFocus(second, { type: 'sync' }, START + 31 * MINUTE);
    expect(focusSummary(done, START + 31 * MINUTE)).toMatchObject({
      streak: 1,
      totalMs: 26 * MINUTE,
    });
    const tomorrow = new Date(2026, 10, 10, 10).getTime();
    expect(focusSummary(done, tomorrow).streak).toBe(1);
    const third = transitionFocus(
      done,
      { type: 'start', minutes: 1 },
      tomorrow,
      'focus_3',
    );
    const finished = transitionFocus(
      third,
      { type: 'sync' },
      tomorrow + MINUTE,
    );
    expect(focusSummary(finished, tomorrow + MINUTE).streak).toBe(2);
    expect(
      focusSummary(finished, new Date(2026, 10, 13).getTime()).streak,
    ).toBe(0);
  });

  it('validates storage rather than silently accepting impossible or duplicate history', () => {
    const done = transitionFocus(
      begin(),
      { type: 'sync' },
      START + 25 * MINUTE,
    );
    expect(
      FocusStateSchema.safeParse({
        ...done,
        history: [...done.history, ...done.history],
      }).success,
    ).toBe(false);
    expect(
      FocusStateSchema.safeParse({
        ...begin(),
        active: { ...begin().active, elapsedMs: -1 },
      }).success,
    ).toBe(false);
    expect(
      FocusStateSchema.safeParse({ ...emptyFocus(), unreadId: 'missing_1' })
        .success,
    ).toBe(false);
  });
});
