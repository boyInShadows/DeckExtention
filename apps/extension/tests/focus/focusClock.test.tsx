// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import {
  createElement,
  render,
  type RenderResult,
} from '../../src/testing/render';
import { useFocusNow } from '../../src/focus/focusClock';

let view: RenderResult | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Clock() {
  return createElement('output', null, String(useFocusNow(true)));
}

it('stops visual ticks while hidden and catches up on return, then cleans up', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 20, 10));
  let isHidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => isHidden);
  const start = Date.now();
  view = await render(createElement(Clock, {}));
  await view.act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(view.get('output').textContent).toBe(String(start + 1_000));
  await view.act(() => {
    isHidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(vi.getTimerCount()).toBe(0);
  await view.act(() => {
    vi.advanceTimersByTime(5_000);
  });
  expect(view.get('output').textContent).toBe(String(start + 1_000));
  await view.act(() => {
    isHidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(view.get('output').textContent).toBe(String(start + 6_000));
  view.unmount();
  view = undefined;
  expect(vi.getTimerCount()).toBe(0);
});
