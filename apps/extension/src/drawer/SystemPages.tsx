import { panelStrings as strings } from '../i18n/panelStrings';
import { Icon } from '../newtab/Icon';
import { SESSIONS_PAGE_ID } from '../sessions/constants';
import { TASKS_PAGE_ID } from '../tasks/constants';
import { INBOX_PAGE_ID, TRASH_PAGE_ID } from './drawerModel';

export function SystemPages({
  selectedId,
  inboxCount,
  sessionCount,
  selectPage,
}: {
  selectedId: string | null;
  inboxCount: number;
  sessionCount: number;
  selectPage: (id: string) => Promise<void>;
}) {
  const pages = [
    {
      id: INBOX_PAGE_ID,
      label: strings.inbox,
      icon: 'inbox' as const,
      count: inboxCount,
    },
    {
      id: SESSIONS_PAGE_ID,
      label: strings.sessions,
      icon: 'sessions' as const,
      count: sessionCount,
    },
    {
      id: TASKS_PAGE_ID,
      label: strings.tasks,
      icon: 'tasks' as const,
      count: 0,
    },
    {
      id: TRASH_PAGE_ID,
      label: strings.trash,
      icon: 'trash' as const,
      count: 0,
    },
  ];
  return (
    <>
      {pages.map(({ id, label, icon, count }) => (
        <button
          key={id}
          type="button"
          data-deck="page"
          data-system
          aria-label={label}
          onClick={() => void selectPage(id)}
          data-selected={selectedId === id || undefined}
        >
          <Icon name={icon} />
          <span className="deck-pages__label">{label}</span>
          {count ? <small>{count}</small> : null}
        </button>
      ))}
    </>
  );
}
