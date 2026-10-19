import { panelStrings as strings } from '../i18n/panelStrings';
import type { DeckRepository } from '../storage/repository';
import { stashWindow, undoStash } from '../sessions/stash';
import { StashMessageSchema } from '../sessions/messages';
import {
  SESSIONS_PAGE_ID,
  STASH_MESSAGE,
  STASH_NOTICE_KEY,
  STASH_PERMISSION_HASH,
} from '../sessions/constants';

const activeWindows = new Set<number>();
const newtab = () => chrome.runtime.getURL('src/newtab/index.html');

export async function runStashCommand(
  repository: DeckRepository,
  tab?: chrome.tabs.Tab,
): Promise<void> {
  let windowId = tab?.windowId;
  try {
    windowId ??= (
      await chrome.tabs.query({ active: true, currentWindow: true })
    )[0]?.windowId;
    if (windowId === undefined) throw new Error(strings.stashFailed);
    await stashInWindow(repository, windowId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await chrome.storage.local.set({
      [STASH_NOTICE_KEY]: {
        kind: 'error',
        message: `${strings.stashFailed} ${detail}`,
      },
    });
    await chrome.tabs.create({
      ...(windowId === undefined ? {} : { windowId }),
      url: `${newtab()}#page=${SESSIONS_PAGE_ID}`,
    });
  }
}

async function stashInWindow(
  repository: DeckRepository,
  windowId: number,
): Promise<void> {
  if (activeWindows.has(windowId)) return;
  activeWindows.add(windowId);
  try {
    if (!(await chrome.permissions.contains({ permissions: ['tabs'] }))) {
      await chrome.tabs.create({
        windowId,
        url: `${newtab()}${STASH_PERMISSION_HASH}`,
      });
      return;
    }
    await stashAndShow(repository, windowId);
  } finally {
    activeWindows.delete(windowId);
  }
}

async function stashAndShow(
  repository: DeckRepository,
  windowId: number,
): Promise<void> {
  const result = await stashWindow(repository, windowId);
  const message = result
    ? `${strings.stashedTabs(result.count)}${result.remaining ? ` · ${strings.stashRemaining(result.remaining)}` : ''}`
    : strings.stashEmpty;
  await chrome.storage.local.set({
    [STASH_NOTICE_KEY]: {
      kind: result?.remaining ? 'error' : result ? 'success' : 'info',
      message,
      ...(result ? { deckId: result.deckId } : {}),
    },
  });
  const url = `${newtab()}#page=${SESSIONS_PAGE_ID}`;
  if (result) await chrome.tabs.update(result.tabId, { url, active: true });
  else await chrome.tabs.create({ windowId, url });
}

export async function handleStashMessage(
  repository: DeckRepository,
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<{ error: string | null }> {
  const parsed = StashMessageSchema.safeParse(message);
  if (
    !parsed.success ||
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(newtab()) ||
    !sender.tab
  )
    return { error: strings.stashFailed };
  try {
    if (parsed.data.type === STASH_MESSAGE)
      await runStashCommand(repository, sender.tab);
    else await undoStash(repository, parsed.data.deckId, sender.tab.windowId);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
