// @vitest-environment happy-dom
import type { KeyBinding } from 'deck-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { panelStrings as strings } from '../i18n/panelStrings';
import { click, keyDown, render, type RenderResult } from '../testing/render';
import { KeymapEditor } from './KeymapEditor';

const RECORDING = '[data-recording]';

afterEach(() => {
  document.body.replaceChildren();
});

/** The item at `index`, failing the test loudly when it is missing. */
function nth<T>(items: readonly T[], index = 0): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Expected an item at ${index}`);
  return item;
}

async function startRecording(
  view: RenderResult,
  label: string,
): Promise<HTMLElement> {
  await view.act(() => click(view.getByLabel(label)));
  return view.get<HTMLElement>(RECORDING);
}

function alertText(view: RenderResult): string | null {
  return view.query('[role="alert"]')?.textContent ?? null;
}

describe('KeymapEditor', () => {
  it('shows every action with its default chord and no Reset', async () => {
    const view = await render(
      <KeymapEditor overrides={[]} onChange={vi.fn()} />,
    );
    expect(view.getByLabel(`${strings.keyLabels.next}: j`)).toBeTruthy();
    expect(
      view.getByLabel(`${strings.keyLabels.openInNewTab}: Shift+Enter`),
    ).toBeTruthy();
    expect(view.container.textContent).not.toContain(strings.resetKey);
    view.unmount();
  });

  it('records a new chord, focusing the recorder and storing the override', async () => {
    const onChange = vi.fn();
    const view = await render(
      <KeymapEditor overrides={[]} onChange={onChange} />,
    );
    const recorder = await startRecording(view, `${strings.keyLabels.next}: j`);
    expect(document.activeElement).toBe(recorder);
    expect(recorder.textContent).toBe(strings.pressKeys);

    let event: KeyboardEvent | undefined;
    await view.act(() => {
      event = keyDown(recorder, 'z');
    });
    expect(event?.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledWith([{ action: 'next', chord: 'z' }]);
    expect(view.query(RECORDING)).toBeNull();
    view.unmount();
  });

  it('keeps the key press from reaching listeners outside the editor', async () => {
    const view = await render(
      <KeymapEditor overrides={[]} onChange={vi.fn()} />,
    );
    const outer = vi.fn();
    view.container.addEventListener('keydown', outer);
    const recorder = await startRecording(view, `${strings.keyLabels.next}: j`);
    await view.act(() => {
      keyDown(recorder, 'z');
    });
    expect(outer).not.toHaveBeenCalled();
    view.unmount();
  });

  it('waits through a bare modifier press', async () => {
    const onChange = vi.fn();
    const view = await render(
      <KeymapEditor overrides={[]} onChange={onChange} />,
    );
    const recorder = await startRecording(view, `${strings.keyLabels.next}: j`);
    await view.act(() => {
      keyDown(recorder, 'Shift', { shiftKey: true });
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(view.query(RECORDING)).not.toBeNull();
    view.unmount();
  });

  it('cancels on Escape without changing anything', async () => {
    const onChange = vi.fn();
    const view = await render(
      <KeymapEditor overrides={[]} onChange={onChange} />,
    );
    const recorder = await startRecording(view, `${strings.keyLabels.next}: j`);
    await view.act(() => {
      keyDown(recorder, '?');
    });
    expect(alertText(view)).toBe(strings.keyReserved);

    await view.act(() => {
      keyDown(view.get(RECORDING), 'Escape');
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(view.query(RECORDING)).toBeNull();
    expect(alertText(view)).toBeNull();
    view.unmount();
  });

  it('refuses a plain-character surface key bound to a modified chord', async () => {
    const onChange = vi.fn();
    const view = await render(
      <KeymapEditor overrides={[]} onChange={onChange} />,
    );
    const recorder = await startRecording(
      view,
      `${strings.keyLabels.focusLine}: /`,
    );
    await view.act(() => {
      keyDown(recorder, 'k', { ctrlKey: true });
    });
    expect(alertText(view)).toBe(strings.keySingleCharacter);
    expect(onChange).not.toHaveBeenCalled();
    view.unmount();
  });

  it('names the action a conflicting chord already belongs to', async () => {
    const onChange = vi.fn();
    const view = await render(
      <KeymapEditor overrides={[]} onChange={onChange} />,
    );
    const recorder = await startRecording(view, `${strings.keyLabels.next}: j`);
    await view.act(() => {
      keyDown(recorder, 'k');
    });
    expect(alertText(view)).toBe(
      `${strings.keyConflict} ${strings.keyLabels.previous}.`,
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(view.query(RECORDING)).not.toBeNull();
    view.unmount();
  });

  it('clears an old problem when a new recording starts', async () => {
    const view = await render(
      <KeymapEditor overrides={[]} onChange={vi.fn()} />,
    );
    const recorder = await startRecording(view, `${strings.keyLabels.next}: j`);
    await view.act(() => {
      keyDown(recorder, 'k');
    });
    expect(alertText(view)).not.toBeNull();

    await view.act(() => {
      recorder.blur();
    });
    expect(view.query(RECORDING)).toBeNull();
    expect(alertText(view)).not.toBeNull();

    await startRecording(view, `${strings.keyLabels.move}: m`);
    expect(alertText(view)).toBeNull();
    view.unmount();
  });

  it('resets an overridden key back to its default', async () => {
    const overrides: KeyBinding[] = [
      { action: 'next', chord: 'z' },
      { action: 'trash', chord: 'Ctrl+x' },
    ];
    const onChange = vi.fn();
    const view = await render(
      <KeymapEditor overrides={overrides} onChange={onChange} />,
    );
    expect(view.getByLabel(`${strings.keyLabels.next}: z`)).toBeTruthy();
    const resets = view
      .getAll('button')
      .filter((button) => button.textContent === strings.resetKey);
    expect(resets).toHaveLength(overrides.length);

    await view.act(() => click(nth(resets)));
    expect(onChange).toHaveBeenCalledWith([
      { action: 'trash', chord: 'Ctrl+x' },
    ]);
    expect(overrides).toHaveLength(2);
    view.unmount();
  });
});
