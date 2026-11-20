import { panelStrings as strings } from '../i18n/panelStrings';
import type { NoticeInput } from '../newtab/ToastStack';
import type { FocusEntry } from './model';

const CHIME_VOLUME = 0.4;

export function showFocusCompletion(
  entry: FocusEntry,
  notify: (notice: NoticeInput) => void,
  openFocus: () => Promise<void> | void,
): void {
  const audio = new Audio(
    new URL('./completion-chime.wav', import.meta.url).href,
  );
  audio.volume = CHIME_VOLUME;
  const play = async () => {
    audio.currentTime = 0;
    await audio.play();
  };
  notify({
    source: 'focus',
    kind: 'info',
    text: strings.focusCompleted(entry.task?.title),
    action: { label: strings.focusView, run: openFocus },
    secondaryAction: { label: strings.focusPlaySound, run: play },
  });
  void play().catch(() => {
    notify({ kind: 'info', text: strings.focusSoundBlocked });
  });
}
