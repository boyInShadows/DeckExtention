import { z } from 'zod';
import { captureTarget, saveToInbox } from '../capture/quickSave';
import { captureStrings } from '../i18n/captureStrings';
import { panelStrings as strings } from '../i18n/panelStrings';
import type { NoticeInput } from '../newtab/ToastStack';
import { TABS_PERMISSION_DECLINED_KEY } from '../permissions/keys';
import type { DeckRepository } from '../storage/repository';

export interface OpenTab {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  hostname: string;
  windowLabel: string;
}
export interface OpenTabsState {
  hasAccess: boolean;
  tabs: OpenTab[];
}
export type TabAction = 'activate' | 'close' | 'save';
const BrowserTabSchema = z.object({
  id: z.number().int().nonnegative(),
  windowId: z.number().int().nonnegative(),
  index: z.number().int().nonnegative(),
  title: z.string().optional(),
  url: z.string().optional(),
  pendingUrl: z.string().optional(),
});

function parseTab(value: unknown): Omit<OpenTab, 'windowLabel'> | null {
  const parsed = BrowserTabSchema.safeParse(value);
  if (!parsed.success) return null;
  const source = parsed.data;
  const address = source.pendingUrl ?? source.url;
  if (!address) return null;
  let url: URL;
  try {
    url = new URL(address);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
  const hostname = url.hostname || url.protocol.replace(/:$/, '');
  return {
    id: source.id,
    index: source.index,
    windowId: source.windowId,
    title: source.title?.trim() || hostname,
    url: url.href,
    hostname,
  };
}

export async function readOpenTabs(): Promise<OpenTabsState> {
  if (!(await chrome.permissions.contains({ permissions: ['tabs'] })))
    return { hasAccess: false, tabs: [] };
  const [current, records] = await Promise.all([
    chrome.tabs.getCurrent(),
    chrome.tabs.query({}),
  ]);
  const ownOrigin = chrome.runtime.getURL('');
  const tabs = records
    .flatMap((record) => {
      const tab = parseTab(record);
      return tab &&
        tab.id !== current?.id &&
        !tab.url.startsWith(ownOrigin) &&
        tab.url !== 'chrome://newtab/'
        ? [tab]
        : [];
    })
    .toSorted(
      (a, b) =>
        Number(b.windowId === current?.windowId) -
          Number(a.windowId === current?.windowId) ||
        a.windowId - b.windowId ||
        a.index - b.index,
    );
  const windows = [
    ...new Set([current?.windowId, ...tabs.map((tab) => tab.windowId)]),
  ];
  return {
    hasAccess: true,
    tabs: tabs.map((tab) => ({
      ...tab,
      windowLabel:
        tab.windowId === current?.windowId
          ? strings.thisWindow
          : strings.tabWindow(windows.indexOf(tab.windowId) + 1),
    })),
  };
}

export async function performTabAction(
  repository: DeckRepository,
  selected: OpenTab,
  action: TabAction,
): Promise<string | undefined> {
  if (!(await chrome.permissions.contains({ permissions: ['tabs'] })))
    throw new Error(strings.tabSearchPermissionDeclined);
  const current = parseTab(await chrome.tabs.get(selected.id));
  if (!current || current.id !== selected.id || current.url !== selected.url)
    throw new Error(strings.openTabChanged);
  if (action === 'close') {
    await chrome.tabs.remove(current.id);
    return strings.tabClosed;
  }
  if (action === 'save') {
    const target = captureTarget(current.url, current.title);
    if (!target) throw new Error(captureStrings.unsupportedPage);
    const result = await saveToInbox(repository, target);
    return result.kind === 'saved'
      ? captureStrings.saved
      : `${captureStrings.duplicate} ${result.location ?? captureStrings.inbox}`;
  }
  await chrome.tabs.update(current.id, { active: true });
  const cards = (await repository.listCards()).filter(
    (card) => card.deletedAt === null && card.url === current.url,
  );
  await repository.markCardsOpened(cards.map((card) => card.id));
  await chrome.windows.update(current.windowId, { focused: true });
  return undefined;
}

export async function requestTabSearch(
  notify: (notice: NoticeInput) => void,
): Promise<void> {
  if (await chrome.permissions.contains({ permissions: ['tabs'] })) return;
  const items = await chrome.storage.local.get(TABS_PERMISSION_DECLINED_KEY);
  if (items[TABS_PERMISSION_DECLINED_KEY] === true) {
    notify({ kind: 'error', text: strings.tabSearchPermissionDeclined });
    return;
  }
  notify({
    kind: 'info',
    text: strings.tabSearchPermissionReason,
    action: {
      label: strings.allowAccess,
      run: async () => {
        if (await chrome.permissions.request({ permissions: ['tabs'] })) return;
        await chrome.storage.local.set({
          [TABS_PERMISSION_DECLINED_KEY]: true,
        });
        notify({ kind: 'error', text: strings.tabSearchPermissionDeclined });
      },
    },
  });
}
