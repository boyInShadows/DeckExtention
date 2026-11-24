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
  | 'tabs'
  | 'help'
  | 'keys'
  | 'shortcuts';

export const LINE_ACTIONS: { id: ActionId; command: string; label: string }[] =
  [
    {
      id: 'blur',
      command: '>blur',
      get label() {
        return strings.actionBlur;
      },
    },
    {
      id: 'theme-night',
      command: '>theme night',
      get label() {
        return strings.actionThemeNight;
      },
    },
    {
      id: 'theme-day',
      command: '>theme day',
      get label() {
        return strings.actionThemeDay;
      },
    },
    {
      id: 'theme-system',
      command: '>theme system',
      get label() {
        return strings.actionThemeSystem;
      },
    },
    {
      id: 'export',
      command: '>export',
      get label() {
        return strings.actionExport;
      },
    },
    {
      id: 'import',
      command: '>import',
      get label() {
        return strings.actionImport;
      },
    },
    {
      id: 'settings',
      command: '>settings',
      get label() {
        return strings.actionSettings;
      },
    },
    {
      id: 'new-page',
      command: '>new page',
      get label() {
        return strings.actionNewPage;
      },
    },
    {
      id: 'new-deck',
      command: '>new deck',
      get label() {
        return strings.actionNewDeck;
      },
    },
    {
      id: 'stash',
      command: '>stash',
      get label() {
        return strings.actionStash;
      },
    },
    {
      id: 'tabs',
      command: '>tabs',
      get label() {
        return strings.actionTabs;
      },
    },
    {
      id: 'help',
      command: '>help',
      get label() {
        return strings.keyboard;
      },
    },
    {
      id: 'keys',
      command: '>keys',
      get label() {
        return strings.keyboard;
      },
    },
    {
      id: 'shortcuts',
      command: '>shortcuts',
      get label() {
        return strings.keyboard;
      },
    },
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
