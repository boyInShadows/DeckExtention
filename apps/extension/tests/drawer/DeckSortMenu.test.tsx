// @vitest-environment happy-dom
import type { Deck } from 'deck-schema';
import { afterEach, expect, it, vi } from 'vitest';
import { DeckMenu } from '../../src/drawer/DeckMenu';
import { panelStrings as strings } from '../../src/i18n/panelStrings';
import { click, keyDown, render } from '../../src/testing/render';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it.each(['manual', 'title', 'newest', 'hostname'] as const)(
  'exposes the saved %s radio choice and saves only the selected mode',
  async (sortMode) => {
    vi.stubGlobal('chrome', { storage: { local: { get: async () => ({}) } } });
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const saveDeck = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const deck: Deck = {
      id: 'deck_001',
      pageId: 'page_001',
      title: 'Reading',
      kind: 'normal',
      order: 'a0',
      color: null,
      isCollapsed: false,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      sortMode,
    };
    const view = await render(
      <DeckMenu
        anchor={anchor}
        deck={deck}
        pages={[]}
        cards={[]}
        onOpen={vi.fn()}
        saveDeck={saveDeck}
        onRename={vi.fn()}
        onEditNote={vi.fn()}
        onTrash={vi.fn()}
        onClose={onClose}
        onError={vi.fn()}
      />,
    );
    try {
      await view.act(() => click(view.get('[data-deck="deck-sort"]')));
      const items = view.getAll('[role="menuitemradio"]');
      expect(items).toHaveLength(4);
      expect(view.get('[aria-checked="true"]').getAttribute('aria-label')).toBe(
        strings.deckSort[sortMode],
      );
      expect(view.getAll('[data-deck="deck-sort-selected"]')).toHaveLength(1);
      const first = items[0];
      if (!first) throw new Error('Missing Manual choice');
      expect(document.activeElement).toBe(first);
      await view.act(() => {
        keyDown(first, 'End');
      });
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        strings.deckSort.hostname,
      );
      await view.act(() => click(view.getByLabel(strings.deckSort.title)));
      expect(saveDeck).toHaveBeenCalledExactlyOnceWith({ sortMode: 'title' });
      expect(onClose).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(anchor);
    } finally {
      view.unmount();
    }
  },
);
