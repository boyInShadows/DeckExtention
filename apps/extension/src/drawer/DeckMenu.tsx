import type { Card, Deck, Page } from 'deck-schema';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import type { DeckRepository } from '../storage/repository';
import { markOpened } from './inboxActions';

const COLORS = ['slate', 'blue', 'green', 'amber', 'rose'] as const;
const MENU_GAP = 8;
const MENU_WIDTH = 224;
const MENU_HEIGHT = 330;
const TABS_DECLINED_KEY = 'deck:tabs-declined';

export function DeckMenu({
  anchor,
  deck,
  pages,
  cards,
  allCards,
  repository,
  onCardsChange,
  saveDeck,
  onRename,
  onEditNote,
  onTrash,
  onClose,
  onError,
  initialSubMenu = null,
}: {
  anchor: HTMLElement;
  deck: Deck;
  pages: Page[];
  cards: Card[];
  allCards: Card[];
  repository: DeckRepository;
  onCardsChange: (cards: Card[]) => void;
  saveDeck: (change: Partial<Deck>) => Promise<void>;
  onRename: () => void;
  onEditNote: (deck: Deck) => void;
  onTrash: () => void;
  onClose: () => void;
  onError: (value: string) => void;
  initialSubMenu?: 'permission' | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wasTabsDeclined = sessionStorage.getItem(TABS_DECLINED_KEY) === 'true';
  const [subMenu, setSubMenu] = useState<
    'color' | 'page' | 'permission' | null
  >(initialSubMenu);
  const rect = anchor.getBoundingClientRect();
  const isRtl = document.documentElement.dir === 'rtl';
  const inline = isRtl ? window.innerWidth - rect.right : rect.left;
  const style = {
    insetInlineStart: Math.max(
      MENU_GAP,
      Math.min(inline, window.innerWidth - MENU_WIDTH - MENU_GAP),
    ),
    insetBlockStart: Math.max(
      MENU_GAP,
      rect.bottom + MENU_HEIGHT <= window.innerHeight
        ? rect.bottom + MENU_GAP
        : rect.top - MENU_HEIGHT - MENU_GAP,
    ),
  } satisfies CSSProperties;

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [subMenu]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (
        !ref.current?.contains(event.target as Node) &&
        !anchor.contains(event.target as Node)
      )
        onClose();
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [anchor, onClose]);

  const close = () => {
    onClose();
    anchor.focus();
  };
  const openAll = async () => {
    const opened: Card[] = [];
    try {
      if (wasTabsDeclined) return onError(strings.tabsPermissionDeclined);
      const allowed = await chrome.permissions.request({
        permissions: ['tabs'],
      });
      if (!allowed) {
        sessionStorage.setItem(TABS_DECLINED_KEY, 'true');
        return onError(strings.tabsPermissionDeclined);
      }
      for (const [index, card] of cards.entries()) {
        await chrome.tabs.create({ url: card.url, active: index === 0 });
        opened.push(await markOpened(repository, card));
      }
      const byId = new Map(opened.map((item) => [item.id, item]));
      onCardsChange(allCards.map((item) => byId.get(item.id) ?? item));
      close();
    } catch (error) {
      if (opened.length) {
        const byId = new Map(opened.map((item) => [item.id, item]));
        onCardsChange(allCards.map((item) => byId.get(item.id) ?? item));
      }
      onError(
        `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (subMenu) setSubMenu(null);
      else close();
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [
      ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
        []),
    ];
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
            items.length;
    items[next]?.focus();
  };
  const choose = (change: Partial<Deck>) => {
    void saveDeck(change);
    close();
  };
  return (
    <div
      ref={ref}
      data-deck="deck-menu"
      className="deck-menu deck-workspace-menu"
      role="menu"
      aria-label={strings.deckMenu}
      style={style}
      onKeyDown={onKeyDown}
    >
      {subMenu === 'permission' ? (
        <>
          <p>{strings.accessTabsReason}</p>
          <button type="button" role="menuitem" onClick={() => void openAll()}>
            {strings.allowAccess}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => setSubMenu(null)}
          >
            {strings.cancel}
          </button>
        </>
      ) : subMenu === 'color' ? (
        <>
          <p>{strings.deckColor}</p>
          <div className="deck-menu__swatches">
            <button
              type="button"
              role="menuitem"
              aria-label={strings.defaultColor}
              onClick={() => choose({ color: null })}
            >
              ×
            </button>
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                role="menuitem"
                data-color={color}
                aria-label={color}
                aria-current={deck.color === color}
                onClick={() => choose({ color })}
              />
            ))}
          </div>
        </>
      ) : subMenu === 'page' ? (
        <>
          <p>{strings.moveToPage}</p>
          {pages
            .filter(({ deletedAt }) => deletedAt === null)
            .map((page) => (
              <button
                key={page.id}
                type="button"
                role="menuitem"
                disabled={page.id === deck.pageId}
                onClick={() => choose({ pageId: page.id })}
              >
                {page.title}
              </button>
            ))}
        </>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onRename();
              close();
            }}
          >
            {strings.renameDeck}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onEditNote(deck);
              close();
            }}
          >
            {strings.editDeckNote}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={cards.length === 0 || wasTabsDeclined}
            onClick={() => setSubMenu('permission')}
          >
            {strings.openAll}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => setSubMenu('color')}
          >
            {strings.deckColor}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => setSubMenu('page')}
          >
            {strings.moveToPage}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              choose({ isCollapsed: !deck.isCollapsed });
            }}
          >
            {deck.isCollapsed ? strings.expandDeck : strings.collapseDeck}
          </button>
          {deck.kind === 'normal' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onTrash();
                close();
              }}
            >
              {strings.trashDeck}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
