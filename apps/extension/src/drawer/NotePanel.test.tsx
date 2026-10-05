// @vitest-environment happy-dom
import type { Card, Deck } from 'deck-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { panelStrings as strings } from '../i18n/panelStrings';
import type { SurfaceData } from '../newtab/bootstrap';
import { click, keyDown, render, type } from '../testing/render';
import { NotePanel } from './NotePanel';

const CREATED_AT = 1;

const CARD: Card = {
  id: 'card_note',
  deckId: 'deck_inbox',
  url: 'https://note.test/',
  title: 'Note card',
  hostname: 'note.test',
  order: 'a0',
  pinned: false,
  lastOpenedAt: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  deletedAt: null,
};

const DECK: Deck = {
  id: 'deck_note',
  pageId: 'page_work',
  title: 'Reading',
  kind: 'normal',
  order: 'a0',
  color: null,
  isCollapsed: false,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  deletedAt: null,
};

function fakeRepository() {
  const upsertCard = vi.fn(async (value: Card) => value);
  const upsertDeck = vi.fn(async (value: Deck) => value);
  return {
    upsertCard,
    upsertDeck,
    repository: {
      upsertCard,
      upsertDeck,
    } as unknown as SurfaceData['repository'],
  };
}

async function renderPanel(entity: Card | Deck) {
  const fake = fakeRepository();
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const onError = vi.fn();
  const view = await render(
    <NotePanel
      entity={entity}
      repository={fake.repository}
      onSaved={onSaved}
      onClose={onClose}
      onError={onError}
    />,
  );
  const textarea = () => view.get<HTMLTextAreaElement>('textarea');
  return { ...fake, view, textarea, onSaved, onClose, onError };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('NotePanel', () => {
  it('opens on the existing note, focused for typing', async () => {
    const { view, textarea } = await renderPanel({ ...CARD, note: 'Read me' });
    expect(textarea().value).toBe('Read me');
    expect(document.activeElement).toBe(textarea());
    view.unmount();
  });

  it('saves a card note through upsertCard and reports the saved card', async () => {
    const panel = await renderPanel(CARD);
    await panel.view.act(() => type(panel.textarea(), 'Remember this'));
    await panel.view.act(() => click(panel.view.getByText(strings.saveNote)));

    expect(panel.upsertDeck).not.toHaveBeenCalled();
    expect(panel.upsertCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: CARD.id, note: 'Remember this' }),
    );
    expect(panel.onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: CARD.id, note: 'Remember this' }),
    );
    expect(panel.onClose).not.toHaveBeenCalled();
    panel.view.unmount();
  });

  it('saves a deck note through upsertDeck', async () => {
    const panel = await renderPanel(DECK);
    await panel.view.act(() => type(panel.textarea(), 'Deck note'));
    await panel.view.act(() => click(panel.view.getByText(strings.saveNote)));

    expect(panel.upsertCard).not.toHaveBeenCalled();
    expect(panel.upsertDeck).toHaveBeenCalledWith(
      expect.objectContaining({ id: DECK.id, note: 'Deck note' }),
    );
    panel.view.unmount();
  });

  it('clears the note field instead of storing an empty string', async () => {
    const panel = await renderPanel({ ...CARD, note: 'Old' });
    await panel.view.act(() => type(panel.textarea(), ''));
    await panel.view.act(() => click(panel.view.getByText(strings.saveNote)));

    const saved = panel.upsertCard.mock.calls[0]?.[0];
    expect(saved).toBeDefined();
    expect(saved?.note).toBeUndefined();
    panel.view.unmount();
  });

  it('toggles a read-only preview of what was typed', async () => {
    const panel = await renderPanel(CARD);
    await panel.view.act(() => type(panel.textarea(), 'Preview text'));
    await panel.view.act(() => click(panel.view.getByText(strings.preview)));

    expect(panel.view.query('textarea')).toBeNull();
    expect(panel.view.get('.deck-note-preview').textContent).toBe(
      'Preview text',
    );
    await panel.view.act(() => click(panel.view.getByText(strings.edit)));
    expect(panel.textarea().value).toBe('Preview text');
    panel.view.unmount();
  });

  it('closes on Escape without writing when nothing changed', async () => {
    const panel = await renderPanel({ ...CARD, note: 'Same' });
    let escape: KeyboardEvent | undefined;
    await panel.view.act(() => {
      escape = keyDown(panel.textarea(), 'Escape');
    });
    expect(escape?.defaultPrevented).toBe(true);
    expect(panel.upsertCard).not.toHaveBeenCalled();
    expect(panel.onClose).toHaveBeenCalledOnce();
    panel.view.unmount();
  });

  it('saves before closing when leaving by keyboard with changes', async () => {
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const panel = await renderPanel(CARD);
      await panel.view.act(() => type(panel.textarea(), 'Typed'));
      await panel.view.act(() => {
        keyDown(panel.textarea(), 'Enter', modifier);
      });
      expect(panel.upsertCard).toHaveBeenCalledOnce();
      expect(panel.onClose).toHaveBeenCalledOnce();
      panel.view.unmount();
    }
  });

  it('keeps the panel open with the text when the save fails', async () => {
    const panel = await renderPanel(CARD);
    panel.upsertCard.mockRejectedValueOnce(new Error('quota exceeded'));
    await panel.view.act(() => type(panel.textarea(), 'Unsaved work'));
    await panel.view.act(() => {
      keyDown(panel.textarea(), 'Escape');
    });

    expect(panel.onError).toHaveBeenCalledWith(
      `${strings.updateFailed} quota exceeded`,
    );
    expect(panel.onClose).not.toHaveBeenCalled();
    expect(panel.onSaved).not.toHaveBeenCalled();
    expect(panel.textarea().value).toBe('Unsaved work');
    panel.view.unmount();
  });

  it('reports a non-Error rejection as text', async () => {
    const panel = await renderPanel(DECK);
    panel.upsertDeck.mockRejectedValueOnce('disk gone');
    await panel.view.act(() => click(panel.view.getByText(strings.saveNote)));
    expect(panel.onError).toHaveBeenCalledWith(
      `${strings.updateFailed} disk gone`,
    );
    panel.view.unmount();
  });

  it('ignores plain Enter and other keys, and keeps them from the list', async () => {
    const panel = await renderPanel(CARD);
    const outer = vi.fn();
    panel.view.container.addEventListener('keydown', outer);
    const enter = keyDown(panel.textarea(), 'Enter');
    const letter = keyDown(panel.textarea(), 'x');

    expect(enter.defaultPrevented).toBe(false);
    expect(letter.defaultPrevented).toBe(false);
    expect(outer).not.toHaveBeenCalled();
    expect(panel.onClose).not.toHaveBeenCalled();
    panel.view.unmount();
  });

  it('closes from the Close button', async () => {
    const panel = await renderPanel(CARD);
    click(panel.view.getByText(strings.close));
    expect(panel.onClose).toHaveBeenCalledOnce();
    panel.view.unmount();
  });
});
