import type { Card, Settings } from 'deck-schema';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { strings } from '../i18n/strings';
import type { filterLineActions } from './lineActionCatalog';
import type { SurfaceData } from './bootstrap';
import type { buildSearchIndex } from './lineSearch';
import type LineResults from './LineResults';
import { shouldSpaceOpenDrawer } from './surfaceModel';
import type { NoticeInput } from './ToastStack';
import { useOpenTabs } from '../tabs/useOpenTabs';
import type { OpenTab, TabAction } from '../tabs/openTabs';

const MAX_GROUP_ROWS = 8;
const PLACEHOLDER_ROTATE_MS = 6_000;
export type ResultGroup = 'cards' | 'notes' | 'actions' | 'tabs' | 'url';

interface LineProps {
  cards: Card[];
  settings: Settings;
  repository: SurfaceData['repository'];
  openSettings: () => void;
  saveSettings: (settings: Settings) => Promise<void>;
  notify: (message: string) => void;
  notifyInfo: (message: string) => void;
  notifySuccess: (message: string) => void;
  notifyNotice: (notice: NoticeInput) => void;
  canSpaceOpenDrawer: boolean;
  openDrawer: () => void;
  openHelp: () => void;
  onDataChange?: () => void;
  openNote: (card: Card) => void;
}

export function Line(props: LineProps) {
  const { cards: sourceCards, notify } = props;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<ResultGroup>('cards');
  const [Results, setResults] = useState<typeof LineResults | null>(null);
  const [catalog, setCatalog] = useState<{
    filterLineActions: typeof filterLineActions;
  } | null>(null);
  const [makeSearch, setMakeSearch] = useState<typeof buildSearchIndex | null>(
    null,
  );
  const search = useMemo(
    () => makeSearch?.(sourceCards.filter((card) => card.deletedAt === null)),
    [makeSearch, sourceCards],
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const isTabActionPending = useRef(false);
  const isTaskPending = useRef(false);
  const isWebSearch = query[0] === '?';
  const isCommand = query[0] === '>';
  const isTabsCommand = /^>tabs(?:\s|$)/i.test(query);
  const tabState = useOpenTabs(
    Boolean(query) && !isWebSearch && (!isCommand || isTabsCommand),
    notify,
  );
  const searchTabs = useMemo(
    () => makeSearch?.(tabState.tabs),
    [makeSearch, tabState.tabs],
  );
  const tabQuery = isTabsCommand ? query.slice('>tabs'.length).trim() : query;
  const tabs = tabState.hasAccess
    ? tabQuery.trim()
      ? (searchTabs?.(tabQuery).cards ?? [])
      : tabState.tabs
    : [];
  const results =
    isWebSearch || isCommand
      ? { cards: [], notes: [], url: null }
      : (search?.(query) ?? { cards: [], notes: [], url: null });
  const actions =
    isTabsCommand && tabState.hasAccess
      ? []
      : (catalog?.filterLineActions(query, isCommand) ?? []);
  const groups = [
    results.cards.length && 'cards',
    results.notes.length && 'notes',
    actions.length && 'actions',
    tabs.length && 'tabs',
    !results.cards.length &&
      !results.notes.length &&
      !actions.length &&
      !tabs.length &&
      results.url &&
      'url',
  ].filter(Boolean) as ResultGroup[];
  const group = groups.includes(selectedGroup) ? selectedGroup : groups[0];
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
              : group === 'tabs'
                ? tabs.length
                : actions.length,
      );
  const activeIndex = itemCount > 0 ? Math.min(selected, itemCount - 1) : 0;
  useEffect(() => {
    if (isTabsCommand && tabState.hasAccess) inputRef.current?.focus();
  }, [isTabsCommand, tabState.hasAccess]);

  const keymap = useMemo(
    () =>
      new Map(
        props.settings.keymap.map(({ action, chord }) => [action, chord]),
      ),
    [props.settings.keymap],
  );
  const focusKey = keymap.get('focusLine') ?? '/';
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
      .then(setCatalog)
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
        if (isCurrent) setMakeSearch(() => buildSearchIndex);
      })
      .catch((error: unknown) => notify(String(error)));
    return () => {
      isCurrent = false;
    };
  }, [notify]);
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

  const focusTab = (index: number) => {
    const rows = shellRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-deck="tab-activate"]',
    );
    rows?.[index]?.focus();
  };
  const actOnTab = async (tab: OpenTab, action: TabAction) => {
    if (isTabActionPending.current) return;
    isTabActionPending.current = true;
    if (action === 'close') inputRef.current?.focus();
    try {
      const { performTabAction } = await import('../tabs/openTabs');
      const message = await performTabAction(props.repository, tab, action);
      if (action !== 'close') props.onDataChange?.();
      if (message) props.notifySuccess(message);
    } catch (error) {
      props.notify(
        `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await tabState.refresh();
      isTabActionPending.current = false;
    }
  };
  const execute = async (
    isNewTab: boolean,
    targetGroup = group,
    index = activeIndex,
  ) => {
    try {
      if (targetGroup === 'tabs') {
        const tab = tabs[index];
        if (tab) await actOnTab(tab, 'activate');
        return;
      }
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
          notifyNotice: props.notifyNotice,
        });
        setQuery(action.id === 'tabs' ? (isTabsCommand ? query : '>tabs') : '');
        return;
      }
      const card =
        targetGroup === 'notes'
          ? results.notes[index]?.card
          : targetGroup === 'cards'
            ? results.cards[index]
            : undefined;
      if (!card) return;
      if (!card.url) {
        props.openNote(card);
        setQuery('');
        return;
      }
      const { openCard } = await import('../drawer/inboxActions');
      await openCard(props.repository, card, isNewTab);
    } catch (lineError) {
      const detail =
        lineError instanceof Error ? lineError.message : String(lineError);
      props.notify(`${strings.updateFailed} ${detail}`);
    }
  };

  const saveTask = async () => {
    if (isTaskPending.current) return;
    isTaskPending.current = true;
    const text = query;
    try {
      const { createTask } = await import('../tasks/quickTask');
      await createTask(props.repository, text);
      setQuery((current) => (current === text ? '' : current));
      props.onDataChange?.();
      props.notifySuccess(strings.taskSaved);
    } catch (error) {
      props.notify(
        `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      isTaskPending.current = false;
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (
      event.key === 'Enter' &&
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault();
      if (!event.repeat) void saveTask();
      return;
    }
    if (
      group === 'tabs' &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    ) {
      event.preventDefault();
      focusTab(event.key === 'ArrowUp' ? itemCount - 1 : activeIndex);
      return;
    }
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
      const nextGroup =
        groups[(groups.indexOf(group ?? 'cards') + 1) % groups.length];
      if (nextGroup) setSelectedGroup(nextGroup);
      setSelected(0);
      if (nextGroup === 'tabs') focusTab(0);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void execute(event.shiftKey);
    }
  };

  return (
    <div ref={shellRef} data-deck="line-shell">
      <div data-deck="line" className="deck-line">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSelected(0);
            setSelectedGroup('cards');
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
          tabs={tabs}
          onTabAction={(tab, action) => void actOnTab(tab, action)}
          onSearch={() => inputRef.current?.focus()}
          isWebSearch={isWebSearch}
          activeGroup={group}
          activeIndex={activeIndex}
          onHover={(nextGroup, index) => {
            setSelectedGroup(nextGroup);
            setSelected(index);
          }}
          onSelect={(nextGroup, index) => void execute(false, nextGroup, index)}
        />
      ) : null}
    </div>
  );
}
