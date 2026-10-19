import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DeckRepository } from '../storage/repository';
import { handleStashMessage, runStashCommand } from './stash';

const mocks = vi.hoisted(() => ({ stashWindow: vi.fn(), undoStash: vi.fn() }));
vi.mock('../sessions/stash', () => mocks);
const repository = {} as DeckRepository;
const URL = 'chrome-extension://deck/src/newtab/index.html';
const tab = { id: 5, windowId: 7 } as chrome.tabs.Tab;
const sender = { id: 'deck', url: URL, tab };
let api: ReturnType<typeof setup>;
function setup() {
  return {
    runtime: { id: 'deck', getURL: vi.fn(() => URL) },
    permissions: { contains: vi.fn().mockResolvedValue(true) },
    tabs: {
      query: vi.fn().mockResolvedValue([tab]),
      create: vi.fn().mockResolvedValue({ id: 99 }),
      update: vi.fn().mockResolvedValue({ id: 99 }),
    },
    storage: { local: { set: vi.fn().mockResolvedValue(undefined) } },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  api = setup();
  vi.stubGlobal('chrome', api);
  mocks.stashWindow.mockResolvedValue({
    deckId: 'session_test',
    count: 30,
    remaining: 0,
    tabId: 99,
  });
  mocks.undoStash.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

it('opens the in-context permission explanation before accessing tabs', async () => {
  api.permissions.contains.mockResolvedValue(false);
  await runStashCommand(repository, tab);
  expect(mocks.stashWindow).not.toHaveBeenCalled();
  expect(api.tabs.create).toHaveBeenCalledWith({
    windowId: 7,
    url: `${URL}#stash=`,
  });
});

it('publishes a durable Undo notice and opens Sessions after saving and closing', async () => {
  await runStashCommand(repository, tab);
  expect(mocks.stashWindow).toHaveBeenCalledWith(repository, 7);
  expect(api.storage.local.set).toHaveBeenCalledWith({
    stashNotice: {
      kind: 'success',
      message: 'Stashed 30 tabs',
      deckId: 'session_test',
    },
  });
  expect(api.tabs.update).toHaveBeenCalledWith(99, {
    url: `${URL}#page=sessions`,
    active: true,
  });
});

it('shows a persistent partial-close warning with Undo and reports write failures', async () => {
  mocks.stashWindow.mockResolvedValueOnce({
    deckId: 'session_test',
    count: 30,
    remaining: 2,
    tabId: 99,
  });
  await runStashCommand(repository);
  expect(api.storage.local.set).toHaveBeenCalledWith({
    stashNotice: expect.objectContaining({
      kind: 'error',
      deckId: 'session_test',
      message: expect.stringContaining('2 tabs stayed open'),
    }),
  });
  mocks.stashWindow.mockRejectedValueOnce(new Error('disk full'));
  await runStashCommand(repository, tab);
  expect(api.storage.local.set).toHaveBeenLastCalledWith({
    stashNotice: {
      kind: 'error',
      message: expect.stringContaining('disk full'),
    },
  });
});

it('does not duplicate an in-flight stash for the same window', async () => {
  let finish!: (value: null) => void;
  mocks.stashWindow.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = runStashCommand(repository, tab);
  await vi.waitFor(() => expect(mocks.stashWindow).toHaveBeenCalledOnce());
  await runStashCommand(repository, tab);
  expect(mocks.stashWindow).toHaveBeenCalledOnce();
  finish(null);
  await first;
});

it('accepts only valid messages from Deck pages and reports Undo errors', async () => {
  for (const invalid of [
    { ...sender, id: 'other' },
    { ...sender, url: 'https://example.com' },
    { id: sender.id, url: sender.url },
  ]) {
    expect(
      (await handleStashMessage(repository, { type: 'deck:stash' }, invalid))
        .error,
    ).toBeTruthy();
  }
  expect(
    (
      await handleStashMessage(
        repository,
        { type: 'deck:undo-stash', deckId: '!invalid' },
        sender,
      )
    ).error,
  ).toBeTruthy();
  expect(mocks.stashWindow).not.toHaveBeenCalled();
  expect(
    await handleStashMessage(repository, { type: 'deck:stash' }, sender),
  ).toEqual({ error: null });
  mocks.undoStash.mockRejectedValueOnce(new Error('window closed'));
  expect(
    await handleStashMessage(
      repository,
      { type: 'deck:undo-stash', deckId: 'session_test' },
      sender,
    ),
  ).toEqual({ error: 'window closed' });
});
