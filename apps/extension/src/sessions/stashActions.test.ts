import { afterEach, expect, it, vi } from 'vitest';
import { startStash, sendStashMessage } from './stashActions';
import { panelStrings as strings } from '../i18n/panelStrings';
import { TABS_PERMISSION_DECLINED_KEY } from '../permissions/keys';
import type { NoticeInput } from '../newtab/ToastStack';

function setup(isGranted = false, wasDeclined = false) {
  const api = {
    permissions: {
      contains: vi.fn().mockResolvedValue(isGranted),
      request: vi.fn().mockResolvedValue(true),
    },
    runtime: { sendMessage: vi.fn().mockResolvedValue({ error: null }) },
    storage: {
      local: {
        get: vi
          .fn()
          .mockResolvedValue({ [TABS_PERMISSION_DECLINED_KEY]: wasDeclined }),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
  vi.stubGlobal('chrome', api);
  return api;
}
afterEach(() => vi.unstubAllGlobals());

it('explains tab access and waits for Allow before requesting it', async () => {
  const api = setup();
  const notify = vi.fn<(notice: NoticeInput) => void>();
  await startStash(notify);
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ text: strings.stashPermissionReason }),
  );
  expect(api.permissions.request).not.toHaveBeenCalled();
  await notify.mock.calls[0]?.[0].action?.run();
  expect(api.permissions.request).toHaveBeenCalledExactlyOnceWith({
    permissions: ['tabs'],
  });
  expect(api.runtime.sendMessage).toHaveBeenCalledWith({ type: 'deck:stash' });
});

it('records a decline and never reads or closes tabs', async () => {
  const api = setup();
  api.permissions.request.mockResolvedValue(false);
  const notify = vi.fn<(notice: NoticeInput) => void>();
  await startStash(notify);
  await notify.mock.calls[0]?.[0].action?.run();
  expect(api.storage.local.set).toHaveBeenCalledWith({
    [TABS_PERMISSION_DECLINED_KEY]: true,
  });
  expect(api.runtime.sendMessage).not.toHaveBeenCalled();
});

it('does not request again after a decline and uses an existing grant immediately', async () => {
  const api = setup(false, true);
  const notify = vi.fn();
  await startStash(notify);
  expect(api.permissions.request).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith({
    kind: 'error',
    text: strings.stashPermissionDeclined,
  });
  api.permissions.contains.mockResolvedValue(true);
  await startStash(notify);
  expect(api.runtime.sendMessage).toHaveBeenCalledOnce();
});

it('surfaces worker errors and rejects malformed replies', async () => {
  const api = setup();
  api.runtime.sendMessage.mockResolvedValue({ error: 'write failed' });
  await expect(sendStashMessage()).rejects.toThrow('write failed');
  api.runtime.sendMessage.mockResolvedValue(null);
  await expect(sendStashMessage('deck_session')).rejects.toThrow();
});
