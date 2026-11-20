// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import {
  createElement,
  render,
  type RenderResult,
} from '../../src/testing/render';
import FocusMonitor from '../../src/focus/FocusMonitor';
import { SectionNav } from '../../src/newtab/SectionNav';
import { emptyFocus, transitionFocus } from '../../src/focus/model';
import type { DeckRepository } from '../../src/storage/repository';

let view: RenderResult | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
  vi.restoreAllMocks();
});

it('announces a completion on return when the hidden tab already settled its deadline', async () => {
  let isHidden = true;
  const hidden = vi
    .spyOn(document, 'hidden', 'get')
    .mockImplementation(() => isHidden);
  const start = Date.now() - 120_000;
  const running = transitionFocus(
    emptyFocus(),
    { type: 'start', minutes: 1 },
    start,
    'focus_hidden',
  );
  const state = transitionFocus(running, { type: 'sync' }, start + 60_000);
  const entry = state.history[0];
  const changeFocus = vi.fn(async () => structuredClone(state));
  const takeFocusCompletion = vi.fn(async () => entry ?? null);
  const onComplete = vi.fn();
  const onError = vi.fn();
  const repository = {
    changeFocus,
    takeFocusCompletion,
  } as unknown as DeckRepository;
  view = await render(
    createElement(FocusMonitor, { repository, onComplete, onError }),
  );
  await vi.waitFor(() => expect(changeFocus).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(hidden).toHaveBeenCalled());
  expect(takeFocusCompletion).not.toHaveBeenCalled();
  await view.act(() => {
    isHidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith(entry));
  expect(onError).not.toHaveBeenCalled();
});

it('shows running and paused progress in the existing Focus button and removes it on stop', async () => {
  let now = new Date(2026, 10, 20, 10).getTime();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  let state = transitionFocus(
    emptyFocus(),
    { type: 'start', minutes: 1 },
    now,
    'focus_compact',
  );
  const repository = {
    changeFocus: vi.fn(async () => {
      state = transitionFocus(state, { type: 'sync' }, now);
      return structuredClone(state);
    }),
    takeFocusCompletion: vi.fn(async () => null),
  } as unknown as DeckRepository;
  const onOpen = vi.fn();
  const onError = vi.fn();
  view = await render(
    createElement(
      'div',
      null,
      createElement(SectionNav, {
        selectedId: null,
        linksPageId: 'links',
        onOpen,
      }),
      createElement(FocusMonitor, { repository, onComplete: vi.fn(), onError }),
    ),
  );
  await vi.waitFor(() =>
    expect(view?.query('[data-deck="focus-indicator"]')).not.toBeNull(),
  );
  now += 30_000;
  await view.act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await vi.waitFor(() =>
    expect(view?.get('[data-deck="focus-compact-countdown"]').textContent).toBe(
      '00:30',
    ),
  );
  expect(view.get<HTMLProgressElement>('progress').value).toBe(0.5);
  await view.act(() =>
    view?.getByLabel<HTMLButtonElement>('Open Focus').click(),
  );
  expect(onOpen).toHaveBeenCalledWith('focus');
  state = transitionFocus(state, { type: 'pause', id: 'focus_compact' }, now);
  now += 120_000;
  await view.act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await vi.waitFor(() =>
    expect(
      view?.get('[data-deck="focus-indicator"]').getAttribute('title'),
    ).toContain('Focus paused'),
  );
  expect(view.get('[data-deck="focus-compact-countdown"]').textContent).toBe(
    '00:30',
  );
  expect(view.get<HTMLProgressElement>('progress').value).toBe(0.5);
  state = transitionFocus(state, { type: 'stop', id: 'focus_compact' }, now);
  await view.act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await vi.waitFor(() =>
    expect(view?.query('[data-deck="focus-indicator"]')).toBeNull(),
  );
  expect(onError).not.toHaveBeenCalled();
});
