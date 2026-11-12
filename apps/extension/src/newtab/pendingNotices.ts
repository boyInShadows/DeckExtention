import {
  BACKUP_ERROR_KEY,
  BackgroundErrorSchema,
  CAPTURE_NOTICE_KEY,
  CaptureNoticeSchema,
  DRAWER_COMMAND_ERROR_KEY,
  SETTINGS_NOTICE_KEY,
} from 'deck-schema';
import { z } from 'zod';

import { panelStrings as strings } from '../i18n/panelStrings';
import type { NoticeInput } from './ToastStack';
import { STASH_NOTICE_KEY, STASH_PERMISSION_HASH } from '../sessions/constants';
import { StashNoticeSchema } from '../sessions/messages';
import { sendStashMessage, startStash } from '../sessions/stashActions';

const OlderSettingsErrorSchema = z
  .array(
    z.object({
      code: z.literal('unrecognized_keys'),
      keys: z.tuple([z.literal('showGoogleSuggestions')]),
      path: z.tuple([z.literal('settings')]),
    }),
  )
  .nonempty();
const RELOAD_DECK_ACTION = {
  label: strings.reloadDeck,
  run: () => chrome.runtime.reload(),
};

export function backupFailureNotice(message: string): NoticeInput {
  const failure: NoticeInput = {
    source: 'backup',
    kind: 'error',
    text: `${strings.backupFailed} ${message}`,
  };
  try {
    if (
      OlderSettingsErrorSchema.safeParse(JSON.parse(message) as unknown).success
    )
      return {
        ...failure,
        text: strings.backupReloadRequired,
        action: RELOAD_DECK_ACTION,
      };
  } catch {
    return failure;
  }
  return failure;
}

export function watchBackupNotices(
  notify: (notice: NoticeInput) => void,
  clear: () => void,
): () => void {
  let revision = 0;
  const replace = (value: unknown) => {
    clear();
    if (value === undefined) return;
    const result = BackgroundErrorSchema.safeParse(value);
    notify(
      backupFailureNotice(
        result.success ? result.data.message : result.error.message,
      ),
    );
  };
  const onChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== 'local' || !Object.hasOwn(changes, BACKUP_ERROR_KEY)) return;
    revision += 1;
    replace(changes[BACKUP_ERROR_KEY]?.newValue);
  };
  chrome.storage.onChanged.addListener(onChanged);
  const initialRevision = revision;
  void chrome.storage.local.get(BACKUP_ERROR_KEY).then(
    (items) => {
      if (revision === initialRevision) replace(items[BACKUP_ERROR_KEY]);
    },
    (error: unknown) => {
      if (revision === initialRevision)
        notify({ kind: 'error', text: String(error) });
    },
  );
  return () => {
    revision += 1;
    chrome.storage.onChanged.removeListener(onChanged);
  };
}

export async function readPendingNotices(
  notify: (notice: NoticeInput) => void,
): Promise<void> {
  if (location.hash === STASH_PERMISSION_HASH) {
    history.replaceState(null, '', location.pathname);
    await startStash(notify);
  }
  const items = await chrome.storage.local.get([
    CAPTURE_NOTICE_KEY,
    SETTINGS_NOTICE_KEY,
    DRAWER_COMMAND_ERROR_KEY,
    STASH_NOTICE_KEY,
  ]);
  const stash = StashNoticeSchema.safeParse(items[STASH_NOTICE_KEY]);
  if (stash.success)
    notify({
      kind: stash.data.kind,
      text: stash.data.message,
      ...(stash.data.deckId
        ? {
            action: {
              label: strings.undo,
              run: () => sendStashMessage(stash.data.deckId),
            },
          }
        : {}),
    });
  const notice = CaptureNoticeSchema.safeParse(items[CAPTURE_NOTICE_KEY]);
  const settingsNotice = CaptureNoticeSchema.safeParse(
    items[SETTINGS_NOTICE_KEY],
  );
  const drawerError = BackgroundErrorSchema.safeParse(
    items[DRAWER_COMMAND_ERROR_KEY],
  );
  if (notice.success)
    notify({ kind: notice.data.kind ?? 'error', text: notice.data.message });
  if (settingsNotice.success)
    notify({
      kind: settingsNotice.data.kind ?? 'error',
      text: settingsNotice.data.message,
    });
  if (drawerError.success)
    notify({
      kind: 'error',
      text: `${strings.drawerCommandFailed} ${drawerError.data.message}`,
    });
  const consumed = [
    ...(stash.success ? [STASH_NOTICE_KEY] : []),
    ...(notice.success ? [CAPTURE_NOTICE_KEY] : []),
    ...(settingsNotice.success ? [SETTINGS_NOTICE_KEY] : []),
    ...(drawerError.success ? [DRAWER_COMMAND_ERROR_KEY] : []),
  ];
  if (consumed.length) await chrome.storage.local.remove(consumed);
}
