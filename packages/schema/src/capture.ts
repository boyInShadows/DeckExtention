import { z } from 'zod';
import { TimestampSchema } from './common';
export {
  INBOX_DECK_ID,
  OPEN_PAGE_HASH_PREFIX,
  OPEN_SETTINGS_HASH,
} from './constants';

/**
 * The contract between the service worker (Quick Save, FableTasks P2.S4) and
 * the new tab. Both sides import it from here so neither can drift.
 */

/** The Inbox is a singleton system deck with a stable id (MasterPlan I3). */

/**
 * Quick Save reads the page it saves and shows a toast on it. Both are
 * optional permissions, granted once from Settings and revocable there
 * (AGENTS.md section 3.1). `scripting` is what lets the toast be injected at
 * hotkey time only, instead of through a content script (guardrail 6).
 */
export const CAPTURE_PERMISSIONS = ['activeTab', 'scripting'] as const;

/**
 * When a toast cannot be shown on the page (a `chrome://` URL, the Web Store),
 * the service worker leaves a notice for the next new tab to display.
 */
export const CAPTURE_NOTICE_KEY = 'deck:capture-notice';
export const CAPTURE_PERMISSION_DECLINED_KEY =
  'deck:capture-permission-declined';
export const SETTINGS_NOTICE_KEY = 'deck:settings-notice';
export const BACKUP_ERROR_KEY = 'backupMaintenanceError';
export const DRAWER_COMMAND_ERROR_KEY = 'drawerCommandError';

export const BackgroundErrorSchema = z.strictObject({
  message: z.string().min(1).max(400),
  occurredAt: TimestampSchema,
});

export const CaptureNoticeSchema = z.strictObject({
  message: z.string().min(1).max(400),
  createdAt: TimestampSchema,
  kind: z.enum(['success', 'error']).optional(),
});

/** `#page=<id>` opens the drawer on that page; `#settings` opens Settings. */

export type CaptureNotice = z.infer<typeof CaptureNoticeSchema>;
