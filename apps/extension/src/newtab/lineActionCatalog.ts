import { panelStrings as strings } from '../i18n/panelStrings';

export type ActionId =
  | 'blur'
  | 'theme-night'
  | 'theme-day'
  | 'theme-system'
  | 'export'
  | 'import'
  | 'settings'
  | 'new-page'
  | 'new-deck'
  | 'stash'
  | 'tabs';

export const LINE_ACTIONS: { id: ActionId; command: string; label: string }[] =
  [
    { id: 'blur', command: '>blur', label: strings.actionBlur },
    {
      id: 'theme-night',
      command: '>theme night',
      label: strings.actionThemeNight,
    },
    { id: 'theme-day', command: '>theme day', label: strings.actionThemeDay },
    {
      id: 'theme-system',
      command: '>theme system',
      label: strings.actionThemeSystem,
    },
    { id: 'export', command: '>export', label: strings.actionExport },
    { id: 'import', command: '>import', label: strings.actionImport },
    { id: 'settings', command: '>settings', label: strings.actionSettings },
    { id: 'new-page', command: '>new page', label: strings.actionNewPage },
    { id: 'new-deck', command: '>new deck', label: strings.actionNewDeck },
    { id: 'stash', command: '>stash', label: strings.actionStash },
    { id: 'tabs', command: '>tabs', label: strings.actionTabs },
  ];

export function filterLineActions(query: string, isCommand: boolean) {
  if (!query || query[0] === '?') return [];
  const lower = query.toLowerCase();
  return LINE_ACTIONS.filter(({ command, label }) =>
    isCommand
      ? `${command} ${label}`.toLowerCase().includes(lower) ||
        lower.startsWith(command)
      : label.toLowerCase().includes(lower),
  );
}
