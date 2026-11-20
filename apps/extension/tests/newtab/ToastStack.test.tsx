// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';

import { keyDown, render } from '../../src/testing/render';
import ToastStack, { type Notice } from '../../src/newtab/ToastStack';

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

it('keeps a completion popup available while its secondary sound action replays', async () => {
  const sound = vi.fn(async () => undefined);
  const dismiss = vi.fn();
  const open = vi.fn();
  const view = await render(
    <ToastStack
      notices={[
        {
          id: 'focus',
          source: 'focus',
          kind: 'info',
          text: 'Focus complete.',
          action: { label: 'View focus', run: open },
          secondaryAction: { label: 'Play sound', run: sound },
        },
      ]}
      dismiss={dismiss}
      notify={vi.fn()}
    />,
  );
  await view.act(() =>
    view.getByLabel<HTMLButtonElement>('Play sound').click(),
  );
  await view.act(() =>
    view.getByLabel<HTMLButtonElement>('Play sound').click(),
  );
  expect(sound).toHaveBeenCalledTimes(2);
  expect(dismiss).not.toHaveBeenCalled();
  expect(view.get('[data-deck="toast"]').getAttribute('data-source')).toBe(
    'focus',
  );
  await view.act(() =>
    view.getByLabel<HTMLButtonElement>('View focus').click(),
  );
  expect(open).toHaveBeenCalledTimes(1);
  expect(dismiss).toHaveBeenCalledWith('focus');
  view.unmount();
});

it('reports a failed secondary action without dismissing the popup and permits retry', async () => {
  const sound = vi
    .fn(async () => undefined)
    .mockRejectedValueOnce(new Error('Sound blocked'));
  const dismiss = vi.fn();
  const notify = vi.fn();
  const view = await render(
    <ToastStack
      notices={[
        {
          id: 'focus',
          source: 'focus',
          kind: 'info',
          text: 'Focus complete.',
          action: { label: 'View focus', run: vi.fn() },
          secondaryAction: { label: 'Play sound', run: sound },
        },
      ]}
      dismiss={dismiss}
      notify={notify}
    />,
  );
  await view.act(() =>
    view.getByLabel<HTMLButtonElement>('Play sound').click(),
  );
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'error',
      text: expect.stringContaining('Sound blocked'),
    }),
  );
  expect(dismiss).not.toHaveBeenCalled();
  await view.act(() =>
    view.getByLabel<HTMLButtonElement>('Play sound').click(),
  );
  expect(sound).toHaveBeenCalledTimes(2);
  view.unmount();
});
