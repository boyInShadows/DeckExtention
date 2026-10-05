// @vitest-environment happy-dom
import {
  SETTINGS_DEFAULTS,
  type Card,
  type Deck,
  type Page,
} from 'deck-schema';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { panelStrings as strings } from '../i18n/panelStrings';
import { resolveKeymap } from '../keys/keymap';
import type { SurfaceData } from '../newtab/bootstrap';
import { click, keyDown, render, type RenderResult } from '../testing/render';
import { InboxTriage } from './InboxTriage';
import { RECENT_TARGETS_KEY } from './inboxModel';

const KEYMAP = resolveKeymap([]);
const STAMP = 1;
const INBOX_ID = 'deck_inbox';
const HOME_ID = 'deck_home';

const page = (id: string, order: string): Page => ({
  id,
  title: id === 'page_work' ? 'Work' : 'Home',
  order,
  createdAt: STAMP,
  updatedAt: STAMP,
  deletedAt: null,
});

const deck = (id: string, title: string, extra: Partial<Deck> = {}): Deck => ({
  id,
  pageId: 'page_work',
  title,
  kind: 'normal',
  order: 'a0',
  color: null,
  isCollapsed: false,
  createdAt: STAMP,
  updatedAt: STAMP,
  deletedAt: null,
  ...extra,
});

const card = (id: string, order: string, extra: Partial<Card> = {}): Card => ({
  id,
  deckId: INBOX_ID,
  url: `https://${id}.test/`,
  title: `Title ${id}`,
  hostname: `${id}.test`,
  order,
  pinned: false,
  lastOpenedAt: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  deletedAt: null,
  ...extra,
});

const PAGES = [page('page_work', 'a0')];
const DECKS = [
  deck(INBOX_ID, 'Inbox', { kind: 'inbox' }),
  deck(HOME_ID, 'Home deck', { order: 'a0' }),
  deck('deck_docs', 'Docs', { order: 'a1' }),
];
const CARDS = [
  card('one', 'a0'),
  card('two', 'a1', { note: 'Has a note' }),
  card('three', 'a2'),
];

interface Setup {
  cards?: Card[];
  decks?: Deck[];
  pages?: Page[];
  defaultDeckId?: string;
  isOpen?: boolean;
}

function fakeRepository() {
  const upsertCard = vi.fn(async (value: Card) => value);
  const softDelete = vi.fn(async (_entity: string, _id: string) => undefined);
  return { upsertCard, softDelete };
}

async function renderTriage(setup: Setup = {}) {
  const fake = fakeRepository();
  const onCardsChange = vi.fn();
  const onError = vi.fn();
  const data: SurfaceData = {
    cards: [],
    decks: [],
    pages: [],
    defaultDeckId: setup.defaultDeckId ?? HOME_ID,
    settings: SETTINGS_DEFAULTS,
    repository: fake as unknown as SurfaceData['repository'],
  };
  function Harness({ isOpen }: { isOpen: boolean }) {
    const [cards, setCards] = useState(setup.cards ?? CARDS);
    return (
      <InboxTriage
        keymap={KEYMAP}
        isOpen={isOpen}
        cards={cards}
        decks={setup.decks ?? DECKS}
        pages={setup.pages ?? PAGES}
        data={data}
        onCardsChange={(next) => {
          onCardsChange(next);
          setCards(next);
        }}
        onError={onError}
      />
    );
  }
  const view = await render(<Harness isOpen={setup.isOpen ?? true} />);
  const list = () => view.get('[role="listbox"]');
  return { ...fake, view, list, onCardsChange, onError };
}

type Triage = Awaited<ReturnType<typeof renderTriage>>;

/** One keystroke on the list, then let the triage queue drain. */
async function press(
  triage: Triage,
  key: string,
  init: KeyboardEventInit = {},
) {
  let event: KeyboardEvent | undefined;
  await triage.view.act(async () => {
    event = keyDown(triage.list(), key, init);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  if (!event) throw new Error('No key was pressed');
  return event;
}

function rowTitles(view: RenderResult): string[] {
  return view
    .getAll('[role="option"] strong')
    .map((row) => row.textContent ?? '');
}

function cursorTitle(view: RenderResult): string | null | undefined {
  return view.query('[data-cursor] strong')?.textContent;
}

function selectedTitles(view: RenderResult): string[] {
  return view
    .getAll('[data-selected] strong')
    .map((row) => row.textContent ?? '');
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.replaceChildren();
});

describe('InboxTriage - list', () => {
  it('lists the inbox in order, focused, with the hint and note markers', async () => {
    const triage = await renderTriage();
    expect(rowTitles(triage.view)).toEqual([
      'Title one',
      'Title two',
      'Title three',
    ]);
    expect(document.activeElement).toBe(triage.list());
    expect(triage.view.container.textContent).toContain(strings.triageHint);
    expect(triage.view.container.textContent).toContain('● two.test');
    expect(triage.list().getAttribute('aria-activedescendant')).toBe(
      'deck-inbox-one',
    );
    expect(triage.view.query('[data-deck="inbox-zero"]')).toBeNull();
    triage.view.unmount();
  });

  it('shows inbox zero and ignores triage keys when the inbox is empty', async () => {
    const triage = await renderTriage({ cards: [] });
    expect(triage.view.get('[data-deck="inbox-zero"]').textContent).toBe(
      strings.inboxZero,
    );
    expect(triage.view.container.textContent).not.toContain(strings.triageHint);
    expect(triage.list().hasAttribute('aria-activedescendant')).toBe(false);
    const trash = await press(triage, 'x');
    expect(trash.defaultPrevented).toBe(false);
    expect(triage.softDelete).not.toHaveBeenCalled();
    triage.view.unmount();
  });

  it('shows inbox zero when there is no live inbox deck', async () => {
    const triage = await renderTriage({
      decks: DECKS.map((item) =>
        item.kind === 'inbox' ? { ...item, deletedAt: STAMP } : item,
      ),
    });
    expect(rowTitles(triage.view)).toEqual([]);
    expect(triage.view.query('[data-deck="inbox-zero"]')).not.toBeNull();
    triage.view.unmount();
  });

  it('moves the cursor with j, k and the arrows, clamped to the list', async () => {
    const triage = await renderTriage();
    expect((await press(triage, 'k')).defaultPrevented).toBe(true);
    expect(cursorTitle(triage.view)).toBe('Title one');
    await press(triage, 'j');
    await press(triage, 'ArrowDown');
    await press(triage, 'ArrowDown');
    expect(cursorTitle(triage.view)).toBe('Title three');
    await press(triage, 'ArrowUp');
    expect(cursorTitle(triage.view)).toBe('Title two');
    triage.view.unmount();
  });

  it('moves the cursor to a clicked row and drops any selection', async () => {
    const triage = await renderTriage();
    await press(triage, 'j', { shiftKey: true });
    expect(selectedTitles(triage.view)).toEqual(['Title one', 'Title two']);
    await triage.view.act(() => click(triage.view.getByText('Title three')));
    expect(cursorTitle(triage.view)).toBe('Title three');
    expect(selectedTitles(triage.view)).toEqual([]);
    triage.view.unmount();
  });
});

describe('InboxTriage - keys that must not act', () => {
  it('ignores keys while the drawer is closing', async () => {
    const triage = await renderTriage({ isOpen: false });
    expect((await press(triage, 'x')).defaultPrevented).toBe(false);
    expect(triage.softDelete).not.toHaveBeenCalled();
    triage.view.unmount();
  });

  it('ignores keys aimed at a row rather than the list', async () => {
    const triage = await renderTriage();
    await triage.view.act(() => {
      keyDown(triage.view.get('[role="option"]'), 'x');
    });
    expect(triage.softDelete).not.toHaveBeenCalled();
    triage.view.unmount();
  });

  it('ignores a bare modifier, unbound keys and inbox-less actions', async () => {
    const triage = await renderTriage();
    expect(
      (await press(triage, 'Shift', { shiftKey: true })).defaultPrevented,
    ).toBe(false);
    expect((await press(triage, 'q')).defaultPrevented).toBe(false);
    // `]` is bound (next page) but has no meaning inside the inbox.
    expect((await press(triage, ']')).defaultPrevented).toBe(false);
    // Shift only extends next/previous; Shift+x is not "trash".
    expect(
      (await press(triage, 'x', { shiftKey: true })).defaultPrevented,
    ).toBe(false);
    expect(triage.softDelete).not.toHaveBeenCalled();
    expect(cursorTitle(triage.view)).toBe('Title one');
    triage.view.unmount();
  });
});

describe('InboxTriage - trash and selection', () => {
  it('extends the selection with Shift and trashes the whole range', async () => {
    const triage = await renderTriage();
    await press(triage, 'j', { shiftKey: true });
    await press(triage, 'ArrowDown', { shiftKey: true });
    expect(selectedTitles(triage.view)).toEqual([
      'Title one',
      'Title two',
      'Title three',
    ]);
    await press(triage, 'k', { shiftKey: true });
    expect(selectedTitles(triage.view)).toEqual(['Title one', 'Title two']);

    expect((await press(triage, 'x')).defaultPrevented).toBe(true);
    expect(triage.softDelete.mock.calls).toEqual([
      ['card', 'one'],
      ['card', 'two'],
    ]);
    expect(rowTitles(triage.view)).toEqual(['Title three']);
    expect(selectedTitles(triage.view)).toEqual([]);
    triage.view.unmount();
  });

  it('reports a failed write and keeps every card', async () => {
    const triage = await renderTriage();
    triage.softDelete.mockRejectedValueOnce(new Error('disk full'));
    await press(triage, 'x');
    expect(triage.onError).toHaveBeenCalledWith(
      `${strings.updateFailed} disk full`,
    );
    expect(triage.onCardsChange).not.toHaveBeenCalled();
    expect(rowTitles(triage.view)).toHaveLength(CARDS.length);
    triage.view.unmount();
  });

  it('reports a non-Error failure as text', async () => {
    const triage = await renderTriage();
    triage.softDelete.mockRejectedValueOnce('locked');
    await press(triage, 'x');
    expect(triage.onError).toHaveBeenCalledWith(
      `${strings.updateFailed} locked`,
    );
    triage.view.unmount();
  });

  it('reclaims lost focus after a write, but never steals it', async () => {
    const triage = await renderTriage();
    const elsewhere = document.createElement('input');
    document.body.append(elsewhere);
    await triage.view.act(async () => {
      keyDown(triage.list(), 'x');
      elsewhere.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(elsewhere);

    await triage.view.act(async () => {
      keyDown(triage.list(), 'x');
      elsewhere.blur();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(triage.list());
    expect(triage.softDelete).toHaveBeenCalledTimes(2);
    triage.view.unmount();
  });
});

describe('InboxTriage - move', () => {
  it('moves the card to the chosen deck and remembers it as recent', async () => {
    const triage = await renderTriage();
    await press(triage, 'm');
    const input = triage.view.get<HTMLInputElement>(
      '[data-deck="move-line"] input',
    );
    expect(document.activeElement).toBe(input);
    await triage.view.act(async () => {
      keyDown(input, 'ArrowDown');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await triage.view.act(async () => {
      keyDown(input, 'Enter');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(triage.upsertCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'one', deckId: 'deck_docs' }),
    );
    expect(triage.view.query('[data-deck="move-line"]')).toBeNull();
    expect(rowTitles(triage.view)).toEqual(['Title two', 'Title three']);
    expect(
      JSON.parse(localStorage.getItem(RECENT_TARGETS_KEY) ?? '[]'),
    ).toEqual(['deck_docs']);
    triage.view.unmount();
  });

  it('offers the remembered destination first next time', async () => {
    localStorage.setItem(RECENT_TARGETS_KEY, JSON.stringify(['deck_docs']));
    const triage = await renderTriage();
    await press(triage, 'ArrowRight');
    expect(
      triage.view.get('[data-deck="move-line"] [aria-selected="true"]')
        .textContent,
    ).toBe('Work › Docs');
    triage.view.unmount();
  });

  it('cancels the move with Escape and returns focus to the list', async () => {
    const triage = await renderTriage();
    await press(triage, 'm');
    const input = triage.view.get<HTMLInputElement>(
      '[data-deck="move-line"] input',
    );
    await triage.view.act(() => {
      keyDown(input, 'Escape');
    });
    expect(triage.view.query('[data-deck="move-line"]')).toBeNull();
    expect(document.activeElement).toBe(triage.list());
    expect(triage.upsertCard).not.toHaveBeenCalled();
    triage.view.unmount();
  });
});

describe('InboxTriage - pin', () => {
  it('pins into the default deck', async () => {
    const triage = await renderTriage();
    await press(triage, 'p');
    expect(triage.upsertCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'one', pinned: true, deckId: HOME_ID }),
    );
    triage.view.unmount();
  });

  it('falls back to the first deck when the default deck is trashed', async () => {
    const triage = await renderTriage({
      decks: DECKS.map((item) =>
        item.id === HOME_ID ? { ...item, deletedAt: STAMP } : item,
      ),
    });
    await press(triage, 'p');
    expect(triage.upsertCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'one', deckId: 'deck_docs' }),
    );
    triage.view.unmount();
  });

  it('asks for a deck first when there is nowhere to pin', async () => {
    const triage = await renderTriage({
      decks: DECKS.filter(({ kind }) => kind === 'inbox'),
    });
    await press(triage, 'p');
    expect(triage.onError).toHaveBeenCalledWith(strings.noDecks);
    expect(triage.upsertCard).not.toHaveBeenCalled();
    triage.view.unmount();
  });
});

describe('InboxTriage - note and open', () => {
  it('edits a note and shows the saved card in the list', async () => {
    const triage = await renderTriage();
    await press(triage, 'n');
    const textarea = triage.view.get<HTMLTextAreaElement>(
      '[data-deck="note"] textarea',
    );
    await triage.view.act(() => {
      textarea.value = 'Fresh note';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await triage.view.act(async () => {
      click(triage.view.getByText(strings.saveNote));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(triage.onCardsChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'one', note: 'Fresh note' }),
      ]),
    );
    expect(triage.view.container.textContent).toContain('● one.test');

    await triage.view.act(() => click(triage.view.getByText(strings.close)));
    expect(triage.view.query('[data-deck="note"]')).toBeNull();
    expect(document.activeElement).toBe(triage.list());
    triage.view.unmount();
  });

  it('opens a card here on Enter and in a new tab on Shift+Enter', async () => {
    const assign = vi
      .spyOn(location, 'assign')
      .mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const triage = await renderTriage();
    await press(triage, 'Enter');
    expect(assign).toHaveBeenCalledWith('https://one.test/');
    await press(triage, 'Enter', { shiftKey: true });
    expect(open).toHaveBeenCalledWith(
      'https://one.test/',
      '_blank',
      'noopener',
    );
    expect(triage.upsertCard).toHaveBeenCalledTimes(2);
    expect(triage.onCardsChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'one',
          lastOpenedAt: expect.any(Number),
        }),
      ]),
    );
    triage.view.unmount();
  });

  it('refuses to open a non-web URL and says why', async () => {
    const assign = vi
      .spyOn(location, 'assign')
      .mockImplementation(() => undefined);
    const triage = await renderTriage({
      cards: [card('bad', 'a0', { url: 'ftp://bad.test/' })],
    });
    await press(triage, 'Enter');
    expect(assign).not.toHaveBeenCalled();
    expect(triage.onError).toHaveBeenCalledWith(
      `${strings.updateFailed} ${strings.invalidUrl}`,
    );
    triage.view.unmount();
  });
});
