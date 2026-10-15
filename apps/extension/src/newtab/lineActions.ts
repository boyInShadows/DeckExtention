import type { Settings } from 'deck-schema';

import { panelStrings as strings } from '../i18n/panelStrings';
import type { SurfaceData } from './bootstrap';
import { downloadExport } from './downloadExport';
import type { ActionId } from './lineActionCatalog';

interface ActionContext {
  settings: Settings;
  repository: SurfaceData['repository'];
  saveSettings: (settings: Settings) => Promise<void>;
  openSettings: () => void;
  notify: (message: string) => void;
  notifySuccess?: (message: string) => void;
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
  await downloadExport(context.repository);
  context.notifySuccess?.(strings.exportSaved);
}

export async function searchWeb(
  query: string,
  settings: Settings,
  saveSettings: (settings: Settings) => Promise<void>,
): Promise<void> {
  const permission = {
    permissions: ['search'] as chrome.runtime.ManifestOptionalPermission[],
  };
  let hasPermission = await chrome.permissions.contains(permission);
  if (!hasPermission && settings.searchPermission !== 'declined') {
    hasPermission = await chrome.permissions.request(permission);
    if (!hasPermission)
      await saveSettings({ ...settings, searchPermission: 'declined' });
  }
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
