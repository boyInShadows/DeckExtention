import { readOpenTabs, type OpenTabsState } from './openTabs';

const REFRESH_DELAY_MS = 100;

export function observeOpenTabs(
  onChange: (value: OpenTabsState) => void,
  onError: (error: unknown) => void,
) {
  let isActive = true;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    const request = ++revision;
    try {
      const value = await readOpenTabs();
      if (isActive && request === revision) onChange(value);
    } catch (error) {
      if (!isActive || request !== revision) return;
      onChange({ hasAccess: false, tabs: [] });
      onError(error);
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), REFRESH_DELAY_MS);
  };
  const updated = (_id: number, change: chrome.tabs.OnUpdatedInfo) => {
    if (change.url !== undefined || change.title !== undefined) schedule();
  };
  const added = (value: chrome.permissions.Permissions) => {
    if (value.permissions?.includes('tabs')) void refresh();
  };
  const removed = (value: chrome.permissions.Permissions) => {
    if (!value.permissions?.includes('tabs')) return;
    clearTimeout(timer);
    revision += 1;
    onChange({ hasAccess: false, tabs: [] });
  };
  const events = [
    chrome.tabs.onCreated,
    chrome.tabs.onRemoved,
    chrome.tabs.onMoved,
    chrome.tabs.onAttached,
    chrome.tabs.onReplaced,
  ];
  events.forEach((event) => event.addListener(schedule));
  chrome.tabs.onUpdated.addListener(updated);
  chrome.permissions.onAdded.addListener(added);
  chrome.permissions.onRemoved.addListener(removed);
  void refresh();
  return {
    refresh,
    stop: () => {
      isActive = false;
      revision += 1;
      clearTimeout(timer);
      events.forEach((event) => event.removeListener(schedule));
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.permissions.onAdded.removeListener(added);
      chrome.permissions.onRemoved.removeListener(removed);
    },
  };
}
