import { parseLineUrl } from '../newtab/lineSearch';

export const GOOGLE_SUGGESTIONS_ORIGIN = 'https://suggestqueries.google.com/*';
export const GOOGLE_SUGGESTIONS_PERMISSION = {
  origins: [GOOGLE_SUGGESTIONS_ORIGIN],
};
export const MAX_SUGGESTIONS = 5;
export const QUERY_MAX_LENGTH = 200;

export function suggestionQuery(raw: string): string | null {
  const query = raw.replace(/^\?/, '').trim();
  if (query.length < 2 || query.length > QUERY_MAX_LENGTH) return null;
  if (/^(?:>|[a-z][a-z\d+.-]*:|www\.)/i.test(query) || parseLineUrl(query))
    return null;
  return query;
}
