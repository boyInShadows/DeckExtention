// @vitest-environment happy-dom
import { SETTINGS_DEFAULTS, type Settings, type Snapshot } from 'deck-schema';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

import { panelStrings as strings } from '../i18n/panelStrings';
import type { DeckRepository } from '../storage/repository';
import {
  click,
  keyDown,
  render,
  trusted,
  type,
  type RenderResult,
} from '../testing/render';
import SettingsPanel from './SettingsPanel';

/*
 * The panel builds its own BackupService on IndexedDB; the service has its
 * own suite (storage.test.ts). Here it is replaced by a fake whose answers
 * each test sets, so the panel's handling of every outcome is observable.
 */
const backups = vi.hoisted(() => ({
  listSnapshots: vi.fn<() => Promise<Snapshot[]>>(),
  exportData: vi.fn<() => Promise<{ json: string }>>(),
  previewImport: vi.fn<(value: unknown, mode: string) => Promise<unknown>>(),
  importData: vi.fn<(value: unknown, mode: string) => Promise<unknown>>(),
  restoreSnapshot: vi.fn<(id: string) => Promise<void>>(),
  createSnapshot: vi.fn<() => Promise<void>>(),
}));
const processWallpaper = vi.hoisted(() =>
  vi.fn<(blob: Blob) => Promise<{ gradient: string; luminance: number }>>(),
);

vi.mock('../storage/backup', () => ({
  BackupService: class {
    listSnapshots = backups.listSnapshots;
    exportData = backups.exportData;
    previewImport = backups.previewImport;
    importData = backups.importData;
    restoreSnapshot = backups.restoreSnapshot;
    createSnapshot = backups.createSnapshot;
  },
}));
vi.mock('../storage/database', () => ({
  openDeckDatabase: () => new Promise(() => undefined),
}));
vi.mock('../wallpaper/processWallpaper', () => ({ processWallpaper }));

const NOW = 1_800_000_000_000;
const SNAPSHOT: Snapshot = {
  id: 'snap_1',
  ts: NOW,
  schemaVersion: 1,
  blob: '{}',
};
const EXPORT_JSON = '{"schemaVersion":1}';
const BLOB_URL = 'blob:deck-export';
const BOOKMARK_TREE = [
  {
    title: '',
    children: [
      {
        title: 'Bookmarks bar',
        children: [{ title: 'Docs', url: 'https://docs.example.com/' }],
      },
    ],
  },
];

/** The item at `index`, failing the test loudly when it is missing. */
function nth<T>(items: readonly T[], index = 0): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Expected an item at ${index}`);
  return item;
}

function createRepository() {
  return {
    setWallpaperBlob: vi.fn<(key: string, blob: Blob) => Promise<void>>(() =>
      Promise.resolve(),
    ),
    listPages: vi.fn(() => Promise.resolve([])),
    listDecks: vi.fn(() => Promise.resolve([])),
    listCards: vi.fn(() => Promise.resolve([])),
    upsertMany: vi.fn(() => Promise.resolve()),
  };
}

function stubChrome() {
  const chromeFake = {
    permissions: {
      contains: vi.fn(() => Promise.resolve(false)),
      getAll: vi.fn(() => Promise.resolve({ permissions: [] })),
      request: vi.fn(() => Promise.resolve(true)),
      remove: vi.fn(() => Promise.resolve(true)),
    },
    tabs: { create: vi.fn(() => Promise.resolve()) },
    bookmarks: { getTree: vi.fn(() => Promise.resolve(BOOKMARK_TREE)) },
  };
  vi.stubGlobal('chrome', chromeFake);
  return chromeFake;
}

interface Mounted {
  view: RenderResult;
  repository: ReturnType<typeof createRepository>;
  onChange: ReturnType<typeof vi.fn<(settings: Settings) => Promise<void>>>;
  onDataChange: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
}

async function mount(settings: Settings = SETTINGS_DEFAULTS): Promise<Mounted> {
  const repository = createRepository();
  const onChange = vi.fn<(next: Settings) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const onDataChange = vi.fn();
  const onClose = vi.fn();
  const view = await render(
    <SettingsPanel
      settings={settings}
      repository={repository as unknown as DeckRepository}
      onChange={onChange}
      onDataChange={onDataChange}
      onClose={onClose}
    />,
  );
  await settle(view);
  return { view, repository, onChange, onDataChange, onClose };
}

async function settle(view: RenderResult): Promise<void> {
  await view.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function clickAndSettle(view: RenderResult, element: Element) {
  await view.act(() => click(element));
  await settle(view);
}

/** The control inside the <label> whose text starts with `text`. */
function control<T extends Element>(view: RenderResult, text: string): T {
  const label = view
    .getAll('label')
    .find((node) => node.textContent?.trim().startsWith(text));
  const found = label?.querySelector<T>('input, select, textarea');
  if (!found) throw new Error(`No control labelled ${text}`);
  return found;
}

async function change(view: RenderResult, element: Element) {
  await view.act(() => {
    element.dispatchEvent(trusted(new Event('change', { bubbles: true })));
  });
  await settle(view);
}

async function chooseFile(
  view: RenderResult,
  labelText: string,
  file: File | null,
) {
  const input = control<HTMLInputElement>(view, labelText);
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: file ? [file] : [],
  });
  await change(view, input);
}

function alertText(view: RenderResult): string | null {
  return view.query('[role="alert"]')?.textContent ?? null;
}

function buttonWithText(view: RenderResult, text: string): HTMLButtonElement {
  const found = view
    .getAll<HTMLButtonElement>('button')
    .find((button) => button.textContent?.trim().startsWith(text));
  if (!found) throw new Error(`No button ${text}`);
  return found;
}

let reload: Mock<() => void>;

beforeEach(() => {
  Object.values(backups).forEach((mock) => mock.mockReset());
  backups.listSnapshots.mockResolvedValue([]);
  backups.createSnapshot.mockResolvedValue(undefined);
  processWallpaper.mockReset();
  stubChrome();
  reload = vi.fn<() => void>();
  vi.spyOn(window.location, 'reload').mockImplementation(reload);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('SettingsPanel - appearance', () => {
  it('closes from the header button', async () => {
    const { view, onClose } = await mount();
    await clickAndSettle(view, view.getByLabel(strings.closeSettings));
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('saves theme, name, toggles and dim as whole new settings', async () => {
    const { view, onChange } = await mount();
    const theme = control<HTMLSelectElement>(view, strings.theme);
    theme.value = 'day';
    await change(view, theme);
    await view.act(() =>
      type(control<HTMLInputElement>(view, strings.yourName), 'Kasra'),
    );
    await view.act(() =>
      click(control<HTMLInputElement>(view, strings.showSeconds)),
    );
    await view.act(() =>
      click(control<HTMLInputElement>(view, strings.privacyBlur)),
    );
    await view.act(() =>
      click(control<HTMLInputElement>(view, strings.spaceOpensDrawer)),
    );
    const dim = control<HTMLInputElement>(view, strings.wallpaperDim);
    await view.act(() => type(dim, '40'));

    const changes = onChange.mock.calls.map(([next]) => next);
    expect(changes).toEqual([
      { ...SETTINGS_DEFAULTS, theme: 'day' },
      { ...SETTINGS_DEFAULTS, ownerName: 'Kasra' },
      { ...SETTINGS_DEFAULTS, showSeconds: true },
      { ...SETTINGS_DEFAULTS, isBlurred: true },
      { ...SETTINGS_DEFAULTS, canSpaceOpenDrawer: false },
      { ...SETTINGS_DEFAULTS, wallpaperDim: 40 },
    ]);
    expect(SETTINGS_DEFAULTS.theme).toBe('night');
    view.unmount();
  });

  it('clears or recolours the wallpaper and drops its stored palette', async () => {
    const withFile: Settings = {
      ...SETTINGS_DEFAULTS,
      wallpaper: { kind: 'file', blobKey: 'old' },
      wallpaperGradient: 'linear-gradient(red, blue)',
      wallpaperLuminance: 0.5,
    };
    const { view, onChange } = await mount(withFile);
    await clickAndSettle(view, buttonWithText(view, strings.wallpaperNone));
    await clickAndSettle(view, buttonWithText(view, strings.wallpaperColor));
    expect(onChange.mock.calls.map(([next]) => next)).toEqual([
      {
        ...withFile,
        wallpaper: { kind: 'none' },
        wallpaperGradient: null,
        wallpaperLuminance: null,
      },
      {
        ...withFile,
        wallpaper: { kind: 'color', token: 'canvas-raised' },
        wallpaperGradient: null,
        wallpaperLuminance: null,
      },
    ]);
    view.unmount();
  });

  it('stores a chosen wallpaper file with its palette', async () => {
    processWallpaper.mockResolvedValue({
      gradient: 'linear-gradient(black, white)',
      luminance: 0.2,
    });
    const { view, onChange, repository } = await mount();
    const file = new File(['image'], 'wall.png', { type: 'image/png' });
    await chooseFile(view, strings.wallpaperLocal, file);

    expect(processWallpaper).toHaveBeenCalledWith(file);
    const [blobKey, stored] = nth(repository.setWallpaperBlob.mock.calls);
    expect(stored).toBe(file);
    expect(onChange).toHaveBeenCalledWith({
      ...SETTINGS_DEFAULTS,
      wallpaper: { kind: 'file', blobKey },
      wallpaperGradient: 'linear-gradient(black, white)',
      wallpaperLuminance: 0.2,
    });
    expect(alertText(view)).toBeNull();
    view.unmount();
  });

  it('ignores a dismissed wallpaper picker', async () => {
    const { view, onChange } = await mount();
    await chooseFile(view, strings.wallpaperLocal, null);
    expect(processWallpaper).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    view.unmount();
  });

  it('shows why a wallpaper failed, and clears it after a success', async () => {
    const { view, repository } = await mount();
    const file = new File(['image'], 'wall.png', { type: 'image/png' });
    processWallpaper.mockRejectedValueOnce(new Error('cannot decode'));
    await chooseFile(view, strings.wallpaperLocal, file);
    expect(alertText(view)).toBe(`${strings.updateFailed} cannot decode`);

    processWallpaper.mockResolvedValue({ gradient: 'none', luminance: 0 });
    repository.setWallpaperBlob.mockRejectedValueOnce('quota');
    await chooseFile(view, strings.wallpaperLocal, file);
    expect(alertText(view)).toBe(`${strings.updateFailed} quota`);

    await chooseFile(view, strings.wallpaperLocal, file);
    expect(alertText(view)).toBeNull();
    view.unmount();
  });
});

describe('SettingsPanel - keys and advanced', () => {
  it('saves a rebound key and opens Chrome shortcut settings', async () => {
    const { view, onChange } = await mount();
    await view.act(() =>
      click(view.getByLabel(`${strings.keyLabels.next}: j`)),
    );
    await view.act(() => {
      keyDown(view.get('[data-recording]'), 'z');
    });
    expect(onChange).toHaveBeenCalledWith({
      ...SETTINGS_DEFAULTS,
      keymap: [{ action: 'next', chord: 'z' }],
    });

    await clickAndSettle(
      view,
      buttonWithText(view, strings.openShortcutSettings),
    );
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome://extensions/shortcuts',
    });
    view.unmount();
  });

  it('saves the search template and custom CSS', async () => {
    const { view, onChange } = await mount();
    await view.act(() =>
      type(
        control<HTMLInputElement>(view, strings.searchEngine),
        'https://duck.example/?q={query}',
      ),
    );
    await view.act(() =>
      type(control<HTMLTextAreaElement>(view, strings.customCss), 'a{}'),
    );
    expect(onChange.mock.calls.map(([next]) => next)).toEqual([
      {
        ...SETTINGS_DEFAULTS,
        searchUrlTemplate: 'https://duck.example/?q={query}',
      },
      { ...SETTINGS_DEFAULTS, customCss: 'a{}' },
    ]);
    view.unmount();
  });

  it('shows errors reported by the permission rows', async () => {
    vi.mocked(chrome.permissions.contains).mockRejectedValue(
      new Error('no permissions API'),
    );
    const { view } = await mount();
    expect(alertText(view)).toBe(`${strings.updateFailed} no permissions API`);
    view.unmount();
  });
});

describe('SettingsPanel - backups', () => {
  it('says when there are no snapshots yet', async () => {
    const { view } = await mount();
    expect(view.container.textContent).toContain(strings.noBackups);
    view.unmount();
  });

  it('shows a snapshot listing failure', async () => {
    backups.listSnapshots.mockRejectedValue(new Error('db closed'));
    const { view } = await mount();
    expect(alertText(view)).toBe(`${strings.updateFailed} db closed`);
    view.unmount();
  });

  it('restores a snapshot only after confirmation, then reloads', async () => {
    backups.listSnapshots.mockResolvedValue([SNAPSHOT]);
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const { view } = await mount();
    expect(view.container.textContent).not.toContain(strings.noBackups);
    const restore = buttonWithText(view, strings.restore);

    await clickAndSettle(view, restore);
    expect(confirm).toHaveBeenCalledWith(strings.restoreConfirm);
    expect(backups.restoreSnapshot).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    backups.restoreSnapshot.mockResolvedValue(undefined);
    await clickAndSettle(view, restore);
    expect(backups.restoreSnapshot).toHaveBeenCalledWith(SNAPSHOT.id);
    expect(reload).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('shows a failed restore and does not reload', async () => {
    backups.listSnapshots.mockResolvedValue([SNAPSHOT]);
    vi.stubGlobal('confirm', () => true);
    backups.restoreSnapshot.mockRejectedValue(new Error('corrupt snapshot'));
    const { view } = await mount();
    await clickAndSettle(view, buttonWithText(view, strings.restore));
    expect(alertText(view)).toBe(`${strings.updateFailed} corrupt snapshot`);
    expect(reload).not.toHaveBeenCalled();
    view.unmount();
  });

  it('downloads the export as a dated JSON file', async () => {
    backups.exportData.mockResolvedValue({ json: EXPORT_JSON });
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue(BLOB_URL);
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockReturnValue(undefined);
    const anchors: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchors.push(this);
    });
    const { view } = await mount();
    await clickAndSettle(view, buttonWithText(view, strings.exportData));

    const [blob] = nth(createObjectURL.mock.calls);
    if (!(blob instanceof Blob))
      throw new Error('Export did not create a Blob');
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe(EXPORT_JSON);
    expect(anchors).toHaveLength(1);
    expect(nth(anchors).href).toBe(BLOB_URL);
    expect(nth(anchors).download).toMatch(/^deck-\d{4}-\d{2}-\d{2}\.json$/);
    expect(revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
    view.unmount();
  });

  it('shows a failed export', async () => {
    backups.exportData.mockRejectedValue('no snapshot either');
    const { view } = await mount();
    await clickAndSettle(view, buttonWithText(view, strings.exportData));
    expect(alertText(view)).toBe(`${strings.updateFailed} no snapshot either`);
    view.unmount();
  });
});

describe('SettingsPanel - importing data', () => {
  const exportFile = () =>
    new File([EXPORT_JSON], 'deck.json', { type: 'application/json' });

  it('previews, then replaces data only after confirmation', async () => {
    backups.previewImport.mockResolvedValue({});
    backups.importData.mockResolvedValue({});
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const { view } = await mount();

    await chooseFile(view, strings.importData, exportFile());
    expect(backups.previewImport).toHaveBeenCalledWith(
      JSON.parse(EXPORT_JSON),
      'replace',
    );
    expect(confirm).toHaveBeenCalledWith(strings.importConfirm);
    expect(backups.importData).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await chooseFile(view, strings.importData, exportFile());
    expect(backups.importData).toHaveBeenCalledWith(
      JSON.parse(EXPORT_JSON),
      'replace',
    );
    expect(reload).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('ignores a dismissed import picker', async () => {
    const { view } = await mount();
    await chooseFile(view, strings.importData, null);
    expect(backups.previewImport).not.toHaveBeenCalled();
    view.unmount();
  });

  it('shows why a file could not be imported', async () => {
    const { view } = await mount();
    await chooseFile(
      view,
      strings.importData,
      new File(['not json'], 'deck.json'),
    );
    expect(alertText(view)).toMatch(new RegExp(`^${strings.updateFailed} `));
    expect(backups.previewImport).not.toHaveBeenCalled();

    backups.previewImport.mockRejectedValue('unsupported version');
    await chooseFile(view, strings.importData, exportFile());
    expect(alertText(view)).toBe(`${strings.updateFailed} unsupported version`);
    expect(reload).not.toHaveBeenCalled();
    view.unmount();
  });

  it('refreshes snapshots and the surface after a bookmark import', async () => {
    const { view, onDataChange } = await mount();
    expect(backups.listSnapshots).toHaveBeenCalledTimes(1);
    await clickAndSettle(
      view,
      buttonWithText(view, strings.importChromeBookmarks),
    );
    await clickAndSettle(view, view.get('[data-deck="import-preview"] button'));

    expect(backups.createSnapshot).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(backups.listSnapshots).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});
