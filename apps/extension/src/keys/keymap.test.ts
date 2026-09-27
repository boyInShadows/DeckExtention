import { describe, expect, it } from 'vitest';

import {
  actionForChord,
  bindingProblem,
  chordFromEvent,
  KEY_ACTIONS,
  overrideFor,
  resolveKeymap,
  withBinding,
} from './keymap';

const press = (key: string, modifiers: Partial<Record<string, boolean>> = {}) =>
  chordFromEvent({
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...modifiers,
  });

describe('chordFromEvent', () => {
  it('names letters lower-case with an explicit Shift', () => {
    expect(press('j')).toBe('j');
    expect(press('J', { shiftKey: true })).toBe('Shift+j');
    expect(press('k', { ctrlKey: true, altKey: true })).toBe('Ctrl+Alt+k');
  });

  it('keeps shifted punctuation as the character itself', () => {
    expect(press('?', { shiftKey: true })).toBe('?');
    expect(press(']')).toBe(']');
  });

  it('names Shift for non-printing keys', () => {
    expect(press('Enter', { shiftKey: true })).toBe('Shift+Enter');
    expect(press('ArrowDown')).toBe('ArrowDown');
  });

  it('ignores a bare modifier', () => {
    expect(press('Shift', { shiftKey: true })).toBeNull();
    expect(press('Control', { ctrlKey: true })).toBeNull();
  });
});

describe('resolveKeymap and actionForChord', () => {
  it('uses defaults, then overrides', () => {
    const keymap = resolveKeymap([{ action: 'trash', chord: 'Delete' }]);
    expect(keymap.next).toBe('j');
    expect(keymap.trash).toBe('Delete');
    expect(actionForChord(keymap, 'drawer', 'Delete')).toBe('trash');
    expect(actionForChord(keymap, 'drawer', 'x')).toBeNull();
  });

  it('respects scope and keeps arrow aliases working', () => {
    const keymap = resolveKeymap([]);
    expect(actionForChord(keymap, 'drawer', 'l')).toBe('nextDeck');
    expect(actionForChord(keymap, 'inbox', 'l')).toBeNull();
    expect(actionForChord(keymap, 'inbox', 'ArrowRight')).toBe('move');
    expect(actionForChord(keymap, 'drawer', 'ArrowRight')).toBe('nextDeck');
    expect(actionForChord(keymap, 'surface', 'b')).toBe('blur');
  });

  it('gives every action a distinct default within each scope', () => {
    const keymap = resolveKeymap([]);
    for (const action of KEY_ACTIONS) {
      expect(bindingProblem(keymap, action.id, action.defaultChord)).toBeNull();
    }
  });
});

describe('bindingProblem', () => {
  const keymap = resolveKeymap([]);

  it('refuses reserved keys and the arrows', () => {
    expect(bindingProblem(keymap, 'trash', '?')).toEqual({ kind: 'reserved' });
    expect(bindingProblem(keymap, 'trash', 'Escape')).toEqual({
      kind: 'reserved',
    });
    expect(bindingProblem(keymap, 'trash', 'ArrowDown')).toEqual({
      kind: 'reserved',
    });
  });

  it('names the action a chord already belongs to', () => {
    expect(bindingProblem(keymap, 'trash', 'j')).toEqual({
      kind: 'conflict',
      with: 'next',
    });
  });

  it('treats surface keys as global, since they listen on the window', () => {
    expect(bindingProblem(keymap, 'trash', 'b')).toEqual({
      kind: 'conflict',
      with: 'blur',
    });
    expect(bindingProblem(keymap, 'blur', 'x')).toEqual({
      kind: 'conflict',
      with: 'trash',
    });
  });

  it('keeps surface keys to one plain character', () => {
    expect(bindingProblem(keymap, 'blur', 'Ctrl+b')).toEqual({
      kind: 'single-character',
    });
    expect(bindingProblem(keymap, 'blur', 'z')).toBeNull();
  });

  it('rejects unknown actions loudly', () => {
    expect(() => bindingProblem(keymap, 'nope' as never, 'z')).toThrow(
      'Unknown key action',
    );
  });
});

describe('withBinding', () => {
  const trash = { action: 'trash', chord: 'Delete' };
  const pin = { action: 'pin', chord: 'q' };

  it('stores only overrides and drops a return to the default', () => {
    expect(withBinding([], 'trash', 'Delete')).toEqual([trash]);
    expect(withBinding([trash], 'trash', 'x')).toEqual([]);
    expect(withBinding([trash, pin], 'trash', null)).toEqual([pin]);
    expect(overrideFor([trash], 'trash')).toBe('Delete');
    expect(overrideFor([trash], 'pin')).toBeUndefined();
  });

  it('never mutates the stored overrides', () => {
    const stored = Object.freeze([Object.freeze(pin)]);
    expect(withBinding(stored, 'trash', 'Delete')).toEqual([pin, trash]);
    expect(stored).toEqual([pin]);
  });
});
