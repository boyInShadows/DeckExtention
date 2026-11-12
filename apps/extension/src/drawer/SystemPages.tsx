import { panelStrings as strings } from '../i18n/panelStrings';
import { Icon } from '../newtab/Icon';
import { workspaceSections } from '../newtab/sectionNavModel';
import { TRASH_PAGE_ID } from './drawerModel';

export function SystemPages({
  selectedId,
  linksPageId,
  inboxCount,
  sessionCount,
  selectPage,
}: {
  selectedId: string | null;
  linksPageId: string;
  inboxCount: number;
  sessionCount: number;
  selectPage: (id: string) => Promise<void>;
}) {
  const pages = [
    ...workspaceSections(linksPageId).map((section) => ({
      ...section,
      count:
        section.icon === 'inbox'
          ? inboxCount
          : section.icon === 'sessions'
            ? sessionCount
            : 0,
    })),
    {
      id: TRASH_PAGE_ID,
      label: strings.trash,
      icon: 'trash' as const,
      count: 0,
    },
  ];
  return (
    <nav
      data-deck="drawer-sections"
      className="deck-pages__sections"
      aria-label={strings.pages}
    >
      {pages.map(({ id, label, icon, count }) => (
        <button
          key={icon}
          type="button"
          data-deck={icon === 'links' ? 'links-page' : 'page'}
          data-system={icon !== 'links' || undefined}
          aria-label={label}
          aria-current={
            icon === 'links' && selectedId === id ? 'page' : undefined
          }
          onClick={() => void selectPage(id)}
          data-selected={(icon !== 'links' && selectedId === id) || undefined}
        >
          <Icon name={icon} />
          <span className="deck-pages__label">{label}</span>
          {count ? <small>{count}</small> : null}
        </button>
      ))}
    </nav>
  );
}
