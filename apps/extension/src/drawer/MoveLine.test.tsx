// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { panelStrings as strings } from '../i18n/panelStrings';
import { keyDown, render, type, type RenderResult } from '../testing/render';
import type { MoveTarget } from './inboxModel';
import { MoveLine } from './MoveLine';

const TARGETS: MoveTarget[] = [
  { deckId: 'deck_docs', label: 'Work › Docs' },
  { deckId: 'deck_api', label: 'Work › API' },
  { deckId: 'deck_fun', label: 'Home › Fun' },
];

afterEach(() => {
  document.body.replaceChildren();
});

async function renderMoveLine(
  overrides: Partial<{
    targets: MoveTarget[];
    recentDeckIds: string[];
  }> = {},
) {
  const onMove = vi.fn();
  const onCancel = vi.fn();
  const view = await render(
    <MoveLine
      targets={overrides.targets ?? TARGETS}
      recentDeckIds={overrides.recentDeckIds ?? []}
      onMove={onMove}
      onCancel={onCancel}
    />,
  );
  const input = view.get<HTMLInputElement>('input');
  return { view, input, onMove, onCancel };
}

function optionLabels(view: RenderResult): string[] {
  return view.getAll('[role="option"]').map((item) => item.textContent ?? '');
}

function activeLabel(view: RenderResult): string | null {
  return view.query('[aria-selected="true"]')?.textContent ?? null;
}

/** One keystroke per render, as a person types. */
async function press(view: RenderResult, input: HTMLInputElement, key: string) {
  await view.act(() => {
    keyDown(input, key);
  });
}

describe('MoveLine', () => {
  it('focuses its input and offers recent destinations first when empty', async () => {
    const { view, input } = await renderMoveLine({
      recentDeckIds: ['deck_fun'],
    });
    expect(document.activeElement).toBe(input);
    expect(optionLabels(view)).toEqual([
      'Home › Fun',
      'Work › Docs',
      'Work › API',
    ]);
    expect(input.getAttribute('aria-activedescendant')).toBe(
      'deck-move-results-0',
    );
    view.unmount();
  });

  it('moves the cursor with the arrows, clamped to the list', async () => {
    const { view, input } = await renderMoveLine();
    await view.act(() => {
      keyDown(input, 'ArrowUp');
    });
    expect(activeLabel(view)).toBe('Work › Docs');
    for (const _ of TARGETS) await press(view, input, 'ArrowDown');
    expect(activeLabel(view)).toBe('Home › Fun');
    await view.act(() => {
      keyDown(input, 'ArrowUp');
    });
    expect(activeLabel(view)).toBe('Work › API');
    view.unmount();
  });

  it('moves to the highlighted destination on Enter', async () => {
    const { view, input, onMove } = await renderMoveLine();
    await view.act(() => {
      keyDown(input, 'ArrowDown');
    });
    let enter: KeyboardEvent | undefined;
    await view.act(() => {
      enter = keyDown(input, 'Enter');
    });
    expect(enter?.defaultPrevented).toBe(true);
    expect(onMove).toHaveBeenCalledExactlyOnceWith('deck_api');
    view.unmount();
  });

  it('filters by what is typed and resets the cursor to the best match', async () => {
    const { view, input, onMove } = await renderMoveLine();
    await press(view, input, 'ArrowDown');
    await press(view, input, 'ArrowDown');
    await view.act(() => {
      type(input, 'fun');
    });
    expect(optionLabels(view)).toEqual(['Home › Fun']);
    await view.act(() => {
      keyDown(input, 'Enter');
    });
    expect(onMove).toHaveBeenCalledExactlyOnceWith('deck_fun');
    view.unmount();
  });

  it('says nothing matched, and Enter then moves nowhere', async () => {
    const { view, input, onMove } = await renderMoveLine();
    await view.act(() => {
      type(input, 'zzz');
    });
    expect(view.query('[role="listbox"]')).toBeNull();
    expect(view.container.textContent).toContain(strings.noDeckMatch);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    await view.act(() => {
      keyDown(input, 'Enter');
    });
    expect(onMove).not.toHaveBeenCalled();
    view.unmount();
  });

  it('asks for a deck first when there is nowhere to move', async () => {
    const { view } = await renderMoveLine({ targets: [] });
    expect(view.container.textContent).toContain(strings.noDecks);
    view.unmount();
  });

  it('cancels on Escape and on blur', async () => {
    const { view, input, onCancel } = await renderMoveLine();
    let escape: KeyboardEvent | undefined;
    await view.act(() => {
      escape = keyDown(input, 'Escape');
    });
    expect(escape?.defaultPrevented).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    await view.act(() => {
      // preact/compat listens for onBlur as the bubbling focusout.
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('keeps typed keys from reaching the triage list underneath', async () => {
    const { view, input, onMove, onCancel } = await renderMoveLine();
    const outer = vi.fn();
    view.container.addEventListener('keydown', outer);
    const typed = keyDown(input, 'x');
    expect(outer).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    view.unmount();
  });

  it('moves on mousedown, before the blur could cancel', async () => {
    const { view, onMove } = await renderMoveLine();
    const option = view.getByText('Home › Fun');
    const press = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    option.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(onMove).toHaveBeenCalledExactlyOnceWith('deck_fun');
    view.unmount();
  });
});
