import { useRef, type KeyboardEvent } from 'react';
import { panelStrings as strings } from '../i18n/panelStrings';
import { Icon } from '../newtab/Icon';
import type { OpenTab, TabAction } from './openTabs';
import './tabs.css';

export function TabResults({
  tabs,
  activeIndex,
  isActive,
  maxRows,
  onHover,
  onSelect,
  onAction,
  onSearch,
}: {
  tabs: OpenTab[];
  activeIndex: number;
  isActive: boolean;
  maxRows: number;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
  onAction: (tab: OpenTab, action: TabAction) => void;
  onSearch: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: OpenTab,
    index: number,
  ) => {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.nativeEvent.isComposing
    )
      return;
    if (event.key === 'x' || event.key === 's') {
      event.preventDefault();
      event.stopPropagation();
      onAction(tab, event.key === 'x' ? 'close' : 'save');
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onSearch();
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = ref.current?.querySelectorAll<HTMLButtonElement>(
        '[data-deck="tab-activate"]',
      );
      if (!rows?.length) return;
      rows[
        (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) %
          rows.length
      ]?.focus();
    }
  };
  if (!tabs.length) return null;
  return (
    <div ref={ref} data-deck="line-group" data-group="tabs">
      <h2>{strings.openTabsGroup}</h2>
      <p data-deck="tab-keys" id="deck-tab-keys">
        {strings.tabKeys}
      </p>
      {tabs.slice(0, maxRows).map((tab, index) => (
        <div key={tab.id} data-deck="tab-result" className="deck-tab-result">
          <button
            type="button"
            data-deck="tab-activate"
            className="deck-result"
            data-active={(isActive && index === activeIndex) || undefined}
            aria-describedby="deck-tab-keys"
            onMouseEnter={() => onHover(index)}
            onFocus={() => onHover(index)}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => onKeyDown(event, tab, index)}
          >
            <span>{tab.title}</span>
            <small>
              {tab.hostname} · {tab.windowLabel}
            </small>
          </button>
          <button
            type="button"
            data-deck="tab-save"
            className="deck-tab-action"
            aria-label={strings.saveOpenTab(tab.title)}
            title={strings.saveOpenTab(tab.title)}
            onClick={() => onAction(tab, 'save')}
          >
            <Icon name="inbox" />
          </button>
          <button
            type="button"
            data-deck="tab-close"
            className="deck-tab-action"
            aria-label={strings.closeOpenTab(tab.title)}
            title={strings.closeOpenTab(tab.title)}
            onClick={() => onAction(tab, 'close')}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
      {tabs.length > maxRows ? (
        <p data-deck="result-more">
          {strings.moreResults(tabs.length - maxRows)}
        </p>
      ) : null}
    </div>
  );
}
