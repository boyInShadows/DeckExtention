import type { Card, Settings } from 'deck-schema';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { strings } from '../i18n/strings';
import type { SurfaceData } from './bootstrap';
import type { LINE_ACTIONS } from './lineActionCatalog';
import type { SearchResults } from './lineSearch';
import type LineResults from './LineResults';
import { shouldSpaceOpenDrawer } from './surfaceModel';

const MAX_GROUP_ROWS = 8;
const PLACEHOLDER_ROTATE_MS = 6_000;
export type ResultGroup = 'cards' | 'notes' | 'actions' | 'url';

interface LineProps {
  cards: Card[];
  settings: Settings;
  repository: SurfaceData['repository'];
  openSettings: () => void;
  saveSettings: (settings: Settings) => Promise<void>;
  notify: (message: string) => void;
  notifyInfo: (message: string) => void;
  notifySuccess: (message: string) => void;
  canSpaceOpenDrawer: boolean;
  openDrawer: () => void;
  openHelp: () => void;
}

export function Line(props: LineProps) {
  const { cards: sourceCards, notify } = props;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(0);
  const [Results, setResults] = useState<typeof LineResults | null>(null);
  const [catalog, setCatalog] = useState<typeof LINE_ACTIONS>([]);
  const [search, setSearch] = useState<(query: string) => SearchResults<Card>>(
    () => () => ({ cards: [], notes: [], url: null }),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const isWebSearch = query.startsWith('?');
  const isCommand = query.startsWith('>');
  const results =
    isWebSearch || isCommand
      ? { cards: [], notes: [], url: null }
      : search(query);
  const actions =
    !query || isWebSearch
      ? []
      : catalog.filter(({ command, label }) => {
          const lower = query.toLowerCase();
          return isCommand
            ? `${command} ${label}`.toLowerCase().includes(lower) ||
                lower.startsWith(command)
            : label.toLowerCase().includes(lower);
        });
  const groups: ResultGroup[] = [
    ...(results.cards.length ? ['cards' as const] : []),
    ...(results.notes.length ? ['notes' as const] : []),
    ...(actions.length ? ['actions' as const] : []),
    ...(!results.cards.length &&
    !results.notes.length &&
    !actions.length &&
    results.url
      ? ['url' as const]
      : []),
  ];
  const group = groups[Math.min(selectedGroup, groups.length - 1)];
  const itemCount = isWebSearch
    ? 1
    : Math.min(
        MAX_GROUP_ROWS,
        group === 'url'
          ? 1
          : group === 'cards'
            ? results.cards.length
            : group === 'notes'
              ? results.notes.length
              : actions.length,
      );
  const activeIndex = itemCount > 0 ? Math.min(selected, itemCount - 1) : 0;

  const focusKey =
    props.settings.keymap.find(({ action }) => action === 'focusLine')?.chord ??
    '/';
  useEffect(() => {
    if (query || isFocused) return;
    const timer = window.setInterval(
      () => setShowHint((value) => !value),
      PLACEHOLDER_ROTATE_MS,
    );
    return () => window.clearInterval(timer);
  }, [query, isFocused]);
  useEffect(() => {
    void import('./lineActionCatalog')
      .then((module) => setCatalog(module.LINE_ACTIONS))
      .catch((error: unknown) => notify(String(error)));
  }, [notify]);
  useEffect(() => {
    void import('./LineResults')
      .then((module) => setResults(() => module.default))
      .catch((error: unknown) => notify(String(error)));
  }, [notify]);
  useEffect(() => {
    let isCurrent = true;
    void import('./lineSearch')
      .then(({ buildSearchIndex }) => {
        if (isCurrent)
          setSearch(() =>
            buildSearchIndex(
              sourceCards.filter((card) => card.deletedAt === null),
            ),
          );
      })
      .catch((error: unknown) => notify(String(error)));
    return () => {
      isCurrent = false;
    };
  }, [sourceCards, notify]);
  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      const isInput =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;
      if (event.key === focusKey && !isInput) {
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
  }, [focusKey]);

  const execute = async (
    isNewTab: boolean,
    targetGroup = group,
    index = activeIndex,
  ) => {
    try {
      if (isWebSearch) {
        const term = query.slice(1).trim();
        // "?" alone is help, not an empty web search (P2.S6).
        if (!term) return props.openHelp();
        const { searchWeb } = await import('./lineActions');
        await searchWeb(term, props.settings, props.saveSettings);
        return;
      }
      if (targetGroup === 'url' && results.url) {
        if (isNewTab) window.open(results.url, '_blank', 'noopener');
        else window.location.assign(results.url);
        return;
      }
      const action = targetGroup === 'actions' ? actions[index] : undefined;
      if (action) {
        const { executeAction } = await import('./lineActions');
        await executeAction(action.id, {
          settings: props.settings,
          repository: props.repository,
          saveSettings: props.saveSettings,
          openSettings: props.openSettings,
          notify: props.notifyInfo,
          notifySuccess: props.notifySuccess,
        });
        setQuery('');
        return;
      }
      const card =
        targetGroup === 'notes'
          ? results.notes[index]?.card
          : targetGroup === 'cards'
            ? results.cards[index]
            : undefined;
      if (!card) return;
      const { openCard } = await import('../drawer/inboxActions');
      await openCard(props.repository, card, isNewTab);
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
    if (event.key === 'Tab' && groups.length) {
      event.preventDefault();
      setSelectedGroup((selectedGroup + 1) % groups.length);
      setSelected(0);
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
            setSelectedGroup(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={
            showHint ? strings.lineKeyboardHint : strings.linePlaceholder
          }
          aria-label={strings.linePlaceholder}
          onFocus={() => {
            setIsFocused(true);
            setShowHint(false);
          }}
          onBlur={() => {
            setIsFocused(false);
            setShowHint(false);
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {query && Results ? (
        <Results
          maxRows={MAX_GROUP_ROWS}
          cards={results.cards}
          notes={results.notes}
          fallbackUrl={group === 'url' ? results.url : null}
          actions={actions}
          isWebSearch={isWebSearch}
          activeGroup={group}
          activeIndex={activeIndex}
          onHover={(nextGroup, index) => {
            setSelectedGroup(groups.indexOf(nextGroup));
            setSelected(index);
          }}
          onSelect={(nextGroup, index) => void execute(false, nextGroup, index)}
        />
      ) : null}
    </div>
  );
}
