// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  render,
  createElement,
  click,
  type RenderResult,
} from '../../apps/extension/src/testing/render';
import { useGoogleSuggestions } from '../../apps/extension/src/search/useGoogleSuggestions';
import { GoogleSuggestionsSetting } from '../../apps/extension/src/search/GoogleSuggestionsSetting';
import { GOOGLE_SUGGESTIONS_ORIGIN } from '../../apps/extension/src/search/googleSuggestionPolicy';

const provider = vi.hoisted(() => ({ fetchGoogleSuggestions: vi.fn() }));
vi.mock('../../apps/extension/src/search/googleSuggestions', () => provider);

function event() {
  const handlers = new Set<(value: chrome.permissions.Permissions) => void>();
  return {
    addListener: (handler: (value: chrome.permissions.Permissions) => void) =>
      handlers.add(handler),
    removeListener: (
      handler: (value: chrome.permissions.Permissions) => void,
    ) => handlers.delete(handler),
    emit: () =>
      handlers.forEach((handler) =>
        handler({ origins: [GOOGLE_SUGGESTIONS_ORIGIN] }),
      ),
  };
}
let isGranted = false;
let added = event();
let removed = event();
let view: RenderResult | undefined;
const request = vi.fn();
const remove = vi.fn();

beforeEach(() => {
  isGranted = false;
  added = event();
  removed = event();
  provider.fetchGoogleSuggestions.mockReset().mockResolvedValue(['new idea']);
  request.mockReset().mockImplementation(async () => {
    isGranted = true;
    added.emit();
    return true;
  });
  remove.mockReset().mockImplementation(async () => {
    isGranted = false;
    removed.emit();
    return true;
  });
  vi.stubGlobal('chrome', {
    permissions: {
      contains: vi.fn(async () => isGranted),
      request,
      remove,
      onAdded: added,
      onRemoved: removed,
    },
  });
});
afterEach(() => {
  view?.unmount();
  view = undefined;
  vi.unstubAllGlobals();
});

function Probe({
  query,
  focused = true,
  enabled = true,
}: {
  query: string;
  focused?: boolean;
  enabled?: boolean;
}) {
  const result = useGoogleSuggestions(query, focused, enabled);
  return createElement(
    'p',
    null,
    result.items.join('|'),
    result.isUnavailable ? ':unavailable' : '',
  );
}

it('requests only the latest query after 100 ms without another keystroke', async () => {
  await import('../../apps/extension/src/search/googleSuggestions');
  vi.useFakeTimers();
  try {
    isGranted = true;
    view = await render(createElement(Probe, { query: 'old query' }));
    await view.act(() => vi.advanceTimersByTimeAsync(99));
    expect(provider.fetchGoogleSuggestions).not.toHaveBeenCalled();
    await view.rerender(createElement(Probe, { query: 'new query' }));
    await view.act(() => vi.advanceTimersByTimeAsync(99));
    expect(provider.fetchGoogleSuggestions).not.toHaveBeenCalled();
    await view.act(() => vi.advanceTimersByTimeAsync(1));
    expect(provider.fetchGoogleSuggestions).toHaveBeenCalledExactlyOnceWith(
      'new query',
      expect.any(AbortSignal),
    );
    expect(view.container.textContent).toBe('new idea');
  } finally {
    view?.unmount();
    view = undefined;
    vi.useRealTimers();
  }
});

it('makes no provider call without consent, while blurred, or for commands and URLs', async () => {
  view = await render(createElement(Probe, { query: 'private query' }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(provider.fetchGoogleSuggestions).not.toHaveBeenCalled();
  isGranted = true;
  for (const [query, focused] of [
    ['private query', false],
    ['>settings', true],
    ['https://example.com/private', true],
  ] as const) {
    await view.rerender(createElement(Probe, { query, focused }));
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(provider.fetchGoogleSuggestions).not.toHaveBeenCalled();
});

it('cancels stale queries and ignores a provider that resolves after abort', async () => {
  isGranted = true;
  let finishOld: (items: string[]) => void = () => undefined;
  provider.fetchGoogleSuggestions.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  view = await render(createElement(Probe, { query: 'old query' }));
  await vi.waitFor(() =>
    expect(provider.fetchGoogleSuggestions).toHaveBeenCalledTimes(1),
  );
  const signal = provider.fetchGoogleSuggestions.mock
    .calls[0]?.[1] as AbortSignal;
  await view.rerender(createElement(Probe, { query: 'new query' }));
  expect(signal.aborted).toBe(true);
  await vi.waitFor(() => expect(view?.container.textContent).toBe('new idea'));
  await view.act(async () => finishOld(['stale result']));
  expect(view.container.textContent).toBe('new idea');
  await view.act(() => {
    isGranted = false;
    removed.emit();
  });
  expect(view.container.textContent).toBe('');
});

it('aborts in-flight queries immediately on revocation and shows a quiet failure state', async () => {
  isGranted = true;
  provider.fetchGoogleSuggestions.mockReturnValueOnce(
    new Promise(() => undefined),
  );
  view = await render(createElement(Probe, { query: 'new query' }));
  await vi.waitFor(() =>
    expect(provider.fetchGoogleSuggestions).toHaveBeenCalledTimes(1),
  );
  const signal = provider.fetchGoogleSuggestions.mock
    .calls[0]?.[1] as AbortSignal;
  await view.act(() => {
    isGranted = false;
    removed.emit();
  });
  expect(signal.aborted).toBe(true);
  provider.fetchGoogleSuggestions.mockRejectedValue(new Error('offline'));
  await view.act(() => {
    isGranted = true;
    added.emit();
  });
  await vi.waitFor(() =>
    expect(view?.container.textContent).toBe(':unavailable'),
  );
});

it('stops in-flight work immediately when the preference is turned off', async () => {
  isGranted = true;
  provider.fetchGoogleSuggestions.mockReturnValue(new Promise(() => undefined));
  view = await render(createElement(Probe, { query: 'new query' }));
  await vi.waitFor(() =>
    expect(provider.fetchGoogleSuggestions).toHaveBeenCalledOnce(),
  );
  const signal = provider.fetchGoogleSuggestions.mock
    .calls[0]?.[1] as AbortSignal;
  await view.rerender(
    createElement(Probe, { query: 'new query', enabled: false }),
  );
  expect(signal.aborted).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(provider.fetchGoogleSuggestions).toHaveBeenCalledOnce();
  expect(view.container.textContent).toBe('');
});

it('uses the persisted preference without requesting or removing host access', async () => {
  const onChange = vi.fn();
  view = await render(
    createElement(GoogleSuggestionsSetting, { isEnabled: true, onChange }),
  );
  const checkbox = view.get<HTMLInputElement>('input');
  expect(checkbox.checked).toBe(true);
  await view.act(() => click(checkbox));
  expect(onChange).toHaveBeenCalledWith(false);
  await view.rerender(
    createElement(GoogleSuggestionsSetting, { isEnabled: false, onChange }),
  );
  expect(checkbox.checked).toBe(false);
  expect(request).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});
