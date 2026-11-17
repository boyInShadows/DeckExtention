import type { Card, Deck, Page } from 'deck-schema';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import { useDismissable } from '../hooks/useDismissable';
import { Icon } from '../newtab/Icon';
import { TAB_GROUPS_PERMISSION_DECLINED_KEY } from '../permissions/keys';
import type { DeckOpenMode } from '../sessions/openDeck';
import { SESSION_LIFETIME_MS } from '../sessions/constants';

const COLORS = ['slate', 'blue', 'green', 'amber', 'rose'] as const;
const MENU_GAP = 0.5;
const MENU_WIDTH = 14;
const MENU_HEIGHT = 29;

export function DeckMenu({
  anchor,
  deck,
  pages,
  cards,
  onOpen,
  saveDeck,
  onRename,
  onEditNote,
  onTrash,
  onClose,
  onError,
}: {
  anchor: HTMLElement;
  deck: Deck;
  pages: Page[];
  cards: Card[];
  onOpen: (mode: DeckOpenMode) => Promise<void>;
  saveDeck: (change: Partial<Deck>) => Promise<void>;
  onRename: () => void;
  onEditNote: (deck: Deck) => void;
  onTrash: () => void;
  onClose: () => void;
  onError: (value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [wasGroupDeclined, setWasGroupDeclined] = useState<boolean | null>(
    null,
  );
  const [subMenu, setSubMenu] = useState<
    'color' | 'page' | 'permission' | 'sort' | null
  >(null);
  const hasLinks = cards.some((card) => card.url !== undefined);
  const rect = anchor.getBoundingClientRect();
  const rem = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  // The transformed drawer is the containing block for this fixed menu.
  const container = anchor
    .closest('[data-deck="drawer"]')
    ?.getBoundingClientRect();
  const viewportWidth = (container?.width ?? window.innerWidth) / rem;
  const viewportHeight = (container?.height ?? window.innerHeight) / rem;
  const top = (rect.top - (container?.top ?? 0)) / rem;
  const bottom = (rect.bottom - (container?.top ?? 0)) / rem;
  const isRtl = document.documentElement.dir === 'rtl';
  const inline =
    (isRtl
      ? (container?.right ?? window.innerWidth) - rect.right
      : rect.left - (container?.left ?? 0)) / rem;
  const blockStart = Math.max(
    MENU_GAP,
    bottom + MENU_HEIGHT <= viewportHeight
      ? bottom + MENU_GAP
      : top - MENU_HEIGHT - MENU_GAP,
  );
  const style = {
    maxBlockSize: `${Math.max(MENU_GAP, viewportHeight - blockStart - MENU_GAP)}rem`,
    overflowY: 'auto',
    insetInlineStart: `${Math.max(
      MENU_GAP,
      Math.min(inline, viewportWidth - MENU_WIDTH - MENU_GAP),
    )}rem`,
    insetBlockStart: `${blockStart}rem`,
  } satisfies CSSProperties;

  useEffect(() => {
    void chrome.storage.local.get(TAB_GROUPS_PERMISSION_DECLINED_KEY).then(
      (items) =>
        setWasGroupDeclined(items[TAB_GROUPS_PERMISSION_DECLINED_KEY] === true),
      (error) => onError(String(error)),
    );
  }, [onError]);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')
      ?.focus();
  }, [subMenu]);
  useDismissable(ref, onClose, anchor);

  const close = () => {
    onClose();
    anchor.focus();
  };
  const openGroup = async (shouldRequest = false) => {
    try {
      const permission = {
        permissions: [
          'tabGroups',
        ] as chrome.runtime.ManifestOptionalPermission[],
      };
      if (wasGroupDeclined) return onError(strings.tabGroupsPermissionDeclined);
      const allowed = shouldRequest
        ? await chrome.permissions.request(permission)
        : await chrome.permissions.contains(permission);
      if (!allowed && !shouldRequest) return setSubMenu('permission');
      if (!allowed) {
        await chrome.storage.local.set({
          [TAB_GROUPS_PERMISSION_DECLINED_KEY]: true,
        });
        setWasGroupDeclined(true);
        return onError(strings.tabGroupsPermissionDeclined);
      }
      await onOpen('group');
    } catch (error) {
      onError(
        `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [
      ...(ref.current?.querySelectorAll<HTMLElement>(
        '[role^="menuitem"]:not(:disabled)',
      ) ?? []),
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
      aria-label={subMenu === 'sort' ? strings.sortCards : strings.deckMenu}
      style={style}
      onKeyDown={onKeyDown}
    >
      {subMenu === 'permission' ? (
        <>
          <p>{strings.accessTabGroupsReason}</p>
          <button
            type="button"
            role="menuitem"
            disabled={wasGroupDeclined === null || wasGroupDeclined}
            onClick={() => void openGroup(true)}
          >
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
      ) : subMenu === 'sort' ? (
        <>
          <p data-deck="deck-sort-hint">{strings.sortCardsHint}</p>
          {(['manual', 'title', 'newest', 'hostname'] as const).map(
            (sortMode) => (
              <button
                key={sortMode}
                type="button"
                role="menuitemradio"
                data-deck="deck-sort-option"
                aria-label={strings.deckSort[sortMode]}
                aria-checked={(deck.sortMode ?? 'manual') === sortMode}
                onClick={() => choose({ sortMode })}
              >
                {strings.deckSort[sortMode]}
                {(deck.sortMode ?? 'manual') === sortMode ? (
                  <span data-deck="deck-sort-selected" aria-hidden="true">
                    {' '}
                    ✓
                  </span>
                ) : null}
              </button>
            ),
          )}
        </>
      ) : subMenu === 'color' ? (
        <>
          <p>{strings.deckColor}</p>
          <div className="deck-menu__swatches">
            <button
              type="button"
              role="menuitem"
              aria-label={strings.defaultColor}
              title={strings.defaultColor}
              onClick={() => choose({ color: null })}
            >
              <Icon name="close" />
            </button>
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                role="menuitem"
                data-color={color}
                aria-label={color}
                title={color}
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
                <span className="deck-blurrable">{page.title}</span>
              </button>
            ))}
        </>
      ) : (
        <>
          <button
            type="button"
            role="menuitemcheckbox"
            data-deck="deck-task-mode"
            aria-checked={Boolean(deck.isTaskMode)}
            onClick={() => choose({ isTaskMode: !deck.isTaskMode })}
          >
            {strings.taskMode}
          </button>
          <button
            type="button"
            role="menuitem"
            data-deck="deck-sort"
            aria-haspopup="menu"
            onClick={() => setSubMenu('sort')}
          >
            {strings.sortCards}
          </button>
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
          {deck.kind === 'session' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                choose({
                  expiresAt:
                    deck.expiresAt === undefined
                      ? Date.now() + SESSION_LIFETIME_MS
                      : undefined,
                })
              }
            >
              {deck.expiresAt === undefined
                ? strings.unpinSession
                : strings.pinSession}
            </button>
          ) : null}
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
            disabled={!hasLinks}
            data-deck={
              deck.kind === 'session' ? 'session-restore' : 'deck-open-links'
            }
            onClick={() =>
              void onOpen(deck.kind === 'session' ? 'restore' : 'tabs')
            }
          >
            {deck.kind === 'session' ? strings.restoreSession : strings.openAll}
          </button>
          {deck.kind === 'session' ? (
            <button
              type="button"
              role="menuitem"
              disabled={!hasLinks}
              onClick={() => void onOpen('restore-and-trash')}
              data-deck="session-restore-trash"
            >
              {strings.restoreSessionAndTrash}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={!hasLinks || wasGroupDeclined === null}
            onClick={() => void openGroup()}
            data-deck="deck-open-group"
          >
            {strings.openAsTabGroup}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => setSubMenu('color')}
          >
            {strings.deckColor}
          </button>
          {deck.kind === 'normal' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => setSubMenu('page')}
            >
              {strings.moveToPage}
            </button>
          ) : null}
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
