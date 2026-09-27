import type { KeyBinding } from 'deck-schema';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import {
  formatChord,
  KEY_ACTIONS,
  resolveKeymap,
  type KeyScope,
  type Keymap,
} from '../keys/keymap';
import { focusOnMount } from './focusOnMount';

interface HelpOverlayProps {
  keymapOverrides: readonly KeyBinding[];
  onClose: () => void;
}

type Row = readonly [keys: string, label: string];

interface BrowserCommand {
  name: string;
  description: string;
  shortcut: string;
}

function scopeRows(keymap: Keymap, scope: KeyScope): Row[] {
  return KEY_ACTIONS.filter(({ scopes }) => scopes[0] === scope).map(
    ({ id }) => [formatChord(keymap[id]), strings.keyLabels[id]] as const,
  );
}

/**
 * The one-screen cheat sheet (FableTasks P2.S6), opened by `?`. It shows the
 * bindings actually in force - the user's overrides and whatever Chrome
 * reports for the browser shortcuts - never a hard-coded copy.
 */
export default function HelpOverlay({
  keymapOverrides,
  onClose,
}: HelpOverlayProps) {
  const keymap = useMemo(
    () => resolveKeymap(keymapOverrides),
    [keymapOverrides],
  );
  const [commands, setCommands] = useState<BrowserCommand[]>([]);

  useEffect(() => {
    chrome.commands.getAll().then(
      (all) =>
        setCommands(
          all
            .filter(({ name }) => name && name !== '_execute_action')
            .map(({ name, description, shortcut }) => ({
              name: name ?? '',
              description: description ?? '',
              shortcut: shortcut || strings.keyNotSet,
            })),
        ),
      (error: unknown) =>
        setCommands([
          { name: 'error', description: String(error), shortcut: '' },
        ]),
    );
  }, []);

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: strings.keysAnywhere,
      rows: [
        ...scopeRows(keymap, 'surface'),
        ['?', strings.keyHelp],
        ['Space', strings.keySpace],
        ['Esc', strings.keyEscape],
      ],
    },
    {
      title: strings.keysDrawer,
      rows: [
        ...scopeRows(keymap, 'drawer'),
        ['Alt 1–9', strings.keyAltDigit],
        ['Space', strings.keyLift],
      ],
    },
    {
      title: strings.keysInbox,
      rows: [
        ['↑ ↓', `${strings.keyLabels.next} / ${strings.keyLabels.previous}`],
        ['⇧ ↑ ↓', strings.keySelect],
        ['→', strings.keyLabels.move],
      ],
    },
    {
      title: strings.keysBrowser,
      rows: commands.map(
        ({ description, shortcut }) => [shortcut, description] as const,
      ),
    },
  ];

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Esc closes the sheet only - not the drawer underneath it.
    event.stopPropagation();
    // aria-modal: Close is the only focusable element, so Tab stays on it.
    if (event.key === 'Tab') {
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape' || event.key === '?') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="deck-help-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        data-deck="help"
        className="deck-help"
        role="dialog"
        aria-modal="true"
        aria-label={strings.keyboard}
        onKeyDown={onKeyDown}
      >
        <header>
          <h2>{strings.keyboard}</h2>
          <button ref={focusOnMount} type="button" onClick={onClose}>
            {strings.close}
          </button>
        </header>
        <div className="deck-help__groups">
          {groups.map(({ title, rows }) => (
            <div key={title} className="deck-help__group">
              <h3>{title}</h3>
              <dl>
                {rows.map(([keys, label]) => (
                  <div key={`${keys}-${label}`}>
                    <dt>
                      <kbd>{keys}</kbd>
                    </dt>
                    <dd>{label}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <p>{strings.rebindHint}</p>
      </section>
    </div>
  );
}
