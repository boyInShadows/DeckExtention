import { z } from 'zod';
import { TimestampSchema } from './common';

/**
 * The contract between the service worker (Quick Save, FableTasks P2.S4) and
 * the new tab. Both sides import it from here so neither can drift.
 */

/** The Inbox is a singleton system deck with a stable id (MasterPlan I3). */
export const INBOX_DECK_ID = 'deck_inbox';

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

export const CaptureNoticeSchema = z.strictObject({
  message: z.string().min(1).max(400),
  createdAt: TimestampSchema,
});

/** `#page=<id>` opens the drawer on that page; `#settings` opens Settings. */
export const OPEN_PAGE_HASH_PREFIX = '#page=';
export const OPEN_SETTINGS_HASH = '#settings';

export type CaptureNotice = z.infer<typeof CaptureNoticeSchema>;
