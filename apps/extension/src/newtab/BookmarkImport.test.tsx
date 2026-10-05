// @vitest-environment happy-dom
import type { Card, Deck, Page } from 'deck-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { panelStrings as strings } from '../i18n/panelStrings';
import type { ChromeBookmarkNode } from '../import/bookmarkTree';
import type { BackupService } from '../storage/backup';
import type { DeckRepository } from '../storage/repository';
import { click, render, trusted, type RenderResult } from '../testing/render';
import { BookmarkImport } from './BookmarkImport';

const NOW = 1_800_000_000_000;
const BOOKMARKS_PERMISSION = { permissions: ['bookmarks'] };
const WORK_URL = 'https://work.example.com/';
const NEWS_URL = 'https://news.example.com/';

const CHROME_TREE: ChromeBookmarkNode[] = [
  {
    title: '',
    children: [
      {
        title: 'Bookmarks bar',
        children: [
          {
            title: 'Work',
            children: [
              { title: 'Work', url: WORK_URL },
              { title: 'News', url: NEWS_URL },
            ],
          },
        ],
      },
    ],
  },
];

const NETSCAPE_FILE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
  <DL><p>
    <DT><H3>Reading</H3>
    <DL><p>
      <DT><A HREF="${NEWS_URL}">News</A>
    </DL><p>
  </DL><p>
</DL><p>`;

function existingCard(url: string): Card {
  return {
    id: 'card_existing',
    deckId: 'deck_existing',
    url,
    title: 'Existing',
    hostname: new URL(url).hostname,
    order: 'a0',
    pinned: false,
    lastOpenedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

interface ImportBatch {
  pages?: Page[];
  decks?: Deck[];
  cards?: Card[];
}

/** The item at `index`, failing the test loudly when it is missing. */
function nth<T>(items: readonly T[], index = 0): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Expected an item at ${index}`);
  return item;
}

function createFakes(cards: Card[] = []) {
  const repository = {
    listPages: vi.fn(() => Promise.resolve([])),
    listDecks: vi.fn(() => Promise.resolve([])),
    listCards: vi.fn(() => Promise.resolve(cards)),
    upsertMany: vi.fn((_batch: ImportBatch) => Promise.resolve()),
  };
  const backups = { createSnapshot: vi.fn(() => Promise.resolve()) };
  const permissions = {
    contains: vi.fn(() => Promise.resolve(false)),
    request: vi.fn(() => Promise.resolve(true)),
    remove: vi.fn(() => Promise.resolve(true)),
  };
  const bookmarks = { getTree: vi.fn(() => Promise.resolve(CHROME_TREE)) };
  vi.stubGlobal('chrome', { permissions, bookmarks });
  return { repository, backups, permissions, bookmarks };
}

type Fakes = ReturnType<typeof createFakes>;

interface Mounted {
  view: RenderResult;
  onImported: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
}

async function mount(fakes: Fakes): Promise<Mounted> {
  const onImported = vi.fn();
  const onError = vi.fn();
  const view = await render(
    <BookmarkImport
      repository={fakes.repository as unknown as DeckRepository}
      backups={fakes.backups as unknown as BackupService}
      onImported={onImported}
      onError={onError}
    />,
  );
  await settle(view);
  return { view, onImported, onError };
}

async function settle(view: RenderResult): Promise<void> {
  await view.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function clickAndSettle(view: RenderResult, text: string) {
  await view.act(() => click(view.getByText(text)));
  await settle(view);
}

function fileInput(view: RenderResult): HTMLInputElement {
  return view.get<HTMLInputElement>('input[type="file"]');
}

async function chooseFile(view: RenderResult, file: File | null) {
  const input = fileInput(view);
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: file ? [file] : [],
  });
  await view.act(() => {
    input.dispatchEvent(trusted(new Event('change', { bubbles: true })));
  });
  await settle(view);
}

function statusText(view: RenderResult): string[] {
  return view.getAll('[role="status"]').map((node) => node.textContent ?? '');
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('BookmarkImport - access', () => {
  it('explains the bookmarks permission and offers Revoke only once granted', async () => {
    const fakes = createFakes();
    const { view } = await mount(fakes);
    expect(fakes.permissions.contains).toHaveBeenCalledWith(
      BOOKMARKS_PERMISSION,
    );
    expect(view.container.textContent).toContain(strings.bookmarksReason);
    expect(view.container.textContent).not.toContain(strings.revokeAccess);
    view.unmount();

    fakes.permissions.contains.mockResolvedValue(true);
    const { view: granted } = await mount(fakes);
    expect(granted.getByText(strings.revokeAccess)).toBeTruthy();
    granted.unmount();
  });

  it('gives access back, hiding Revoke only when Chrome removed it', async () => {
    const fakes = createFakes();
    fakes.permissions.contains.mockResolvedValue(true);
    fakes.permissions.remove.mockResolvedValueOnce(false);
    const { view } = await mount(fakes);

    await clickAndSettle(view, strings.revokeAccess);
    expect(fakes.permissions.remove).toHaveBeenCalledWith(BOOKMARKS_PERMISSION);
    expect(view.getByText(strings.revokeAccess)).toBeTruthy();

    await clickAndSettle(view, strings.revokeAccess);
    expect(view.container.textContent).not.toContain(strings.revokeAccess);
    view.unmount();
  });

  it('reports permission errors from the check, the request and the revoke', async () => {
    const fakes = createFakes();
    const checkError = new Error('check');
    const requestError = new Error('request');
    const removeError = new Error('remove');
    fakes.permissions.contains.mockRejectedValueOnce(checkError);
    const { view, onError } = await mount(fakes);
    expect(onError).toHaveBeenCalledWith(checkError);
    view.unmount();

    fakes.permissions.contains.mockResolvedValue(true);
    fakes.permissions.request.mockRejectedValueOnce(requestError);
    fakes.permissions.remove.mockRejectedValueOnce(removeError);
    const second = await mount(fakes);
    await clickAndSettle(second.view, strings.importChromeBookmarks);
    expect(second.onError).toHaveBeenCalledWith(requestError);
    await clickAndSettle(second.view, strings.revokeAccess);
    expect(second.onError).toHaveBeenLastCalledWith(removeError);
    expect(second.view.getByText(strings.revokeAccess)).toBeTruthy();
    second.view.unmount();
  });
});

describe('BookmarkImport - from Chrome', () => {
  it('says why nothing happened when the user declines access', async () => {
    const fakes = createFakes();
    fakes.permissions.request.mockResolvedValue(false);
    const { view } = await mount(fakes);
    await clickAndSettle(view, strings.importChromeBookmarks);

    expect(fakes.permissions.request).toHaveBeenCalledWith(
      BOOKMARKS_PERMISSION,
    );
    expect(fakes.bookmarks.getTree).not.toHaveBeenCalled();
    expect(statusText(view)).toEqual([strings.bookmarksDeclined]);
    view.unmount();
  });

  it('previews the plan and writes nothing until confirmed', async () => {
    const fakes = createFakes();
    const { view, onImported } = await mount(fakes);
    await clickAndSettle(view, strings.importChromeBookmarks);

    expect(view.getByText(strings.revokeAccess)).toBeTruthy();
    const preview = view.get('[data-deck="import-preview"]').textContent ?? '';
    expect(preview).toContain('2 links');
    expect(fakes.backups.createSnapshot).not.toHaveBeenCalled();
    expect(fakes.repository.upsertMany).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    view.unmount();
  });

  it('snapshots first, then imports and reports the link count', async () => {
    const fakes = createFakes();
    const { view, onImported } = await mount(fakes);
    await clickAndSettle(view, strings.importChromeBookmarks);
    await clickAndSettle(view, strings.importConfirmButton);

    const snapshotOrder = nth(
      fakes.backups.createSnapshot.mock.invocationCallOrder,
    );
    const firstWrite = nth(
      fakes.repository.upsertMany.mock.invocationCallOrder,
    );
    expect(snapshotOrder).toBeLessThan(firstWrite);
    const written = fakes.repository.upsertMany.mock.calls.flatMap(
      ([batch]) => batch.cards ?? [],
    );
    expect(written.map(({ url }) => url).toSorted()).toEqual(
      [NEWS_URL, WORK_URL].toSorted(),
    );
    expect(statusText(view)).toEqual([strings.importDone(2)]);
    expect(onImported).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('shows progress and locks the controls while importing', async () => {
    const fakes = createFakes();
    let finishWrite: () => void = () => undefined;
    fakes.repository.upsertMany.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const { view } = await mount(fakes);
    await clickAndSettle(view, strings.importChromeBookmarks);
    await clickAndSettle(view, strings.importConfirmButton);

    const progress = view.get<HTMLProgressElement>(
      '[data-deck="import-progress"] progress',
    );
    expect(Number(progress.getAttribute('max'))).toBeGreaterThan(0);
    const controls = view.getAll<HTMLButtonElement | HTMLInputElement>(
      'button, input',
    );
    expect(controls.every((control) => control.disabled)).toBe(true);

    fakes.repository.upsertMany.mockResolvedValue(undefined);
    await view.act(() => finishWrite());
    await settle(view);
    expect(statusText(view)).toEqual([strings.importDone(2)]);
    view.unmount();
  });

  it('returns to idle on cancel', async () => {
    const fakes = createFakes();
    const { view } = await mount(fakes);
    await clickAndSettle(view, strings.importChromeBookmarks);
    await clickAndSettle(view, strings.cancel);
    expect(view.query('[data-deck="import-preview"]')).toBeNull();
    expect(fakes.repository.upsertMany).not.toHaveBeenCalled();
    view.unmount();
  });

  it('says there is nothing new when every link is already saved', async () => {
    const fakes = createFakes([existingCard(WORK_URL)]);
    fakes.bookmarks.getTree.mockResolvedValue([
      {
        title: '',
        children: [
          {
            title: 'Bookmarks bar',
            children: [{ title: 'Work', url: WORK_URL }],
          },
        ],
      },
    ]);
    const { view } = await mount(fakes);
    await clickAndSettle(view, strings.importChromeBookmarks);
    expect(statusText(view)).toEqual([strings.importNothingNew(1)]);
    expect(view.query('[data-deck="import-preview"]')).toBeNull();
    view.unmount();
  });

  it('reports a failed import, refreshes the caller and allows a retry', async () => {
    const fakes = createFakes();
    const snapshotError = new Error('snapshot failed');
    fakes.backups.createSnapshot.mockRejectedValueOnce(snapshotError);
    const { view, onError, onImported } = await mount(fakes);
    await clickAndSettle(view, strings.importChromeBookmarks);
    await clickAndSettle(view, strings.importConfirmButton);

    expect(onError).toHaveBeenCalledWith(snapshotError);
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(fakes.repository.upsertMany).not.toHaveBeenCalled();
    expect(view.query('[data-deck="import-preview"]')).toBeNull();
    const button = view.getByText<HTMLButtonElement>(
      strings.importChromeBookmarks,
    );
    expect(button.disabled).toBe(false);
    view.unmount();
  });
});

describe('BookmarkImport - from a file', () => {
  it('previews an exported bookmarks file and clears the picker', async () => {
    const fakes = createFakes();
    const { view } = await mount(fakes);
    await chooseFile(
      view,
      new File([NETSCAPE_FILE], 'bookmarks.html', { type: 'text/html' }),
    );
    const preview = view.get('[data-deck="import-preview"]').textContent ?? '';
    expect(preview).toContain('1 link');
    expect(fileInput(view).value).toBe('');
    expect(fakes.permissions.request).not.toHaveBeenCalled();
    view.unmount();
  });

  it('does nothing when the picker is dismissed', async () => {
    const fakes = createFakes();
    const { view, onError } = await mount(fakes);
    await chooseFile(view, null);
    expect(view.query('[data-deck="import-preview"]')).toBeNull();
    expect(fakes.repository.listCards).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    view.unmount();
  });

  it('reports a file that cannot be read', async () => {
    const fakes = createFakes();
    const readError = new Error('unreadable');
    const file = new File(['x'], 'broken.html');
    vi.spyOn(file, 'text').mockRejectedValue(readError);
    const { view, onError } = await mount(fakes);
    await chooseFile(view, file);
    expect(onError).toHaveBeenCalledWith(readError);
    expect(view.query('[data-deck="import-preview"]')).toBeNull();
    view.unmount();
  });
});
