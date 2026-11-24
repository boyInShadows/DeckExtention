import type { Settings } from 'deck-schema';
import { LANGUAGES } from 'deck-schema/constants';
import { panelStrings as strings } from '../i18n/panelStrings';

export function LanguageSetting({
  settings,
  update,
}: {
  settings: Pick<Settings, 'language'>;
  update: (change: Partial<Settings>) => Promise<void>;
}) {
  return (
    <label data-deck="language-setting">
      {strings.language}
      <select
        data-deck="language-select"
        value={settings.language}
        onChange={(event) =>
          void update({
            language: event.currentTarget.value as Settings['language'],
          })
        }
      >
        {LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {strings.languageNames[language]}
          </option>
        ))}
      </select>
    </label>
  );
}
