import type { Deck, Page, Settings } from 'deck-schema';
import { panelStrings as strings } from '../i18n/panelStrings';
import { shelfDecks } from './shelfModel';
import './shelf.css';

export type SettingsChange =
  Partial<Settings> | ((current: Settings) => Partial<Settings>);

export function ShelfSettings({
  settings,
  pages,
  decks,
  update,
}: {
  settings: Settings;
  pages: Page[];
  decks: Deck[];
  update: (change: SettingsChange) => Promise<void>;
}) {
  const available = shelfDecks(pages, decks);
  return (
    <div data-deck="shelf-settings">
      <label className="deck-settings__toggle">
        <span>{strings.showShelf}</span>
        <input
          data-deck="shelf-enabled"
          className="deck-settings__checkbox"
          type="checkbox"
          checked={settings.showShelf}
          onChange={(event) =>
            void update({ showShelf: event.currentTarget.checked })
          }
        />
      </label>
      {settings.showShelf ? (
        <fieldset data-deck="shelf-picker" className="deck-shelf__picker">
          <legend>{strings.shelfDecks}</legend>
          {available.length ? (
            available.map((deck) => (
              <label key={deck.id} className="deck-settings__toggle">
                <span className="deck-blurrable">
                  {pages.find((page) => page.id === deck.pageId)?.title} /{' '}
                  {deck.title}
                </span>
                <input
                  className="deck-settings__checkbox"
                  type="checkbox"
                  data-deck="shelf-choice"
                  value={deck.id}
                  checked={settings.shelfDeckIds.includes(deck.id)}
                  onChange={(event) =>
                    void update((current) => ({
                      shelfDeckIds: event.currentTarget.checked
                        ? [...current.shelfDeckIds, deck.id]
                        : current.shelfDeckIds.filter((id) => id !== deck.id),
                    }))
                  }
                />
              </label>
            ))
          ) : (
            <p>{strings.shelfNoDecks}</p>
          )}
          <p data-deck="shelf-hint">{strings.shelfHint}</p>
        </fieldset>
      ) : null}
    </div>
  );
}
