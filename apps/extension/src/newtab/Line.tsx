import type { Card, Settings } from 'deck-schema';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { strings } from '../i18n/strings';
import type { SurfaceData } from './bootstrap';
import { LINE_ACTIONS } from './lineActionCatalog';
import { searchCards, shouldSpaceOpenDrawer } from './surfaceModel';

interface LineProps {
  cards: Card[];
  settings: Settings;
  repository: SurfaceData['repository'];
  openSettings: () => void;
  saveSettings: (settings: Settings) => Promise<void>;
  notify: (message: string) => void;
  canSpaceOpenDrawer: boolean;
  openDrawer: () => void;
}

export function Line(props: LineProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeCards = props.cards.filter((card) => card.deletedAt === null);
  const cards = useMemo(
    () => searchCards(activeCards, query),
    [activeCards, query],
  );
  const actions = query.startsWith('>')
    ? LINE_ACTIONS.filter(({ command, label }) => {
        const normalizedQuery = query.toLocaleLowerCase();
        return (
          `${command} ${label}`.toLocaleLowerCase().includes(normalizedQuery) ||
          normalizedQuery.startsWith(command)
        );
      })
    : [];
  const isWebSearch = query.startsWith('?');
  const itemCount = isWebSearch ? 1 : actions.length || cards.length;
  const activeIndex = itemCount > 0 ? Math.min(selected, itemCount - 1) : 0;

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      const isInput =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;
      if (event.key === '/' && !isInput) {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (
        event.key === 'Escape' &&
        document.activeElement === inputRef.current
      ) {
        setQuery('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onWindowKeyDown);
    return () => window.removeEventListener('keydown', onWindowKeyDown);
  }, []);

  const execute = async (isNewTab: boolean) => {
    try {
      if (isWebSearch) {
        const term = query.slice(1).trim();
        if (!term) return;
        const { searchWeb } = await import('./lineActions');
        await searchWeb(term, props.settings);
        return;
      }
      const action = actions[activeIndex];
      if (action) {
        const { executeAction } = await import('./lineActions');
        await executeAction(action.id, {
          settings: props.settings,
          repository: props.repository,
          saveSettings: props.saveSettings,
          openSettings: props.openSettings,
          notify: props.notify,
        });
        return;
      }
      const card = cards[activeIndex];
      if (!card) return;
      if (isNewTab) window.open(card.url, '_blank', 'noopener');
      else window.location.assign(card.url);
    } catch (lineError) {
      const detail =
        lineError instanceof Error ? lineError.message : String(lineError);
      props.notify(`${strings.updateFailed} ${detail}`);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (shouldSpaceOpenDrawer(event.key, query, props.canSpaceOpenDrawer)) {
      event.preventDefault();
      props.openDrawer();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected(itemCount ? (activeIndex + 1) % itemCount : 0);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected(itemCount ? (activeIndex - 1 + itemCount) % itemCount : 0);
    }
    if (event.key === 'Tab' && itemCount) {
      event.preventDefault();
      setSelected((activeIndex + 1) % itemCount);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void execute(event.shiftKey);
    }
  };

  return (
    <div data-deck="line-shell">
      <div data-deck="line" className="deck-line">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={strings.linePlaceholder}
          aria-label={strings.linePlaceholder}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {query ? (
        <Results
          cards={cards}
          actions={actions}
          isWebSearch={isWebSearch}
          activeIndex={activeIndex}
        />
      ) : (
        <p data-deck="example-hint" className="deck-example-hint">
          {strings.exampleHint}
        </p>
      )}
    </div>
  );
}

function Results({
  cards,
  actions,
  isWebSearch,
  activeIndex,
}: {
  cards: Card[];
  actions: typeof LINE_ACTIONS;
  isWebSearch: boolean;
  activeIndex: number;
}) {
  return (
    <section
      data-deck="line-results"
      className="deck-results"
      aria-live="polite"
    >
      {isWebSearch ? (
        <>
          <h2>{strings.searchWeb}</h2>
          <p data-active>{strings.searchPermissionReason}</p>
        </>
      ) : null}
      {actions.length ? (
        <>
          <h2>{strings.actionsGroup}</h2>
          {actions.map((action, index) => (
            <div
              key={action.id}
              data-active={index === activeIndex || undefined}
              className="deck-result"
            >
              <span>{action.command}</span>
              <small>{action.label}</small>
            </div>
          ))}
        </>
      ) : null}
      {!isWebSearch && !actions.length ? (
        <>
          <h2>{strings.cardsGroup}</h2>
          {cards.length ? (
            cards.map((card, index) => (
              <a
                key={card.id}
                data-deck="card"
                data-active={index === activeIndex || undefined}
                href={card.url}
                className="deck-result"
              >
                <span>{card.title}</span>
                <small>{card.hostname}</small>
              </a>
            ))
          ) : (
            <p>{strings.noResults}</p>
          )}
        </>
      ) : null}
    </section>
  );
}
