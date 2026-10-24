import type { Page } from 'deck-schema';
import { useRef, useState } from 'react';
import { panelStrings as strings } from '../i18n/panelStrings';
import { useDismissable } from '../hooks/useDismissable';
import { focusOnMount } from '../newtab/focusOnMount';
import { activePages } from './drawerModel';

export function PageDeleteSheet({
  page,
  pages,
  deckCount,
  onCancel,
  onConfirm,
}: {
  page: Page;
  pages: Page[];
  deckCount: number;
  onCancel: () => void;
  onConfirm: (destinationId: string | null) => void;
}) {
  const targets = activePages(pages).filter(({ id }) => id !== page.id);
  const [destinationId, setDestinationId] = useState(targets[0]?.id ?? '');
  const sheetRef = useRef<HTMLDivElement>(null);
  const [returnFocus] = useState(
    () => document.activeElement as HTMLElement | null,
  );
  useDismissable(sheetRef, onCancel, returnFocus);
  return (
    <div
      ref={sheetRef}
      data-deck="page-delete-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={strings.deletePage}
    >
      <p>{strings.pageDeleteTitle(deckCount)}</p>
      {targets.length ? (
        <label>
          {strings.selectDestination}
          <select
            value={destinationId}
            onChange={(event) => setDestinationId(event.currentTarget.value)}
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button ref={focusOnMount} type="button" onClick={onCancel}>
        {strings.cancel}
      </button>
      {targets.length ? (
        <button type="button" onClick={() => onConfirm(destinationId)}>
          {strings.movePageDecks}
        </button>
      ) : null}
      <button type="button" onClick={() => onConfirm(null)}>
        {strings.trashPageAndDecks}
      </button>
    </div>
  );
}
