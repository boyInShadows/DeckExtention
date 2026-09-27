import type { KeyBinding } from 'deck-schema';
import { useState, type KeyboardEvent } from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import {
  bindingProblem,
  chordFromEvent,
  formatChord,
  KEY_ACTIONS,
  overrideFor,
  resolveKeymap,
  withBinding,
  type BindingProblem,
  type KeyActionId,
} from '../keys/keymap';
import { focusOnMount } from './focusOnMount';

interface KeymapEditorProps {
  overrides: readonly KeyBinding[];
  onChange: (overrides: KeyBinding[]) => void;
}

function describe(problem: BindingProblem): string {
  if (problem.kind === 'reserved') return strings.keyReserved;
  if (problem.kind === 'single-character') return strings.keySingleCharacter;
  return `${strings.keyConflict} ${strings.keyLabels[problem.with]}.`;
}

/**
 * Settings › Keys (FableTasks P2.S6): click an action, press the new chord.
 * A conflict is named and refused rather than silently stealing the key.
 */
export function KeymapEditor({ overrides, onChange }: KeymapEditorProps) {
  const keymap = resolveKeymap(overrides);
  const [recording, setRecording] = useState<KeyActionId | null>(null);
  const [problem, setProblem] = useState('');

  const record = (id: KeyActionId, event: KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setRecording(null);
      setProblem('');
      return;
    }
    const chord = chordFromEvent(event);
    if (!chord) return;
    const found = bindingProblem(keymap, id, chord);
    if (found) {
      setProblem(describe(found));
      return;
    }
    onChange(withBinding(overrides, id, chord));
    setRecording(null);
    setProblem('');
  };

  return (
    <div data-deck="keymap" className="deck-keymap">
      {KEY_ACTIONS.map(({ id }) => {
        const isRecording = recording === id;
        return (
          <div key={id} className="deck-keymap__row">
            <span>{strings.keyLabels[id]}</span>
            {isRecording ? (
              <button
                ref={focusOnMount}
                type="button"
                data-recording
                aria-live="polite"
                onKeyDown={(event) => record(id, event)}
                onBlur={() => setRecording(null)}
              >
                {strings.pressKeys}
              </button>
            ) : (
              <button
                type="button"
                aria-label={`${strings.keyLabels[id]}: ${keymap[id]}`}
                onClick={() => {
                  setRecording(id);
                  setProblem('');
                }}
              >
                <kbd>{formatChord(keymap[id])}</kbd>
              </button>
            )}
            {overrideFor(overrides, id) !== undefined ? (
              <button
                type="button"
                onClick={() => onChange(withBinding(overrides, id, null))}
              >
                {strings.resetKey}
              </button>
            ) : null}
          </div>
        );
      })}
      {problem ? <p role="alert">{problem}</p> : null}
    </div>
  );
}
