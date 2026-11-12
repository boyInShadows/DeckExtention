// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import {
  createElement,
  render,
  type RenderResult,
} from '../../src/testing/render';
import FocusMonitor from '../../src/focus/FocusMonitor';
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
