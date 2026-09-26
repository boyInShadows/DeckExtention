import {
  CAPTURE_NOTICE_KEY,
  CAPTURE_PERMISSIONS,
  IdSchema,
  NoteSchema,
  OPEN_PAGE_HASH_PREFIX,
  OPEN_SETTINGS_HASH,
  type CaptureNotice,
} from 'deck-schema';
import { z } from 'zod';

import {
  addNoteToCard,
  captureTarget,
  saveToInbox,
  undoSave,
} from '../capture/quickSave';
import toastCss from '../capture/toast.css?raw';
import {
  showCaptureToast,
  toastStylesheet,
  type ToastReply,
} from '../capture/toast';
import { buildToastModel, TOAST_MESSAGE_TYPE } from '../capture/toastModel';
import { captureStrings } from '../i18n/captureStrings';
import type { DeckRepository } from '../storage/repository';
import tokensCss from '../styles/tokens.css?raw';

/**
 * Quick Save in the service worker (FableTasks P2.S4): hotkey, context menu or
 * toolbar icon -> read the active tab -> write to Inbox -> toast on the page.
 * No popup, no picker. The toast is injected here, at that moment, and never
 * otherwise - there is no content script (AGENTS.md guardrail 6).
 */

const NEWTAB_PATH = 'src/newtab/index.html';
const BADGE_FLASH_MS = 2_500;
const BADGE_SAVED = '✓';
const BADGE_PROBLEM = '!';
const TOAST_CSS = toastStylesheet(tokensCss, toastCss);

const ToastDecisionSchema = z.strictObject({
  type: z.literal(TOAST_MESSAGE_TYPE),
  cardId: IdSchema,
  /** A page id, or 'inbox' - which is shorter than IdSchema allows. */
  pageId: z.string().min(1).max(64),
  outcome: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('undo') }),
    z.strictObject({ kind: z.literal('open') }),
    z.strictObject({ kind: z.literal('note'), note: NoteSchema.min(1) }),
  ]),
});

export async function quickSave(
  repository: DeckRepository,
  tab: chrome.tabs.Tab | undefined,
  linkUrl?: string,
): Promise<void> {
  try {
    await runQuickSave(repository, tab, linkUrl);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await tellUser(`${captureStrings.saveFailed} ${detail}`);
  }
}

async function runQuickSave(
  repository: DeckRepository,
  tab: chrome.tabs.Tab | undefined,
  linkUrl: string | undefined,
): Promise<void> {
  const isGranted = await chrome.permissions.contains({
    permissions: [...CAPTURE_PERMISSIONS],
  });
  if (!isGranted) {
    await tellUser(captureStrings.needsPermission);
    await openNewTab(OPEN_SETTINGS_HASH);
    return;
  }
  const target = linkUrl
    ? captureTarget(linkUrl, undefined)
    : captureTarget(tab?.url, tab?.title);
  if (!target) {
    await tellUser(captureStrings.unsupportedPage);
    return;
  }
  const [result, settings] = await Promise.all([
    saveToInbox(repository, target),
    repository.getSettings(),
  ]);
  const isShown =
    tab?.id !== undefined &&
    (await showToast(
      tab.id,
      buildToastModel(result, settings.theme, TOAST_CSS),
    ));
  if (isShown) return;
  await flashBadge(BADGE_SAVED);
  if (result.kind === 'saved') {
    await leaveNotice(
      `${captureStrings.savedWithoutToast} ${result.card.title}`,
    );
  }
}

/**
 * The toast's decision arrives here as a message (see ToastModel.report), so
 * it lands even if Chrome stopped this worker while a note was being typed.
 * Only our own injected toast can send it; the body is still parsed, since it
 * was assembled on a page we do not control. The reply tells the toast
 * whether to confirm or to say it failed.
 */
export async function handleToastDecision(
  repository: DeckRepository,
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<ToastReply | null> {
  if (sender.id !== chrome.runtime.id || !sender.tab) return null;
  const parsed = ToastDecisionSchema.safeParse(message);
  if (!parsed.success) return null;
  const { cardId, pageId, outcome } = parsed.data;
  try {
    if (outcome.kind === 'undo') await undoSave(repository, cardId);
    if (outcome.kind === 'note')
      await addNoteToCard(repository, cardId, outcome.note);
    if (outcome.kind === 'open')
      await openNewTab(`${OPEN_PAGE_HASH_PREFIX}${encodeURIComponent(pageId)}`);
    return { isDone: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await tellUser(`${captureStrings.saveFailed} ${detail}`);
    return { isDone: false };
  }
}

/**
 * False means the toast could not be shown: Chrome refuses scripting on its
 * own pages, the Web Store and the PDF viewer, or the tab closed. The save
 * itself already happened; the caller tells the user through the badge and
 * the next new tab instead.
 */
async function showToast(
  tabId: number,
  model: ReturnType<typeof buildToastModel>,
): Promise<boolean> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: showCaptureToast,
      args: [model],
    });
    return injection?.result === true;
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
}

async function tellUser(message: string): Promise<void> {
  await flashBadge(BADGE_PROBLEM);
  await leaveNotice(message);
}

async function flashBadge(text: string): Promise<void> {
  await chrome.action.setBadgeText({ text });
  setTimeout(() => {
    void chrome.action.setBadgeText({ text: '' });
  }, BADGE_FLASH_MS);
}

async function leaveNotice(message: string): Promise<void> {
  const notice: CaptureNotice = { message, createdAt: Date.now() };
  await chrome.storage.local.set({ [CAPTURE_NOTICE_KEY]: notice });
}

async function openNewTab(hash: string): Promise<void> {
  await chrome.tabs.create({
    url: `${chrome.runtime.getURL(NEWTAB_PATH)}${hash}`,
  });
}
