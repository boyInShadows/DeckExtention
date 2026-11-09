// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import {
  createElement,
  render,
  click,
  type,
  type RenderResult,
} from '../../src/testing/render';
import FocusPanel from '../../src/focus/FocusPanel';
import {
  emptyFocus,
  transitionFocus,
  type FocusAction,
} from '../../src/focus/model';

let view: RenderResult | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
  vi.restoreAllMocks();
});

function setup() {
  let state = emptyFocus();
  const changeFocus = vi.fn(async (action: FocusAction) => {
    state = transitionFocus(state, action, Date.now(), 'focus_test');
    return state;
  });
  const onError = vi.fn();
  const repository = { changeFocus };
  return { repository, changeFocus, onError };
}

async function pressFocus(label: string) {
  const result = view;
  if (!result) throw new Error('Focus view missing');
  const button = result.getByLabel<HTMLButtonElement>(label);
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  await result.act(() => click(button));
}

it('offers the 25-minute timer and persists start, pause, resume and stop actions', async () => {
  const data = setup();
  view = await render(
    createElement(FocusPanel, {
      ...data,
      cards: [],
      decks: [],
      pages: [],
      isOpen: true,
    }),
  );
  await vi.waitFor(() =>
    expect(view?.container.textContent).toContain('25:00'),
  );
  await pressFocus('Start focus');
  await vi.waitFor(() =>
    expect(data.changeFocus).toHaveBeenCalledWith({
      type: 'start',
      minutes: 25,
    }),
  );
  await pressFocus('Pause focus');
  expect(data.changeFocus).toHaveBeenCalledWith({
    type: 'pause',
    id: 'focus_test',
  });
  await pressFocus('Resume focus');
  expect(data.changeFocus).toHaveBeenCalledWith({
    type: 'resume',
    id: 'focus_test',
  });
  await pressFocus('Stop focus');
  expect(data.changeFocus).toHaveBeenCalledWith({
    type: 'stop',
    id: 'focus_test',
  });
  expect(data.onError).not.toHaveBeenCalled();
});

it('reports failed writes and keeps the duration draft available', async () => {
  const data = setup();
  view = await render(
    createElement(FocusPanel, {
      ...data,
      cards: [],
      decks: [],
      pages: [],
      isOpen: true,
    }),
  );
  await vi.waitFor(() =>
    expect(view?.getByLabel('Start focus').hasAttribute('disabled')).toBe(
      false,
    ),
  );
  data.changeFocus.mockRejectedValueOnce(new Error('Storage full'));
  await pressFocus('Start focus');
  expect(data.onError).toHaveBeenCalledWith(
    expect.stringContaining('Storage full'),
  );
  expect(view.get<HTMLInputElement>('input').value).toBe('25');
  await vi.waitFor(() =>
    expect(view?.getByLabel('Start focus').hasAttribute('disabled')).toBe(
      false,
    ),
  );
});

it('previews the edited duration before starting a focus session', async () => {
  const data = setup();
  const result = await render(
    createElement(FocusPanel, {
      ...data,
      cards: [],
      decks: [],
      pages: [],
      isOpen: true,
    }),
  );
  view = result;
  await vi.waitFor(() =>
    expect(result.getByLabel<HTMLButtonElement>('Start focus').disabled).toBe(
      false,
    ),
  );
  await result.act(() => type(result.get<HTMLInputElement>('input'), '5'));
  expect(result.get('[data-deck="focus-countdown"]').textContent).toBe('05:00');
});
