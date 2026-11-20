import { panelStrings as strings } from '../i18n/panelStrings';
import './focusProgress.css';

export function FocusProgress({ value }: { value: number }) {
  return (
    <progress
      data-deck="focus-progress"
      className="deck-focus-progress"
      aria-label={strings.focusProgress}
      value={value}
      max={1}
    />
  );
}
