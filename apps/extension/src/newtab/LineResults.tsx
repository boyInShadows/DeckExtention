import type { Card } from 'deck-schema';

import { panelStrings as strings } from '../i18n/panelStrings';
import type { LINE_ACTIONS } from './lineActionCatalog';
import type { SearchResults } from './lineSearch';
import type { ResultGroup } from './Line';
import { MarkdownNote } from '../drawer/MarkdownNote';

export default function LineResults({
  cards,
  notes,
  fallbackUrl,
  actions,
  isWebSearch,
  activeGroup,
  activeIndex,
  maxRows,
  onHover,
  onSelect,
}: {
  cards: Card[];
  notes: SearchResults<Card>['notes'];
  fallbackUrl: string | null;
  actions: typeof LINE_ACTIONS;
  isWebSearch: boolean;
  activeGroup: ResultGroup | undefined;
  activeIndex: number;
  maxRows: number;
  onHover: (group: ResultGroup, index: number) => void;
  onSelect: (group: ResultGroup, index: number) => void;
}) {
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
            data-active
            onClick={() => onSelect('url', 0)}
          >
            {strings.searchPermissionReason}
          </button>
        </>
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
      {!isWebSearch && !sections.length ? <p>{strings.noResults}</p> : null}
    </section>
  );
}
