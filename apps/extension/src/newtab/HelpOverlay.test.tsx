// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { panelStrings as strings } from '../i18n/panelStrings';
import { click, keyDown, render } from '../testing/render';
import HelpOverlay from './HelpOverlay';

function stubCommands(getAll: () => Promise<chrome.commands.Command[]>) {
  vi.stubGlobal('chrome', { commands: { getAll } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('HelpOverlay', () => {
  it('lists the browser shortcuts Chrome reports, marking unset ones', async () => {
    stubCommands(() =>
      Promise.resolve([
        {
          name: 'quick-save',
          description: 'Quick Save',
          shortcut: 'Ctrl+Shift+S',
        },
        { name: 'stash', description: 'Stash', shortcut: '' },
        { name: '_execute_action', description: 'hidden', shortcut: 'X' },
      ]),
    );
    const view = await render(
      <HelpOverlay keymapOverrides={[]} onClose={vi.fn()} />,
    );
    await view.act(async () => {});

    const text = view.container.textContent ?? '';
    expect(text).toContain('Ctrl+Shift+S');
    expect(text).toContain('Quick Save');
    expect(text).toContain(strings.keyNotSet);
    expect(text).not.toContain('hidden');
    view.unmount();
  });

  it('shows the error when Chrome cannot list commands', async () => {
    stubCommands(() => Promise.reject(new Error('no commands')));
    const view = await render(
      <HelpOverlay keymapOverrides={[]} onClose={vi.fn()} />,
    );
    await view.act(async () => {});
    expect(view.container.textContent).toContain('no commands');
    view.unmount();
  });

  it('closes on Escape, ?, Close and the backdrop - and keeps Tab inside', async () => {
    stubCommands(() => Promise.resolve([]));
    const onClose = vi.fn();
    const view = await render(
      <HelpOverlay keymapOverrides={[]} onClose={onClose} />,
    );
    const dialog = view.get('[data-deck="help"]');

    const tab = keyDown(dialog, 'Tab');
    expect(tab.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    keyDown(dialog, 'Escape');
    keyDown(dialog, '?');
    click(view.getByText(strings.close));
    click(view.get('.deck-help-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(4);

    click(dialog);
    keyDown(dialog, 'a');
    expect(onClose).toHaveBeenCalledTimes(4);
    view.unmount();
  });

  it('does not let Escape reach the drawer underneath', async () => {
    stubCommands(() => Promise.resolve([]));
    const view = await render(
      <HelpOverlay keymapOverrides={[]} onClose={vi.fn()} />,
    );
    const outer = vi.fn();
    view.container.addEventListener('keydown', outer);
    keyDown(view.get('[data-deck="help"]'), 'Escape');
    expect(outer).not.toHaveBeenCalled();
    view.unmount();
  });
});
