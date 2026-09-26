import type { Settings } from 'deck-schema';

import { strings } from '../i18n/strings';
import { BackupService, openDeckDatabase } from '../storage';
import type { SurfaceData } from './bootstrap';
import type { ActionId } from './lineActionCatalog';

interface ActionContext {
  settings: Settings;
  repository: SurfaceData['repository'];
  saveSettings: (settings: Settings) => Promise<void>;
  openSettings: () => void;
  notify: (message: string) => void;
}

export async function executeAction(
  id: ActionId,
  context: ActionContext,
): Promise<void> {
  if (id === 'blur') {
    await context.saveSettings({
      ...context.settings,
      isBlurred: !context.settings.isBlurred,
    });
    return;
  }
  if (id.startsWith('theme-')) {
    const theme = id.slice('theme-'.length) as Settings['theme'];
    await context.saveSettings({ ...context.settings, theme });
    return;
  }
  if (id === 'settings' || id === 'import') {
    context.openSettings();
    return;
  }
  if (id === 'new-page') {
    context.notify(strings.drawerRequired);
    return;
  }
  if (id === 'stash') {
    context.notify(strings.stashComing);
    return;
  }
  const backups = new BackupService(context.repository, openDeckDatabase());
  const result = await backups.exportData();
  const url = URL.createObjectURL(
    new Blob([result.json], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `deck-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function searchWeb(
  query: string,
  settings: Settings,
): Promise<void> {
  const hasPermission = await chrome.permissions.request({
    permissions: ['search'],
  });
  if (hasPermission) {
    await chrome.search.query({ text: query, disposition: 'CURRENT_TAB' });
    return;
  }
  const target = settings.searchUrlTemplate.replace(
    '{query}',
    encodeURIComponent(query),
  );
  window.location.assign(target);
}
