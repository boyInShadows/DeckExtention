import { EventEmitter } from 'node:events';
import type { CDPSession } from '@playwright/test';
import { expect, it, vi } from 'vitest';

import { observeStartupScripts } from '../e2e/startupScripts';

function fixture(sourceError: unknown) {
  const events = new EventEmitter();
  const profile = { samples: [1], nodes: [] };
  const send = vi.fn(async (method: string, args?: { scriptId: string }) => {
    if (method === 'Profiler.stop') return { profile };
    if (method !== 'Debugger.getScriptSource') return {};
    if (args?.scriptId === '62') throw sourceError;
    return { scriptSource: 'InjectedScript createStacklessError' };
  });
  const session = { on: events.on.bind(events), send } as unknown as CDPSession;
  return { events, profile, send, session };
}

it('retains a retired script and its source error without losing the CPU profile or claiming a classification', async () => {
  const error = new Error(
    'cdpSession.send: Protocol error (Debugger.getScriptSource): No script for id: 62',
  );
  const { events, profile, session } = fixture(error);
  const observer = await observeStartupScripts(session);
  await observer.start();
  events.emit('Debugger.scriptParsed', {
    scriptId: '62',
    url: 'chrome-extension://deck/index.js',
    hash: 'retired',
    executionContextId: 2,
  });
  events.emit('Debugger.scriptParsed', {
    scriptId: '63',
    url: '',
    hash: 'injected',
    executionContextId: 3,
  });
  const result = await observer.stop();
  expect(result.profile).toBe(profile);
  expect(result.metadata).toEqual([
    expect.objectContaining({
      scriptId: '62',
      isDeck: true,
      sourceError: error.message,
      isPlaywrightInjected: null,
    }),
    expect.objectContaining({
      scriptId: '63',
      sourceError: null,
      isPlaywrightInjected: true,
    }),
  ]);
});

it('still rejects unexpected source-read failures', async () => {
  const error = new Error('Connection closed');
  const { events, session } = fixture(error);
  const observer = await observeStartupScripts(session);
  await observer.start();
  events.emit('Debugger.scriptParsed', {
    scriptId: '62',
    url: '',
    hash: '',
    executionContextId: 2,
  });
  await expect(observer.stop()).rejects.toBe(error);
});
