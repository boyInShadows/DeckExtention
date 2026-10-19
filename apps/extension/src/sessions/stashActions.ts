import { panelStrings as strings } from '../i18n/panelStrings';
import { TABS_PERMISSION_DECLINED_KEY } from '../permissions/keys';
import type { NoticeInput } from '../newtab/ToastStack';
import { STASH_MESSAGE, UNDO_STASH_MESSAGE } from './constants';
import { StashReplySchema } from './messages';

export async function sendStashMessage(deckId?: string): Promise<void> {
  const reply = StashReplySchema.parse(
    await chrome.runtime.sendMessage(
      deckId ? { type: UNDO_STASH_MESSAGE, deckId } : { type: STASH_MESSAGE },
    ),
  );
  if (reply.error) throw new Error(reply.error);
}

export async function startStash(
  notify: (notice: NoticeInput) => void,
): Promise<void> {
  if (await chrome.permissions.contains({ permissions: ['tabs'] }))
    return sendStashMessage();
  const items = await chrome.storage.local.get(TABS_PERMISSION_DECLINED_KEY);
  if (items[TABS_PERMISSION_DECLINED_KEY] === true) {
    notify({ kind: 'error', text: strings.stashPermissionDeclined });
    return;
  }
  notify({
    kind: 'info',
    text: strings.stashPermissionReason,
    action: {
      label: strings.allowAccess,
      run: async () => {
        if (!(await chrome.permissions.request({ permissions: ['tabs'] }))) {
          await chrome.storage.local.set({
            [TABS_PERMISSION_DECLINED_KEY]: true,
          });
          notify({ kind: 'error', text: strings.stashPermissionDeclined });
          return;
        }
        await sendStashMessage();
      },
    },
  });
}
