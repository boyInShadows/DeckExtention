import { strings } from '../i18n/strings';

export type ActionId =
  | 'blur'
  | 'theme-night'
  | 'theme-day'
  | 'theme-system'
  | 'export'
  | 'import'
  | 'settings'
  | 'new-page'
  | 'stash';

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
    { id: 'stash', command: '>stash', label: strings.actionStash },
  ];
