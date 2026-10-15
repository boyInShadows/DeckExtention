import type { Card } from 'deck-schema';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';

import { strings } from '../i18n/strings';
import { useDismissable } from '../hooks/useDismissable';

const MENU_WIDTH = 192;
const MENU_HEIGHT = 128;
const MENU_GAP = 8;

export default function PinMenu({
  card,
  anchor,
  onClose,
  onUpdate,
}: {
  card: Card;
  anchor: HTMLElement;
  onClose: () => void;
  onUpdate: (change: Partial<Card>) => Promise<boolean>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<'label' | 'icon' | null>(null);
  const [value, setValue] = useState('');
  const rect = anchor.getBoundingClientRect();
  const anchorStart =
    document.documentElement.dir === 'rtl'
      ? window.innerWidth - rect.right
      : rect.left;
  const inline = Math.min(
    anchorStart,
    window.innerWidth - MENU_WIDTH - MENU_GAP,
  );
  const block =
    rect.bottom + MENU_HEIGHT + MENU_GAP <= window.innerHeight
      ? rect.bottom + MENU_GAP
      : rect.top - MENU_HEIGHT - MENU_GAP;
  const style = {
    insetInlineStart: Math.max(MENU_GAP, inline),
    insetBlockStart: Math.max(MENU_GAP, block),
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
            onClick={() => void save({ pinned: false })}
          >
            {strings.unpin}
          </button>
        </>
      )}
    </div>
  );
}
