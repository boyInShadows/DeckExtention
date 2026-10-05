import type { KeyBinding } from 'deck-schema';

/**
 * Deck's in-page keymap (FableTasks P2.S6).
 *
 * Settings stores only the user's overrides; defaults live here, so a new
 * action ships with a working key and an old export never needs migrating.
 * The three browser-level commands (Quick Save, Stash, Drawer) belong to
 * Chrome and are rebound at chrome://extensions/shortcuts (AGENTS.md 2).
 */

export type KeyScope = 'surface' | 'drawer' | 'inbox';

export type KeyActionId =
  | 'focusLine'
  | 'blur'
  | 'next'
  | 'previous'
  | 'nextDeck'
  | 'previousDeck'
  | 'nextPage'
  | 'previousPage'
  | 'open'
  | 'openInNewTab'
  | 'move'
  | 'trash'
  | 'note'
  | 'pin'
  | 'addLink'
  | 'addDeck';

export interface KeyAction {
  id: KeyActionId;
  scopes: readonly KeyScope[];
  defaultChord: string;
  /**
   * Surface keys are matched by a few bytes of code on the new tab's first
   * paint, so they are limited to a single unmodified character.
   */
  isSingleCharacter?: boolean;
}

export const KEY_ACTIONS: readonly KeyAction[] = [
  {
    id: 'focusLine',
    scopes: ['surface'],
    defaultChord: '/',
    isSingleCharacter: true,
  },
  {
    id: 'blur',
    scopes: ['surface'],
    defaultChord: 'b',
    isSingleCharacter: true,
  },
  { id: 'next', scopes: ['drawer', 'inbox'], defaultChord: 'j' },
  { id: 'previous', scopes: ['drawer', 'inbox'], defaultChord: 'k' },
  { id: 'nextDeck', scopes: ['drawer'], defaultChord: 'l' },
  { id: 'previousDeck', scopes: ['drawer'], defaultChord: 'h' },
  { id: 'nextPage', scopes: ['drawer', 'inbox'], defaultChord: ']' },
  { id: 'previousPage', scopes: ['drawer', 'inbox'], defaultChord: '[' },
  { id: 'open', scopes: ['drawer', 'inbox'], defaultChord: 'Enter' },
  {
    id: 'openInNewTab',
    scopes: ['drawer', 'inbox'],
    defaultChord: 'Shift+Enter',
  },
  { id: 'move', scopes: ['drawer', 'inbox'], defaultChord: 'm' },
  { id: 'trash', scopes: ['drawer', 'inbox'], defaultChord: 'x' },
  { id: 'note', scopes: ['drawer', 'inbox'], defaultChord: 'n' },
  { id: 'pin', scopes: ['drawer', 'inbox'], defaultChord: 'p' },
  { id: 'addLink', scopes: ['drawer'], defaultChord: 'a' },
  { id: 'addDeck', scopes: ['drawer'], defaultChord: 'd' },
];

/**
 * Keys with a fixed meaning that no binding may take: `?` is help, Esc
 * closes, Tab moves focus, Space lifts a card for keyboard drag-and-drop.
 */
export const RESERVED_CHORDS: ReadonlySet<string> = new Set([
  '?',
  'Escape',
  'Tab',
  'Shift+Tab',
  ' ',
]);

/** Arrow keys always work alongside whatever the letters are bound to. */
export const ARROW_ALIASES: Readonly<
  Record<KeyScope, Record<string, KeyActionId>>
> = {
  surface: {},
  drawer: {
    ArrowDown: 'next',
    ArrowUp: 'previous',
    ArrowRight: 'nextDeck',
    ArrowLeft: 'previousDeck',
  },
  inbox: { ArrowDown: 'next', ArrowUp: 'previous', ArrowRight: 'move' },
};

export type Keymap = Readonly<Record<KeyActionId, string>>;

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

/**
 * "Ctrl+Shift+Enter", "j", "?". Letters are stored lower-case with an
 * explicit Shift; other printable characters already carry their shift
 * ("?" not "Shift+/"), so Shift is only named for non-printing keys.
 * Returns null for a bare modifier press.
 */
export function chordFromEvent(event: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const isPrintable = event.key.length === 1;
  const isLetter = /^[a-z]$/i.test(event.key);
  const parts = [
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.metaKey ? 'Meta' : '',
    event.shiftKey && (isLetter || !isPrintable) ? 'Shift' : '',
    isLetter ? event.key.toLowerCase() : event.key,
  ];
  return parts.filter(Boolean).join('+');
}

/** The chord the user bound to `id`, if they changed it. */
export function overrideFor(
  bindings: readonly KeyBinding[],
  id: KeyActionId,
): string | undefined {
  return bindings.find(({ action }) => action === id)?.chord;
}

export function resolveKeymap(bindings: readonly KeyBinding[]): Keymap {
  return Object.fromEntries(
    KEY_ACTIONS.map(({ id, defaultChord }) => [
      id,
      overrideFor(bindings, id) ?? defaultChord,
    ]),
  ) as Keymap;
}

/** Surface keys listen on the whole window, so they overlap every scope. */
function sharesScope(left: KeyAction, right: KeyAction): boolean {
  const isGlobal = [left, right].some(({ scopes }) =>
    scopes.includes('surface'),
  );
  return isGlobal || left.scopes.some((scope) => right.scopes.includes(scope));
}

/** The action in `scope` bound to `chord`, including the arrow aliases. */
export function actionForChord(
  keymap: Keymap,
  scope: KeyScope,
  chord: string,
): KeyActionId | null {
  const bound = KEY_ACTIONS.find(
    ({ id, scopes }) => scopes.includes(scope) && keymap[id] === chord,
  );
  return bound?.id ?? ARROW_ALIASES[scope][chord] ?? null;
}

export type BindingProblem =
  | { kind: 'reserved' }
  | { kind: 'single-character' }
  | { kind: 'conflict'; with: KeyActionId };

/** Why `chord` cannot be bound to `id`, or null if it can. */
export function bindingProblem(
  keymap: Keymap,
  id: KeyActionId,
  chord: string,
): BindingProblem | null {
  const action = KEY_ACTIONS.find((item) => item.id === id);
  if (!action) throw new Error(`Unknown key action ${id}`);
  if (RESERVED_CHORDS.has(chord)) return { kind: 'reserved' };
  if (action.isSingleCharacter && chord.length !== 1) {
    return { kind: 'single-character' };
  }
  const arrowClash = action.scopes.some(
    (scope) => ARROW_ALIASES[scope][chord] !== undefined,
  );
  if (arrowClash) return { kind: 'reserved' };
  const clash = KEY_ACTIONS.find(
    (other) =>
      other.id !== id &&
      keymap[other.id] === chord &&
      sharesScope(action, other),
  );
  return clash ? { kind: 'conflict', with: clash.id } : null;
}

/** Stores only what differs from the defaults. */
export function withBinding(
  bindings: readonly KeyBinding[],
  id: KeyActionId,
  chord: string | null,
): KeyBinding[] {
  const action = KEY_ACTIONS.find((item) => item.id === id);
  const rest = bindings.filter((binding) => binding.action !== id);
  if (chord === null || chord === action?.defaultChord) return rest;
  return [...rest, { action: id, chord }];
}

/** True when a key event came from something the user is typing into. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

const KEY_GLYPHS: Readonly<Record<string, string>> = {
  Enter: '⏎',
  Shift: '⇧',
  ArrowDown: '↓',
  ArrowUp: '↑',
  ArrowLeft: '←',
  ArrowRight: '→',
  ' ': 'Space',
};

/** "Shift+Enter" -> "⇧ ⏎" for display. */
export function formatChord(chord: string): string {
  if (chord === '+') return '+';
  return chord
    .split('+')
    .map((part) => KEY_GLYPHS[part] ?? part)
    .join(' ');
}
