import { z } from 'zod';

import {
  GOOGLE_SUGGESTIONS_PERMISSION,
  MAX_SUGGESTIONS,
  QUERY_MAX_LENGTH,
  suggestionQuery,
} from './googleSuggestionPolicy';
export {
  GOOGLE_SUGGESTIONS_ORIGIN,
  suggestionQuery,
} from './googleSuggestionPolicy';
const RESPONSE_MAX_LENGTH = 65_536;
const REQUEST_TIMEOUT_MS = 4_000;
const QuerySchema = z.string().min(2).max(QUERY_MAX_LENGTH);
const ResponseSchema = z
  .tuple([
    z.string().max(QUERY_MAX_LENGTH),
    z.array(z.string().max(QUERY_MAX_LENGTH)).max(20),
  ])
  .rest(z.unknown());

// shortcut: Google's undocumented response format may change; submitted search remains the fallback.
export async function fetchGoogleSuggestions(
  raw: string,
  signal: AbortSignal,
): Promise<string[]> {
  const query = suggestionQuery(raw);
  if (!query) return [];
  QuerySchema.parse(query);
  signal.throwIfAborted();
  if (!(await chrome.permissions.contains(GOOGLE_SUGGESTIONS_PERMISSION)))
    return [];
  signal.throwIfAborted();
  return requestSuggestions(query, signal);
}

async function requestSuggestions(
  query: string,
  signal: AbortSignal,
): Promise<string[]> {
  const url = new URL('https://suggestqueries.google.com/complete/search');
  url.search = new URLSearchParams({
    client: 'firefox',
    q: query,
    ie: 'UTF-8',
    oe: 'UTF-8',
  }).toString();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, timeout.signal]),
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Google suggestions unavailable');
    return parseSuggestions(query, await response.text());
  } finally {
    clearTimeout(timer);
  }
}

function parseSuggestions(query: string, text: string): string[] {
  if (text.length > RESPONSE_MAX_LENGTH)
    throw new Error('Suggestions response too large');
  const [echo, suggestions] = ResponseSchema.parse(JSON.parse(text) as unknown);
  if (echo !== query) throw new Error('Suggestions query mismatch');
  return [
    ...new Set(
      suggestions
        .map((item) => item.trim())
        .filter((item) => item && item.toLowerCase() !== query.toLowerCase()),
    ),
  ].slice(0, MAX_SUGGESTIONS);
}
