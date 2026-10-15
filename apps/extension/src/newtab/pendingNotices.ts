import {
  BACKUP_ERROR_KEY,
  BackgroundErrorSchema,
  CAPTURE_NOTICE_KEY,
  CaptureNoticeSchema,
  DRAWER_COMMAND_ERROR_KEY,
  SETTINGS_NOTICE_KEY,
} from 'deck-schema';

import { panelStrings as strings } from '../i18n/panelStrings';
import type { NoticeInput } from './ToastStack';

export async function readPendingNotices(
  notify: (notice: NoticeInput) => void,
): Promise<void> {
  const items = await chrome.storage.local.get([
    CAPTURE_NOTICE_KEY,
    SETTINGS_NOTICE_KEY,
    DRAWER_COMMAND_ERROR_KEY,
    BACKUP_ERROR_KEY,
  ]);
  const notice = CaptureNoticeSchema.safeParse(items[CAPTURE_NOTICE_KEY]);
  const settingsNotice = CaptureNoticeSchema.safeParse(
    items[SETTINGS_NOTICE_KEY],
  );
  const drawerError = BackgroundErrorSchema.safeParse(
    items[DRAWER_COMMAND_ERROR_KEY],
  );
  const backupError = BackgroundErrorSchema.safeParse(items[BACKUP_ERROR_KEY]);
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
  if (backupError.success)
    notify({
      kind: 'error',
      text: `${strings.backupFailed} ${backupError.data.message}`,
    });
  const consumed = [
    ...(notice.success ? [CAPTURE_NOTICE_KEY] : []),
    ...(settingsNotice.success ? [SETTINGS_NOTICE_KEY] : []),
    ...(drawerError.success ? [DRAWER_COMMAND_ERROR_KEY] : []),
  ];
  if (consumed.length) await chrome.storage.local.remove(consumed);
}
