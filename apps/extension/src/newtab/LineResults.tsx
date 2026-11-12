import type { Card } from 'deck-schema';
import { useLayoutEffect, useRef } from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import type { LINE_ACTIONS } from './lineActionCatalog';
import type { SearchResults } from './lineSearch';
import type { ResultGroup } from './Line';
import { MarkdownNote } from '../drawer/MarkdownNote';
import { TabResults } from '../tabs/TabResults';
import type { OpenTab, TabAction } from '../tabs/openTabs';

export default function LineResults({
  cards,
  notes,
  fallbackUrl,
  actions,
  isWebSearch,
  webQuery,
  suggestions,
  areSuggestionsUnavailable,
  activeGroup,
  activeIndex,
  maxRows,
  onHover,
  onSelect,
  tabs,
  onTabAction,
  onSearch,
}: {
  cards: Card[];
  notes: SearchResults<Card>['notes'];
  fallbackUrl: string | null;
  actions: typeof LINE_ACTIONS;
  isWebSearch: boolean;
  webQuery: string;
  suggestions: string[];
  areSuggestionsUnavailable: boolean;
  activeGroup: ResultGroup | undefined;
  activeIndex: number;
  maxRows: number;
  onHover: (group: ResultGroup, index: number) => void;
  onSelect: (group: ResultGroup, index: number) => void;
  tabs: OpenTab[];
  onTabAction: (tab: OpenTab, action: TabAction) => void;
  onSearch: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  // Settings and clock changes can move the Line without a window resize.
  useLayoutEffect(() => {
    const update = () => {
      const top = panel.current?.getBoundingClientRect().top ?? 0;
      panel.current?.style.setProperty('--deck-results-start', `${top}px`);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  });
  const sections = [
    {
      group: 'cards' as const,
      label: strings.cardsGroup,
      rows: cards.map((card) => ({
        id: card.id,
        title: card.title,
        detail: card.hostname,
      })),
    },
    {
      group: 'notes' as const,
      label: strings.notesGroup,
      rows: notes.map(({ card, snippet }) => ({
        id: card.id,
        title: card.title,
        detail: snippet,
      })),
    },
    {
      group: 'actions' as const,
      label: strings.actionsGroup,
      rows: actions.map((action) => ({
        id: action.id,
        title: action.command,
        detail: action.label,
      })),
    },
    {
      group: 'url' as const,
      label: strings.openUrl,
      rows: fallbackUrl
        ? [{ id: fallbackUrl, title: fallbackUrl, detail: strings.openUrl }]
        : [],
    },
  ].filter(({ rows }) => rows.length);
  return (
    <section
      ref={panel}
      data-deck="line-results"
      className="deck-results deck-blurrable"
      aria-live="polite"
    >
      {isWebSearch ? (
        <>
          <h2>{strings.searchWeb}</h2>
          <button
            type="button"
            className="deck-result"
            data-deck="web-search-result"
            data-active={activeGroup === 'web' || undefined}
            onMouseEnter={() => onHover('web', 0)}
            onClick={() => onSelect('web', 0)}
          >
            <span>{strings.searchFor(webQuery)}</span>
            <small>{strings.searchSubmitKey}</small>
          </button>
        </>
      ) : null}
      {suggestions.length ? (
        <div data-deck="line-group" data-group="google">
          <h2>{strings.googleSuggestions}</h2>
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              className="deck-result"
              data-deck="google-suggestion"
              data-active={
                (activeGroup === 'suggestions' && index === activeIndex) ||
                undefined
              }
              aria-current={
                (activeGroup === 'suggestions' && index === activeIndex) ||
                undefined
              }
              onMouseEnter={() => onHover('suggestions', index)}
              onClick={() => onSelect('suggestions', index)}
            >
              <span>{suggestion}</span>
            </button>
          ))}
        </div>
      ) : null}
      {areSuggestionsUnavailable ? (
        <p data-deck="google-suggestions-status">
          {strings.googleSuggestionsUnavailable}
        </p>
      ) : null}
      {sections.map(({ group, label, rows }) => (
        <div key={group} data-deck="line-group">
          <h2>{label}</h2>
          {rows.slice(0, maxRows).map((row, index) => (
            <button
              key={row.id}
              type="button"
              className="deck-result"
              data-deck={
                group === 'cards'
                  ? 'card'
                  : group === 'notes'
                    ? 'note-result'
                    : group === 'url'
                      ? 'url-result'
                      : 'action-result'
              }
              data-active={
                (group === activeGroup && index === activeIndex) || undefined
              }
              onMouseEnter={() => onHover(group, index)}
              onClick={() => onSelect(group, index)}
            >
              <span>{row.title}</span>
              <small>
                {group === 'notes' ? (
                  <MarkdownNote value={row.detail} compact />
                ) : (
                  row.detail
                )}
              </small>
            </button>
          ))}
          {rows.length > maxRows ? (
            <p data-deck="result-more">
              {strings.moreResults(rows.length - maxRows)}
            </p>
          ) : null}
        </div>
      ))}
      <TabResults
        tabs={tabs}
        maxRows={maxRows}
        activeIndex={activeIndex}
        isActive={activeGroup === 'tabs'}
        onHover={(index) => onHover('tabs', index)}
        onSelect={(index) => onSelect('tabs', index)}
        onAction={onTabAction}
        onSearch={onSearch}
      />
      {!isWebSearch && !sections.length && !tabs.length ? (
        <p>{strings.noResults}</p>
      ) : null}
    </section>
  );
}
