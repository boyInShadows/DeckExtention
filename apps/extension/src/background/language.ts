import type { DeckRepository } from '../storage/repository';
import { captureStrings } from '../i18n/captureStrings';
import { setLanguage } from '../i18n/language';

export const MENU_SAVE_PAGE = 'deck-save-page';
export const MENU_SAVE_LINK = 'deck-save-link';
let nativeUpdate = Promise.resolve();

export async function loadLanguage(repository: DeckRepository) {
  const settings = await repository.getSettings();
  setLanguage(settings.language);
  return settings;
}

function createMenu(properties: chrome.contextMenus.CreateProperties) {
  return new Promise<void>((resolve, reject) => {
    chrome.contextMenus.create(properties, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

export function refreshNativeLanguage(
  repository: DeckRepository,
): Promise<void> {
  const update = async () => {
    await loadLanguage(repository);
    await chrome.contextMenus.removeAll();
    await createMenu({
      id: MENU_SAVE_PAGE,
      title: captureStrings.menuSavePage,
      contexts: ['page'],
    });
    await createMenu({
      id: MENU_SAVE_LINK,
      title: captureStrings.menuSaveLink,
      contexts: ['link'],
    });
    await chrome.action.setTitle({ title: captureStrings.toolbarSave });
  };
  // Install, worker wake and open tabs can request a refresh together.
  nativeUpdate = nativeUpdate.then(update, update);
  return nativeUpdate;
}
