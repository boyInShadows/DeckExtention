import { z } from 'zod';
import { panelStrings as strings } from '../i18n/panelStrings';
import type { NoticeInput } from './ToastStack';

const HINT_KEY = 'deck:first-run-hint';
const HintStateSchema = z.literal('shown').nullable();

export function firstRunHint(
  openHelp: () => void,
): Promise<NoticeInput | null> {
  return navigator.locks.request<NoticeInput | null>(HINT_KEY, () => {
    if (HintStateSchema.parse(localStorage.getItem(HINT_KEY)) === 'shown')
      return null;
    localStorage.setItem(HINT_KEY, 'shown');
    return {
      source: 'shortcut-hint',
      kind: 'info',
      text: strings.firstRunHint,
      action: { label: strings.showShortcuts, run: openHelp },
    };
  });
}
