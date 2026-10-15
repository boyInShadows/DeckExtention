import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toggleDrawer } from './toggleDrawer';

const sendMessage = vi.fn<(message: unknown) => Promise<unknown>>();
const create =
  vi.fn<(options: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>>();
const query = vi.fn<() => Promise<chrome.tabs.Tab[]>>();
const set = vi.fn<(value: object) => Promise<void>>();
const remove = vi.fn<(key: string) => Promise<void>>();

beforeEach(() => {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      getURL: (path: string) => `chrome-extension://deck/${path}`,
    },
    tabs: { create, query },
    storage: { local: { set, remove } },
  });
  create.mockResolvedValue({ id: 9 } as chrome.tabs.Tab);
  query.mockResolvedValue([{ id: 3 }] as chrome.tabs.Tab[]);
  remove.mockResolvedValue();
  set.mockResolvedValue();
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('toggleDrawer', () => {
  it('targets only the active Deck tab', async () => {
    sendMessage.mockResolvedValue(true);
    await toggleDrawer({ id: 3 } as chrome.tabs.Tab);
    expect(sendMessage).toHaveBeenCalledWith({ drawer: 3 });
    expect(create).not.toHaveBeenCalled();
  });

  it('opens Deck on a normal site with the remembered page', async () => {
    sendMessage.mockRejectedValue(new Error('no receiver'));
    await toggleDrawer({ id: 3 } as chrome.tabs.Tab);
    expect(create).toHaveBeenCalledWith({
      url: 'chrome-extension://deck/src/newtab/index.html#page=last',
    });
    expect(remove).toHaveBeenCalledWith('drawerCommandError');
  });

  it('queries the active tab when Chrome omits the command tab', async () => {
    sendMessage.mockResolvedValue(true);
    await toggleDrawer();
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(sendMessage).toHaveBeenCalledWith({ drawer: 3 });
  });

  it('records a failed Deck tab creation', async () => {
    sendMessage.mockRejectedValue(new Error('no receiver'));
    create.mockRejectedValue(new Error('window closed'));
    await toggleDrawer({ id: 3 } as chrome.tabs.Tab);
    expect(set).toHaveBeenCalledWith({
      drawerCommandError: {
        message: 'window closed',
        occurredAt: expect.any(Number),
      },
    });
  });
});
