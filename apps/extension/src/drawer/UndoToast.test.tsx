// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';

import { keyDown, render } from '../testing/render';
import UndoToast from './UndoToast';

afterEach(() => vi.useRealTimers());

it('undoes with Ctrl+Z but leaves text editing alone', async () => {
  vi.useFakeTimers();
  const undo = vi.fn(async () => undefined);
  const onDismiss = vi.fn();
  const onError = vi.fn();
  const view = await render(
    <UndoToast
      action={{ label: 'Trashed card', undo }}
      onDismiss={onDismiss}
      onError={onError}
    />,
  );
  try {
    const input = document.createElement('input');
    document.body.append(input);
    await view.act(() => {
      keyDown(input, 'z', { ctrlKey: true });
    });
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.append(editor);
    await view.act(() => {
      keyDown(editor, 'z', { ctrlKey: true });
    });
    expect(undo).not.toHaveBeenCalled();
    await view.act(() => {
      keyDown(window, 'z', { ctrlKey: true });
    });
    expect(undo).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledWith(null);
    expect(onError).not.toHaveBeenCalled();
    input.remove();
    editor.remove();
  } finally {
    view.unmount();
  }
});

it('dismisses after six seconds', async () => {
  vi.useFakeTimers();
  const onDismiss = vi.fn();
  const view = await render(
    <UndoToast
      action={{ label: 'Trashed card', undo: async () => undefined }}
      onDismiss={onDismiss}
      onError={vi.fn()}
    />,
  );
  try {
    await view.act(() => {
      vi.advanceTimersByTime(5_999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await view.act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledWith(null);
  } finally {
    view.unmount();
  }
});
