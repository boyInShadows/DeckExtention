import { useEffect, useState, type ChangeEvent } from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import {
  applyBookmarkPlan,
  type ImportProgress,
} from '../import/bookmarkImport';
import {
  planBookmarkImport,
  type BookmarkImportPlan,
} from '../import/bookmarkPlan';
import {
  fromChromeTree,
  parseNetscapeBookmarks,
  type BookmarkFolder,
} from '../import/bookmarkTree';
import type { BackupService } from '../storage/backup';
import type { DeckRepository } from '../storage/repository';

const BOOKMARKS_PERMISSION: chrome.permissions.Permissions = {
  permissions: ['bookmarks'],
};

type ImportState =
  | { step: 'idle' }
  | { step: 'preview'; tree: BookmarkFolder; plan: BookmarkImportPlan }
  | { step: 'importing'; progress: ImportProgress }
  | { step: 'done'; links: number };

interface BookmarkImportProps {
  repository: DeckRepository;
  backups: BackupService;
  onImported: () => void;
  onError: (error: unknown) => void;
}

/**
 * Settings › Import (FableTasks P2.S7). `bookmarks` is asked for here, at the
 * click, with its reason on screen - and can be given back right after.
 * Nothing is written until the preview is confirmed, and a snapshot is taken
 * first, so an import is always one restore away from undone.
 */
export function BookmarkImport({
  repository,
  backups,
  onImported,
  onError,
}: BookmarkImportProps) {
  const [state, setState] = useState<ImportState>({ step: 'idle' });
  const [isGranted, setIsGranted] = useState(false);
  const [notice, setNotice] = useState('');
  const isBusy = state.step === 'importing';

  useEffect(() => {
    chrome.permissions
      .contains(BOOKMARKS_PERMISSION)
      .then(setIsGranted, onError);
  }, [onError]);

  const plan = async (tree: BookmarkFolder) => {
    const [pages, decks, cards] = await Promise.all([
      repository.listPages(),
      repository.listDecks(),
      repository.listCards(),
    ]);
    return planBookmarkImport(
      tree,
      { pages, decks, cards },
      { now: Date.now(), createId: () => crypto.randomUUID() },
    );
  };

  const preview = async (tree: BookmarkFolder) => {
    const planned = await plan(tree);
    setNotice('');
    setState({ step: 'preview', tree, plan: planned });
  };

  const importFromChrome = async () => {
    try {
      // First await in the click: Chrome only prompts inside a user gesture.
      const isAllowed = await chrome.permissions.request(BOOKMARKS_PERMISSION);
      setIsGranted(isAllowed);
      if (!isAllowed) {
        setNotice(strings.bookmarksDeclined);
        return;
      }
      await preview(fromChromeTree(await chrome.bookmarks.getTree()));
    } catch (importError) {
      onError(importError);
    }
  };

  const importFromFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await preview(parseNetscapeBookmarks(await file.text()));
    } catch (importError) {
      onError(importError);
    } finally {
      input.value = '';
    }
  };

  const confirm = async (tree: BookmarkFolder) => {
    // Busy before the first await, so a second click cannot import twice.
    setState({ step: 'importing', progress: { done: 0, total: 0 } });
    try {
      await backups.createSnapshot();
      // Planned again: a link saved in another tab since the preview must
      // not come back as a duplicate.
      const planned = await plan(tree);
      await applyBookmarkPlan(repository, planned, (progress) =>
        setState({ step: 'importing', progress }),
      );
      setState({ step: 'done', links: planned.cards.length });
      onImported();
    } catch (importError) {
      setState({ step: 'idle' });
      onError(importError);
      onImported();
    }
  };

  const revoke = async () => {
    try {
      setIsGranted(!(await chrome.permissions.remove(BOOKMARKS_PERMISSION)));
    } catch (permissionError) {
      onError(permissionError);
    }
  };

  return (
    <div data-deck="bookmark-import">
      <p>
        <strong>{strings.bookmarks}</strong> {strings.bookmarksReason}
      </p>
      <button
        type="button"
        disabled={isBusy}
        onClick={() => void importFromChrome()}
      >
        {strings.importChromeBookmarks}
      </button>
      {isGranted ? (
        <button type="button" disabled={isBusy} onClick={() => void revoke()}>
          {strings.revokeAccess}
        </button>
      ) : null}
      <label>
        {strings.importBookmarksFile}
        <input
          type="file"
          accept="text/html,.html,.htm"
          disabled={isBusy}
          onChange={(event) => void importFromFile(event)}
        />
      </label>
      <ImportStatus
        state={state}
        onConfirm={(tree) => void confirm(tree)}
        onCancel={() => setState({ step: 'idle' })}
      />
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  );
}

function ImportStatus({
  state,
  onConfirm,
  onCancel,
}: {
  state: ImportState;
  onConfirm: (tree: BookmarkFolder) => void;
  onCancel: () => void;
}) {
  if (state.step === 'idle') return null;
  if (state.step === 'importing') {
    return (
      <label data-deck="import-progress">
        {strings.importing}
        <progress value={state.progress.done} max={state.progress.total} />
      </label>
    );
  }
  if (state.step === 'done')
    return <p role="status">{strings.importDone(state.links)}</p>;
  const { tree, plan } = state;
  if (plan.cards.length === 0)
    return (
      <p role="status">{strings.importNothingNew(plan.counts.duplicates)}</p>
    );
  return (
    <div data-deck="import-preview">
      <p role="status">{strings.importPreview(plan.counts)}</p>
      <button type="button" onClick={() => onConfirm(tree)}>
        {strings.importConfirmButton}
      </button>
      <button type="button" onClick={onCancel}>
        {strings.cancel}
      </button>
    </div>
  );
}
