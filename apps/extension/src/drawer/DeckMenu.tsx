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
const MENU_GAP = 8;
const MENU_WIDTH = 224;
const MENU_HEIGHT = 430;

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
    'color' | 'page' | 'permission' | null
  >(null);
  const hasLinks = cards.some((card) => card.url !== undefined);
  const rect = anchor.getBoundingClientRect();
  const isRtl = document.documentElement.dir === 'rtl';
  const inline = isRtl ? window.innerWidth - rect.right : rect.left;
  const style = {
    maxBlockSize: `calc(100dvh - ${MENU_GAP * 2}px)`,
    overflowY: 'auto',
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
      aria-label={strings.deckMenu}
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
