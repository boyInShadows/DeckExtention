import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  repository: vi.fn(),
  backup: vi.fn(),
  maintenance: vi.fn(() => Promise.resolve(false)),
  purge: vi.fn(() => Promise.resolve(0)),
  onStorageChanged: vi.fn(),
}));

vi.mock('../storage/repository', () => ({
  DeckRepository: class {
    close = vi.fn();
    purge = mocks.purge;
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
  handleToastDecision: vi.fn(),
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
