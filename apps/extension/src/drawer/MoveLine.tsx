import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import { useDismissable } from '../hooks/useDismissable';
import { clampIndex, rankMoveTargets, type MoveTarget } from './inboxModel';

interface MoveLineProps {
  targets: MoveTarget[];
  recentDeckIds: string[];
  onMove: (deckId: string) => void;
  onCancel: () => void;
}

const RESULTS_ID = 'deck-move-results';

/**
 * The "move to…" mini-Line (FableTasks P2.S5): type a few letters of the
 * page or deck, Enter moves. Empty, it offers the last three destinations.
 */
export function MoveLine({
  targets,
  recentDeckIds,
  onMove,
  onCancel,
}: MoveLineProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  useDismissable(ref, onCancel);
  const ranked = useMemo(
    () => rankMoveTargets(targets, query, recentDeckIds),
    [query, recentDeckIds, targets],
  );
  const position = clampIndex(active, ranked.length);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Triage keys belong to the list, not to what is being typed here.
    event.stopPropagation();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(clampIndex(position + step, ranked.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = ranked[position];
      if (target) onMove(target.deckId);
    }
  };

  return (
    <div ref={ref} data-deck="move-line" className="deck-move-line">
      <input
        ref={inputRef}
        className="deck-move-line__input"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder={strings.moveTo}
        aria-label={strings.moveTo}
        role="combobox"
        aria-expanded="true"
        aria-controls={RESULTS_ID}
        aria-activedescendant={
          ranked[position] ? `${RESULTS_ID}-${position}` : undefined
        }
      />
      {ranked.length ? (
        <ul id={RESULTS_ID} role="listbox" aria-label={strings.moveTo}>
          {ranked.map((target, index) => (
            <li
              key={target.deckId}
              id={`${RESULTS_ID}-${index}`}
              role="option"
              aria-selected={index === position}
              // mousedown, so the input's blur does not cancel first
              onMouseDown={(event) => {
                event.preventDefault();
                onMove(target.deckId);
              }}
            >
              <span className="deck-blurrable">{target.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>{targets.length ? strings.noDeckMatch : strings.noDecks}</p>
      )}
    </div>
  );
}
