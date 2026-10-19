// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Card } from 'deck-schema';
import type { DeckRepository } from '../storage/repository';
import type { DailyResurface } from '../storage/resurface';
import { panelStrings as strings } from '../i18n/panelStrings';
import { click, render, type RenderResult } from '../testing/render';
import Resurface from './Resurface';

const NOW = new Date(2026, 9, 17, 12);
const CARD: Card = {
  id: 'card_daily',
  deckId: 'deck_normal',
  title: 'A forgotten link',
  url: 'https://example.com/',
  hostname: 'example.com',
  pinned: false,
  order: 'a0',
  lastOpenedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const DAILY = { day: '2026-10-17', card: CARD };
const cards: Card[] = [];
let current: DailyResurface;
let view: RenderResult | undefined;
const notify = vi.fn();
const onDataChange = vi.fn();
const getResurface = vi.fn<DeckRepository['getResurface']>();
const resolveResurface = vi.fn<DeckRepository['resolveResurface']>();
const restoreCards = vi.fn<DeckRepository['restoreCards']>();
const createTab = vi.fn();
const repository = {
  getResurface,
  resolveResurface,
  restoreCards,
} as unknown as DeckRepository;
const ui = (now = NOW, isVisible = true) => (
  <Resurface
    repository={repository}
    cards={cards}
    decks={[]}
    pages={[]}
    now={now}
    isVisible={isVisible}
    onDataChange={onDataChange}
    notify={notify}
  />
);
beforeEach(() => {
  vi.resetAllMocks();
  current = structuredClone(DAILY);
  getResurface.mockImplementation(async () => current);
  resolveResurface.mockImplementation(async () => {
    current = { ...current, card: null };
    return CARD;
  });
  restoreCards.mockResolvedValue([CARD]);
  vi.stubGlobal('chrome', {
    tabs: { create: createTab.mockResolvedValue({ id: 1 }) },
  });
});
afterEach(() => {
  view?.unmount();
  vi.unstubAllGlobals();
});
const mount = async () => {
  view = await render(ui());
  await vi.waitFor(() =>
    expect(view?.query('[data-deck="resurface"]')).not.toBeNull(),
  );
  return view;
};

it('shows one link and hides the review during overlays without losing it', async () => {
  const panel = await mount();
  expect(panel.get('[data-deck="resurface-link"]').textContent).toContain(
    CARD.title,
  );
  expect(panel.get('[data-deck="resurface-hint"]').textContent).toBe(
    strings.resurfaceHint,
  );
  await panel.rerender(ui(NOW, false));
  expect(panel.query('[data-deck="resurface"]')).toBeNull();
  await panel.rerender(ui());
  expect(panel.query('[data-deck="resurface"]')).not.toBeNull();
});

it.each(['keep', 'dismiss', 'open', 'trash'] as const)(
  'resolves %s and returns keyboard focus to The Line',
  async (action) => {
    const panel = await mount();
    const line = document.createElement('div');
    line.dataset.deck = 'line';
    line.innerHTML = '<input />';
    document.body.append(line);
    try {
      const button = panel.get<HTMLButtonElement>(
        `[data-deck="resurface-${action}"]`,
      );
      button.focus();
      await panel.act(() => click(button));
      expect(resolveResurface).toHaveBeenCalledWith(CARD, DAILY.day, action);
      expect(panel.query('[data-deck="resurface"]')).toBeNull();
      expect(document.activeElement).toBe(line.firstElementChild);
      expect(onDataChange).toHaveBeenCalledOnce();
      expect(createTab).toHaveBeenCalledTimes(action === 'open' ? 1 : 0);
      if (action === 'open')
        expect(createTab).toHaveBeenCalledWith({ url: CARD.url });
      if (action === 'trash') {
        const undo = notify.mock.calls[0]?.[0].action.run;
        await undo();
        expect(restoreCards).toHaveBeenCalledWith([CARD.id]);
        expect(onDataChange).toHaveBeenCalledTimes(2);
      }
    } finally {
      line.remove();
    }
  },
);

it('keeps the card visible when a write fails and serializes repeated clicks', async () => {
  const panel = await mount();
  let reject: (error: Error) => void = () => undefined;
  resolveResurface.mockReturnValue(
    new Promise((_resolve, fail) => {
      reject = fail;
    }),
  );
  await panel.act(() => {
    click(panel.get('[data-deck="resurface-trash"]'));
    click(panel.get('[data-deck="resurface-keep"]'));
  });
  expect(resolveResurface).toHaveBeenCalledOnce();
  expect(
    panel.get<HTMLButtonElement>('[data-deck="resurface-trash"]').disabled,
  ).toBe(true);
  await panel.act(async () => {
    reject(new Error('disk full'));
  });
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'error',
      text: expect.stringContaining('disk full'),
    }),
  );
  expect(panel.query('[data-deck="resurface"]')).not.toBeNull();
  expect(createTab).not.toHaveBeenCalled();
});

it('refreshes on a new local day and when another tab resolves the review', async () => {
  const panel = await mount();
  current = { day: '2026-10-18', card: { ...CARD, id: 'card_tomorrow' } };
  const tomorrow = current.card;
  await panel.rerender(ui(new Date(2026, 9, 18, 0)));
  await panel.act(() => click(panel.get('[data-deck="resurface-keep"]')));
  expect(resolveResurface).toHaveBeenCalledWith(tomorrow, '2026-10-18', 'keep');
  current = { ...DAILY, card: null };
  await panel.act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(panel.query('[data-deck="resurface"]')).toBeNull();
});

it('reports read/open failures and ignores a read that finishes after unmount', async () => {
  const panel = await mount();
  createTab.mockRejectedValue(new Error('Chrome refused'));
  await panel.act(() => click(panel.get('[data-deck="resurface-open"]')));
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'error',
      text: expect.stringContaining('Chrome refused'),
    }),
  );
  getResurface.mockRejectedValue(new Error('database unavailable'));
  await panel.act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({
      text: expect.stringContaining('database unavailable'),
    }),
  );
  let finish: (value: DailyResurface) => void = () => undefined;
  getResurface.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await panel.act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  const count = notify.mock.calls.length;
  panel.unmount();
  view = undefined;
  finish(DAILY);
  await Promise.resolve();
  expect(notify).toHaveBeenCalledTimes(count);
});
