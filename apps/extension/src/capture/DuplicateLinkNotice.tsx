import { useRef } from 'react';
import { panelStrings as strings } from '../i18n/panelStrings';
import type { DeckRepository } from '../storage/repository';
import { openCard } from '../drawer/inboxActions';
import type { SavedLink } from './manualDuplicate';
import './duplicateLink.css';

export function DuplicateLinkNotice({
  duplicate,
  repository,
  onError,
}: {
  duplicate: SavedLink;
  repository: DeckRepository;
  onError: (message: string) => void;
}) {
  const isOpening = useRef(false);
  const open = async () => {
    if (isOpening.current) return;
    isOpening.current = true;
    try {
      await openCard(repository, duplicate.card, true);
    } catch (error) {
      onError(
        `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      isOpening.current = false;
    }
  };
  return (
    <div
      data-deck="duplicate-link"
      className="deck-duplicate-link"
      role="status"
    >
      <p>{strings.alreadySavedIn(duplicate.location)}</p>
      <button type="button" onClick={() => void open()}>
        {strings.openSavedLink}
      </button>
    </div>
  );
}
