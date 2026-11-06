import { panelStrings as strings } from '../i18n/panelStrings';

export function GoogleSuggestionsSetting({
  isEnabled,
  onChange,
}: {
  isEnabled: boolean;
  onChange: (isEnabled: boolean) => void;
}) {
  return (
    <div data-deck="google-suggestions-setting">
      <label className="deck-settings__toggle">
        {strings.googleSuggestions}
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
      </label>
      <p>{strings.googleSuggestionsReason}</p>
    </div>
  );
}
