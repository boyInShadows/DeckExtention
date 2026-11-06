import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GOOGLE_SUGGESTIONS_ORIGIN,
  fetchGoogleSuggestions,
  suggestionQuery,
} from '../../apps/extension/src/search/googleSuggestions';

const request = vi.fn<typeof fetch>();
const contains = vi.fn().mockResolvedValue(true);

beforeEach(() => {
  request.mockReset();
  contains.mockReset().mockResolvedValue(true);
  vi.stubGlobal('fetch', request);
  vi.stubGlobal('chrome', { permissions: { contains } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Google suggestions privacy boundary', () => {
  it('aborts slow requests at the bounded deadline', async () => {
    vi.useFakeTimers();
    request.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new Error('request aborted')),
            { once: true },
          );
        }),
    );
    const pending = fetchGoogleSuggestions(
      'new idea',
      new AbortController().signal,
    );
    const check = expect(pending).rejects.toThrow('request aborted');
    await vi.advanceTimersByTimeAsync(4_000);
    await check;
    expect(request).toHaveBeenCalledOnce();
  });
  it.each([
    '',
    'a',
    '>settings',
    ' >new deck private',
    'https://example.com/private',
    'example.com',
    'file:///private',
    'mail@example.com',
  ])('does not transmit %s', async (query) => {
    expect(suggestionQuery(query)).toBeNull();
    await expect(
      fetchGoogleSuggestions(query, new AbortController().signal),
    ).resolves.toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
  it('requires a current host grant', async () => {
    contains.mockResolvedValue(false);
    await expect(
      fetchGoogleSuggestions('new idea', new AbortController().signal),
    ).resolves.toEqual([]);
    expect(contains).toHaveBeenCalledWith({
      origins: [GOOGLE_SUGGESTIONS_ORIGIN],
    });
    expect(request).not.toHaveBeenCalled();
  });
  it('sends only the encoded query without credentials, referrer or redirects', async () => {
    request.mockResolvedValue(
      new Response(
        JSON.stringify([
          'کتاب',
          ['کتاب', 'کتاب خوب', 'کتاب خوب', 'کتاب تازه'],
          [],
          {},
        ]),
      ),
    );
    const suggestions = await fetchGoogleSuggestions(
      '?کتاب',
      new AbortController().signal,
    );
    expect(suggestions).toEqual(['کتاب خوب', 'کتاب تازه']);
    const [url, options] = request.mock.calls[0] ?? [];
    expect(new URL(String(url)).origin).toBe(
      'https://suggestqueries.google.com',
    );
    expect(new URL(String(url)).searchParams.get('q')).toBe('کتاب');
    expect(options).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  });
  it.each([
    ['wrong query', ['other query', ['result']]],
    ['not an array', { suggestions: ['result'] }],
    ['non-text suggestion', ['new idea', [42]]],
  ])('rejects %s', async (_label, payload) => {
    request.mockResolvedValue(new Response(JSON.stringify(payload)));
    await expect(
      fetchGoogleSuggestions('new idea', new AbortController().signal),
    ).rejects.toThrow();
  });
  it('bounds response size and suggestion count', async () => {
    request.mockResolvedValueOnce(new Response('x'.repeat(65_537)));
    await expect(
      fetchGoogleSuggestions('new idea', new AbortController().signal),
    ).rejects.toThrow();
    request.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          'new idea',
          Array.from({ length: 10 }, (_, index) => `option ${index}`),
        ]),
      ),
    );
    await expect(
      fetchGoogleSuggestions('new idea', new AbortController().signal),
    ).resolves.toHaveLength(5);
  });
  it('handles failed responses and already-aborted queries', async () => {
    request.mockResolvedValue(new Response('', { status: 503 }));
    await expect(
      fetchGoogleSuggestions('new idea', new AbortController().signal),
    ).rejects.toThrow();
    request.mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchGoogleSuggestions('new idea', controller.signal),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
