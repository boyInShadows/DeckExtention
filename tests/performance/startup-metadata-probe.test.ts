import { afterEach, expect, it, vi } from 'vitest';

import { observeStartupMetadata } from '../e2e/startupMetadata';
import type { StartupProfile } from '../e2e/startupProbe';

function fixture() {
  const databases = vi.fn(() => Promise.resolve([]));
  class Factory {
    databases() {
      return databases();
    }
  }
  const factory = new Factory();
  const get = vi.fn<(...args: unknown[]) => unknown>();
  const local = { get };
  const state = {
    __deckStartupProfile: undefined as StartupProfile | undefined,
  };
  vi.stubGlobal('IDBFactory', Factory);
  vi.stubGlobal('indexedDB', factory);
  vi.stubGlobal('chrome', { storage: { local } });
  vi.stubGlobal('window', state);
  return { databases, factory, get, local, state };
}

afterEach(() => vi.unstubAllGlobals());

it('records metadata completion without replacing promises or receiver', async () => {
  const { databases, factory, get, local, state } = fixture();
  const listed = Promise.resolve([]);
  const stored = Promise.resolve({ fixture: true });
  databases.mockReturnValue(listed);
  get.mockReturnValue(stored);
  observeStartupMetadata();
  expect(factory.databases()).toBe(listed);
  expect(local.get('key')).toBe(stored);
  await Promise.all([listed, stored]);
  expect(get.mock.contexts[0]).toBe(local);
  expect(get).toHaveBeenCalledWith('key');
  expect(state.__deckStartupProfile?.spans).toMatchObject([
    { kind: 'metadata:databases', isFailure: false },
    { kind: 'metadata:storage', isFailure: false },
  ]);
});

it('records both rejections while callers receive the original errors', async () => {
  const { databases, factory, get, local, state } = fixture();
  const error = new Error('metadata unavailable');
  const listed = Promise.reject(error);
  const stored = Promise.reject(error);
  databases.mockReturnValue(listed);
  get.mockReturnValue(stored);
  observeStartupMetadata();
  expect(factory.databases()).toBe(listed);
  expect(local.get('key')).toBe(stored);
  await expect(listed).rejects.toBe(error);
  await expect(stored).rejects.toBe(error);
  expect(state.__deckStartupProfile?.spans).toMatchObject([
    { kind: 'metadata:databases', isFailure: true },
    { kind: 'metadata:storage', isFailure: true },
  ]);
});

it('forwards callback arguments and the native void result', () => {
  const { get, local, state } = fixture();
  const callback = vi.fn();
  get.mockImplementation((...args) => {
    expect(args).toEqual(['key', callback]);
    callback({ fixture: true });
  });
  observeStartupMetadata();
  expect(local.get('key', callback)).toBeUndefined();
  expect(callback).toHaveBeenCalledWith({ fixture: true });
  expect(state.__deckStartupProfile?.spans).toEqual([]);
});

it('preserves synchronous native failures', () => {
  const { get, local } = fixture();
  const error = new Error('invalid arguments');
  get.mockImplementation(() => {
    throw error;
  });
  observeStartupMetadata();
  expect(() => local.get('key')).toThrow(error);
});
