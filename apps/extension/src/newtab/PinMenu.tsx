import type { Card } from 'deck-schema';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import { useDismissable } from '../hooks/useDismissable';
import { openCardIncognito } from '../drawer/inboxActions';
import type { DeckRepository } from '../storage/repository';

const MENU_WIDTH = 12;
const MENU_HEIGHT = 12;
const MENU_GAP = 0.5;

export default function PinMenu({
  card,
  anchor,
  onClose,
  onUpdate,
  repository,
  onOpened,
  onError,
}: {
  card: Card;
  anchor: HTMLElement;
  onClose: () => void;
  onUpdate: (change: Partial<Card>) => Promise<boolean>;
  repository: DeckRepository;
  onOpened: (current: Card) => void;
  onError: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<'label' | 'icon' | null>(null);
  const [value, setValue] = useState('');
  const rect = anchor.getBoundingClientRect();
  const rem = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  const viewportWidth = window.innerWidth / rem;
  const viewportHeight = window.innerHeight / rem;
  const anchorStart =
    (document.documentElement.dir === 'rtl'
      ? window.innerWidth - rect.right
      : rect.left) / rem;
  const inline = Math.min(anchorStart, viewportWidth - MENU_WIDTH - MENU_GAP);
  const block =
    rect.bottom / rem + MENU_HEIGHT + MENU_GAP <= viewportHeight
      ? rect.bottom / rem + MENU_GAP
      : rect.top / rem - MENU_HEIGHT - MENU_GAP;
  const blockStart = Math.max(MENU_GAP, block);
  const style = {
    insetInlineStart: `${Math.max(MENU_GAP, inline)}rem`,
    insetBlockStart: `${blockStart}rem`,
    maxBlockSize: `${Math.max(MENU_GAP, viewportHeight - blockStart - MENU_GAP)}rem`,
    overflowY: 'auto',
  } satisfies CSSProperties;

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [editing]);
  useDismissable(ref, onClose, anchor);

  const close = () => {
    onClose();
    anchor.focus();
  };
  const save = async (change: Partial<Card>) => {
    if (await onUpdate(change)) close();
  };
  const openIncognito = async () => {
    close();
    try {
      if (!(await openCardIncognito(repository, card, onOpened)))
        onError(strings.incognitoUnavailable);
    } catch (error) {
      onError(
        `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
      return;
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

  return (
    <div
      ref={ref}
      data-deck="pin-menu"
      className="deck-menu deck-pin-menu"
      style={style}
      role={editing ? 'dialog' : 'menu'}
      aria-label={
        editing ? strings.renamePinPrompt : (card.pinLabel ?? card.title)
      }
      onKeyDown={onKeyDown}
    >
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(
              editing === 'label'
                ? { pinLabel: value.trim() || undefined }
                : { pinIcon: value.trim() || undefined },
            );
          }}
        >
          <input
            autoFocus
            aria-label={
              editing === 'label' ? strings.renamePinPrompt : strings.iconPrompt
            }
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
          <button type="submit">{strings.savePin}</button>
        </form>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setValue(card.pinLabel ?? card.title);
              setEditing('label');
            }}
          >
            {strings.renamePin}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setValue(card.pinIcon ?? '');
              setEditing('icon');
            }}
          >
            {strings.changePinIcon}
          </button>
          <button
            type="button"
            role="menuitem"
            data-deck="pin-incognito"
            onClick={() => void openIncognito()}
          >
            {strings.openIncognito}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void save({ pinned: false })}
          >
            {strings.unpin}
          </button>
        </>
      )}
    </div>
  );
}
