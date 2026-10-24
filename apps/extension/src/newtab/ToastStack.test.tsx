// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';

import { keyDown, render } from '../testing/render';
import ToastStack, { type Notice } from './ToastStack';

afterEach(() => vi.useRealTimers());

const success: Notice = { id: 'one', kind: 'success', text: 'Saved' };

it('dismisses success after four seconds and leaves errors until dismissed', async () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  const view = await render(
    <ToastStack
      notices={[success, { id: 'two', kind: 'error', text: 'Failed' }]}
      dismiss={dismiss}
      notify={vi.fn()}
    />,
  );
  await view.act(() => {
    vi.advanceTimersByTime(3_999);
  });
  expect(dismiss).not.toHaveBeenCalled();
  await view.act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(dismiss).toHaveBeenCalledExactlyOnceWith('one');
  await view.act(() => {
    vi.advanceTimersByTime(6_000);
  });
  expect(dismiss).toHaveBeenCalledTimes(1);
  view.unmount();
});

it('runs Undo with Ctrl+Z outside text editing and reports action failures', async () => {
  const undo = vi.fn(async () => {
    throw new Error('disk full');
  });
  const dismiss = vi.fn();
  const notify = vi.fn();
  const view = await render(
    <ToastStack
      notices={[{ ...success, action: { label: 'Undo', run: undo } }]}
      dismiss={dismiss}
      notify={notify}
    />,
  );
  const input = document.createElement('input');
  document.body.append(input);
  await view.act(() => {
    keyDown(input, 'z', { ctrlKey: true });
  });
  expect(undo).not.toHaveBeenCalled();
  await view.act(() => {
    keyDown(window, 'z', { ctrlKey: true });
    keyDown(window, 'z', { ctrlKey: true });
  });
  expect(undo).toHaveBeenCalledOnce();
  expect(dismiss).toHaveBeenCalledWith('one');
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'error',
      text: expect.stringContaining('disk full'),
    }),
  );
  input.remove();
  view.unmount();
});
