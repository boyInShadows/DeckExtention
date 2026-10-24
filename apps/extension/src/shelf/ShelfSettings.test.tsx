// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import {
  SETTINGS_DEFAULTS,
  type Deck,
  type Page,
  type Settings,
} from 'deck-schema';
import type { DeckRepository } from '../storage/repository';
import SettingsPanel from '../newtab/SettingsPanel';
import { render, click } from '../testing/render';

// The settings queue is real; unrelated panels and backup I/O have their own suites.
vi.mock('../storage/backup', () => ({
  BackupService: class {
    listSnapshots = async () => [];
  },
}));
vi.mock('../storage/database', () => ({
  openDeckDatabase: () => new Promise(() => undefined),
}));
vi.mock('../newtab/KeymapEditor', () => ({ KeymapEditor: () => null }));
vi.mock('../newtab/QuickSavePermission', () => ({
  QuickSavePermission: () => null,
}));
vi.mock('../newtab/GrantedAccess', () => ({ GrantedAccess: () => null }));
vi.mock('../newtab/BookmarkImport', () => ({ BookmarkImport: () => null }));
afterEach(() => vi.unstubAllGlobals());

const page: Page = {
  id: 'page_shelf',
  title: 'Work',
  order: 'a0',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const first: Deck = {
  ...page,
  id: 'deck_first',
  pageId: page.id,
  title: 'Reading',
  kind: 'normal',
  color: null,
  isCollapsed: false,
};

it('merges rapid Shelf choices and preserves them when the Shelf is turned off', async () => {
  vi.stubGlobal('chrome', { storage: { local: { get: async () => ({}) } } });
  const onChange = vi
    .fn<(settings: Settings) => Promise<void>>()
    .mockResolvedValue(undefined);
  const view = await render(
    <SettingsPanel
      settings={{ ...SETTINGS_DEFAULTS, showShelf: true }}
      pages={[page]}
      decks={[first, { ...first, id: 'deck_other', title: 'Research' }]}
      repository={{} as DeckRepository}
      onChange={onChange}
      onClose={vi.fn()}
      onDataChange={vi.fn()}
      notify={vi.fn()}
    />,
  );
  try {
    await view.act(() => {
      for (const choice of view.getAll('[data-deck="shelf-choice"]'))
        click(choice);
    });
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        ...SETTINGS_DEFAULTS,
        showShelf: true,
        shelfDeckIds: ['deck_first', 'deck_other'],
      }),
    );
    await view.act(() => click(view.get('[data-deck="shelf-enabled"]')));
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        ...SETTINGS_DEFAULTS,
        showShelf: false,
        shelfDeckIds: ['deck_first', 'deck_other'],
      }),
    );
  } finally {
    view.unmount();
  }
});
