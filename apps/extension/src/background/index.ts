/**
 * Deck's MV3 service worker.
 *
 * It exists in P1.S1 so the manifest is loadable and the three commands have a
 * home. What lands here over time:
 *   P2.S4  the `quick-save` command, the "Save to Deck" context menus and the
 *          toast injected via `activeTab` at hotkey time only
 *   P3     `stash`
 *
 * There is no `chrome.commands.onCommand` listener yet: an empty handler would
 * be a lie about what the hotkeys do, and Chrome is happy for a declared
 * command to have no listener until the feature exists.
 */

import { BackupService, DeckRepository, openDeckDatabase } from '../storage';

const BACKUP_ERROR_KEY = 'backupMaintenanceError';
const repository = new DeckRepository();
const backups = new BackupService(repository, openDeckDatabase());

async function runBackupMaintenance(): Promise<void> {
  try {
    await backups.ensureDailySnapshot();
    await chrome.storage.local.remove(BACKUP_ERROR_KEY);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await chrome.storage.local.set({
      [BACKUP_ERROR_KEY]: { message, occurredAt: Date.now() },
    });
  }
}

// A service worker wakes at install and browser start. The 24-hour guard makes
// repeated wakes cheap. This is opportunistic rather than an exact timer:
// Chrome's exact daily alarm requires an `alarms` install-time permission,
// which AGENTS.md section 3.1 forbids.
void runBackupMaintenance();
chrome.runtime.onStartup.addListener(() => void runBackupMaintenance());

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-drawer') return;
  void chrome.runtime
    .sendMessage({ type: 'deck:toggle-drawer' })
    .catch(async (messageError: unknown) => {
      const message =
        messageError instanceof Error
          ? messageError.message
          : String(messageError);
      await chrome.storage.local.set({
        drawerCommandError: { message, occurredAt: Date.now() },
      });
    });
});
