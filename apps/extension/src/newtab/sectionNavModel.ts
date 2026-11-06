import { strings } from '../i18n/strings';

export function workspaceSections(linksPageId: string) {
  return [
    { id: linksPageId, label: strings.links, icon: 'links' as const },
    { id: 'tasks', label: strings.tasks, icon: 'tasks' as const },
    { id: 'inbox', label: strings.inbox, icon: 'inbox' as const },
    { id: 'sessions', label: strings.sessions, icon: 'sessions' as const },
  ];
}
