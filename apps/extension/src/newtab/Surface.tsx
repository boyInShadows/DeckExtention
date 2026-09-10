import { useEffect, useMemo, useRef, useState } from 'react';

import { strings } from '../i18n/strings';
import type { SurfaceData } from './bootstrap';
import { Pins } from './Pins';
import { greetingForHour, searchCards } from './surfaceModel';

const CLOCK_UPDATE_MS = 1_000;

export interface SurfaceProps {
  initialData: SurfaceData;
}

export function Surface({ initialData }: SurfaceProps) {
  const [now, setNow] = useState(() => new Date());
  const [query, setQuery] = useState('');
  const [cards, setCards] = useState(initialData.cards);
  const lineRef = useRef<HTMLInputElement>(null);
  const activeCards = cards.filter((card) => card.deletedAt === null);
  const results = useMemo(
    () => searchCards(activeCards, query),
    [activeCards, query],
  );
  const { ownerName, showSeconds } = initialData.settings;

  useEffect(() => {
    const interval = window.setInterval(
      () => setNow(new Date()),
      CLOCK_UPDATE_MS,
    );
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '/' && document.activeElement !== lineRef.current) {
        event.preventDefault();
        lineRef.current?.focus();
      }
      if (
        event.key === 'Escape' &&
        document.activeElement === lineRef.current
      ) {
        setQuery('');
        lineRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: showSeconds ? '2-digit' : undefined,
    hour12: false,
  }).format(now);

  return (
    <main data-deck="surface" className="deck-surface">
      <div data-deck="surface-column" className="deck-surface__column">
        <time
          data-deck="clock"
          className="deck-clock"
          dateTime={now.toISOString()}
        >
          {time}
        </time>
        {ownerName ? (
          <p data-deck="greeting" className="deck-greeting">
            {greetingForHour(now.getHours())}, {ownerName}
          </p>
        ) : null}
        <div data-deck="line" className="deck-line">
          <input
            ref={lineRef}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={strings.linePlaceholder}
            aria-label={strings.linePlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {query ? (
          <section
            data-deck="line-results"
            className="deck-results"
            aria-live="polite"
          >
            {results.length > 0 ? (
              results.map((card) => (
                <a
                  key={card.id}
                  data-deck="card"
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
          </section>
        ) : (
          <p data-deck="example-hint" className="deck-example-hint">
            {strings.exampleHint}
          </p>
        )}
        <Pins
          cards={cards}
          defaultDeckId={initialData.defaultDeckId}
          repository={initialData.repository}
          onCardsChange={setCards}
        />
      </div>
    </main>
  );
}
