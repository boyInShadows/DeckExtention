/**
 * Deck's MV3 service worker.
 *
 *   P1.S2  daily snapshot maintenance
 *   P2.S1  `toggle-drawer` relayed to the open new tab
 *   P2.S4  Quick Save: the `quick-save` command, the toolbar icon and the
 *          "Save to Deck" context menus, with the toast injected at that
 *          moment only (see ./quickSave.ts)
 *   P3     `stash` - declared in the manifest, deliberately unhandled until
 *          the feature exists rather than wired to an empty lie
 */

import { captureStrings } from '../i18n/captureStrings';
import { BackupService } from '../storage/backup';
import { openDeckDatabase } from '../storage/database';
import { DeckRepository } from '../storage/repository';
import { handleToastDecision, quickSave } from './quickSave';

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

const MENU_SAVE_PAGE = 'deck-save-page';
const MENU_SAVE_LINK = 'deck-save-link';

chrome.runtime.onInstalled.addListener(() => {
  void chrome.contextMenus.removeAll().then(() => {
    chrome.contextMenus.create({
      id: MENU_SAVE_PAGE,
      title: captureStrings.menuSavePage,
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: MENU_SAVE_LINK,
      title: captureStrings.menuSaveLink,
      contexts: ['link'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_SAVE_PAGE) void quickSave(repository, tab);
  if (info.menuItemId === MENU_SAVE_LINK && info.linkUrl)
    void quickSave(repository, tab, info.linkUrl);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab || sender.id !== chrome.runtime.id) return false;
  void handleToastDecision(repository, message, sender).then((reply) => {
    if (reply) sendResponse(reply);
  });
  return true;
});

chrome.action.onClicked.addListener((tab) => void quickSave(repository, tab));

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'quick-save') {
    void quickSave(repository, tab);
    return;
  }
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
