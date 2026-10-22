import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAINTENANCE_MESSAGE } from 'deck-schema/constants';
import { TOAST_MESSAGE_TYPE } from '../capture/toastModel';

const mocks = vi.hoisted(() => ({
  repository: vi.fn(),
  backup: vi.fn(),
  maintenance: vi.fn(() => Promise.resolve(false)),
  purge: vi.fn(() => Promise.resolve(0)),
  onStorageChanged: vi.fn(),
  toastDecision: vi.fn(),
  stash: vi.fn(),
}));

vi.mock('../storage/repository', () => ({
  DeckRepository: class {
    close = vi.fn();
    purge = mocks.purge;
    expireSessions = vi.fn().mockResolvedValue(0);
    constructor() {
      mocks.repository();
    }
  },
}));
vi.mock('../storage/database', () => ({
  ACTIVE_DATABASE_KEY: 'deckDb',
  openDeckDatabase: () => Promise.resolve({}),
}));
vi.mock('../storage/backup', () => ({
  BackupService: class {
    constructor() {
      mocks.backup();
    }
    ensureDailySnapshot = mocks.maintenance;
  },
}));
vi.mock('./quickSave', () => ({
  quickSave: vi.fn(),
  handleToastDecision: mocks.toastDecision,
}));
vi.mock('./stash', () => ({
  handleStashMessage: mocks.stash,
  runStashCommand: vi.fn(),
}));

describe('background database selection', () => {
  it('switches the worker to the restored database when the active key changes', async () => {
    const addListener = vi.fn();
    const remove = vi.fn(() => Promise.resolve());
    mocks.maintenance.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.stubGlobal('chrome', {
      storage: {
        local: { remove, set: vi.fn() },
        onChanged: { addListener: mocks.onStorageChanged },
      },
      runtime: {
        onStartup: { addListener },
        onInstalled: { addListener },
        onMessage: { addListener },
      },
      contextMenus: { onClicked: { addListener } },
      action: { onClicked: { addListener } },
      commands: { onCommand: { addListener } },
    });
    await import('./index');
    const onChanged = mocks.onStorageChanged.mock.calls[0]?.[0] as
      ((changes: Record<string, unknown>, area: string) => void) | undefined;
    expect(onChanged).toBeTypeOf('function');
    expect(mocks.repository).toHaveBeenCalledTimes(1);
    expect(mocks.backup).toHaveBeenCalledTimes(1);

    onChanged?.({ deckDb: { newValue: 'deck-recovery-test' } }, 'local');

    expect(mocks.repository).toHaveBeenCalledTimes(2);
    expect(mocks.backup).toHaveBeenCalledTimes(2);
    expect(mocks.maintenance).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(mocks.purge).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
    vi.unstubAllGlobals();
  });
});

describe('background message replies', () => {
  const addListener = vi.fn();
  const sender = { id: 'deck-test', tab: { id: 1 } };
  const set = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    addListener.mockClear();
    mocks.maintenance.mockReset().mockResolvedValue(false);
    mocks.toastDecision.mockReset().mockResolvedValue(null);
    mocks.stash.mockReset().mockResolvedValue({ error: null });
    set.mockReset().mockResolvedValue(undefined);
    const event = { addListener: vi.fn() };
    vi.stubGlobal('chrome', {
      storage: {
        local: { remove: vi.fn().mockResolvedValue(undefined), set },
        onChanged: event,
      },
      runtime: {
        id: sender.id,
        onStartup: event,
        onInstalled: event,
        onMessage: { addListener },
      },
      contextMenus: { onClicked: event },
      action: { onClicked: event },
      commands: { onCommand: event },
    });
    await import('./index');
    await vi.waitFor(() =>
      expect(chrome.storage.local.remove).toHaveBeenCalled(),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  function dispatch(message: unknown, source = sender) {
    const respond = vi.fn();
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      source: typeof sender,
      respond: (response: unknown) => void,
    ) => boolean;
    return { isAsync: listener(message, source, respond), respond };
  }

  it.each([null, { type: 'deck:unknown' }, { drawer: 1 }])(
    'leaves unrelated messages to their receiver: %j',
    (message) => {
      const { isAsync, respond } = dispatch(message);
      expect(isAsync).toBe(false);
      expect(respond).not.toHaveBeenCalled();
      expect(mocks.toastDecision).not.toHaveBeenCalled();
    },
  );

  it('rejects messages from another extension', () => {
    expect(
      dispatch({ type: MAINTENANCE_MESSAGE }, { ...sender, id: 'other' })
        .isAsync,
    ).toBe(false);
  });

  it('replies after maintenance completes', async () => {
    const { isAsync, respond } = dispatch({ type: MAINTENANCE_MESSAGE });
    expect(isAsync).toBe(true);
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledExactlyOnceWith({ error: null }),
    );
  });

  it('replies with backup failures', async () => {
    mocks.maintenance.mockRejectedValueOnce(new Error('backup unavailable'));
    const { respond } = dispatch({ type: MAINTENANCE_MESSAGE });
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledExactlyOnceWith({
        error: 'backup unavailable',
      }),
    );
    expect(set).toHaveBeenCalled();
  });

  it('replies to an invalid toast decision instead of leaving its channel open', async () => {
    const { isAsync, respond } = dispatch({ type: TOAST_MESSAGE_TYPE });
    expect(isAsync).toBe(true);
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledExactlyOnceWith(null),
    );
  });

  it('replies when a handler rejects unexpectedly', async () => {
    mocks.stash.mockRejectedValueOnce(new Error('storage unavailable'));
    const { respond } = dispatch({ type: 'deck:stash' });
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledExactlyOnceWith({
        error: 'storage unavailable',
      }),
    );
  });
});
