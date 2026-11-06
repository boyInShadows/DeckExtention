import { useState } from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import { GOOGLE_SUGGESTIONS_PERMISSION } from './googleSuggestionPolicy';
import { useGoogleAccess } from './useGoogleSuggestions';

async function changeGoogleAccess(shouldEnable: boolean): Promise<void> {
  const granted = shouldEnable
    ? await chrome.permissions.request(GOOGLE_SUGGESTIONS_PERMISSION)
    : await chrome.permissions.remove(GOOGLE_SUGGESTIONS_PERMISSION);
  if (!granted)
    throw new Error(
      shouldEnable
        ? strings.googleSuggestionsDeclined
        : strings.googleSuggestionsRevokeFailed,
    );
}

export function GoogleSuggestionsSetting({
  onError,
}: {
  onError: (error: unknown) => void;
}) {
  const access = useGoogleAccess();
  const [isPending, setIsPending] = useState(false);
  const change = async (shouldEnable: boolean) => {
    if (isPending) return;
    setIsPending(true);
    try {
      await changeGoogleAccess(shouldEnable);
    } catch (error) {
      onError(error);
    } finally {
      setIsPending(false);
    }
  };
  return (
    <div data-deck="google-suggestions-setting">
      <label className="deck-settings__toggle">
        {strings.googleSuggestions}
        <input
          type="checkbox"
          checked={access === 'on'}
          disabled={isPending}
          onChange={(event) => void change(event.currentTarget.checked)}
        />
      </label>
      <p>{strings.googleSuggestionsReason}</p>
    </div>
  );
}
