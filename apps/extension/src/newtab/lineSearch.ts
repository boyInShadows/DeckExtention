import { UrlSchema } from 'deck-schema';

export interface SearchableCard {
  id: string;
  title: string;
  hostname: string;
  note?: string | undefined;
}

export interface SearchResults<T> {
  cards: T[];
  notes: { card: T; snippet: string }[];
  url: string | null;
}

const MIN_FUZZY_TERM = 3;
const MIN_FUZZY_MATCH = 0.5;
const TRIGRAM_LENGTH = 3;
const TITLE_PREFIX_SCORE = 100;
const WORD_PREFIX_SCORE = 50;
const SUBSTRING_SCORE = 10;
const NOTE_CONTEXT_CHARS = 20;
const NOTE_SNIPPET_CHARS = 100;

interface IndexedEntry<T> {
  card: T;
  title: string;
  address: string;
  note: string;
  grams: Set<string>;
}

export function parseLineUrl(input: string): string | null {
  const value = input.trim();
  if (!value || /\s/.test(value)) return null;
  const hasScheme = /^https?:\/\//i.test(value);
  try {
    const url = new URL(hasScheme ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (
      !hasScheme &&
      !url.hostname.includes('.') &&
      url.hostname !== 'localhost'
    )
      return null;
    const parsed = UrlSchema.safeParse(url.href);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function trigrams(value: string): Set<string> {
  const found = new Set<string>();
  for (let index = 0; index <= value.length - TRIGRAM_LENGTH; index += 1)
    found.add(value.slice(index, index + TRIGRAM_LENGTH));
  return found;
}

function scoreAddress<T>(
  entry: IndexedEntry<T>,
  terms: string[],
  isExact: boolean,
): number {
  if (isExact && !entry.address.includes(terms.join(' '))) return -Infinity;
  return terms.reduce((total, term) => {
    if (entry.address.includes(term)) {
      if (entry.title.startsWith(term)) return total + TITLE_PREFIX_SCORE;
      if (entry.title.split(/\s+/).some((word) => word.startsWith(term)))
        return total + WORD_PREFIX_SCORE;
      return total + SUBSTRING_SCORE;
    }
    if (isExact || term.length < MIN_FUZZY_TERM) return -Infinity;
    const grams = trigrams(term);
    const count = [...grams].filter((gram) => entry.grams.has(gram)).length;
    return count / grams.size >= MIN_FUZZY_MATCH ? total + count : -Infinity;
  }, 0);
}

export function buildSearchIndex<T extends SearchableCard>(cards: T[]) {
  const entries = cards.map((card) => {
    const title = card.title.toLowerCase();
    const hostname = card.hostname.toLowerCase();
    return {
      card,
      title,
      address: `${title} ${hostname}`,
      note: (card.note ?? '').toLowerCase(),
      grams: trigrams(`${title} ${hostname}`),
    };
  });
  return (query: string): SearchResults<T> => {
    const normalized = query.trim().toLowerCase();
    const isExact = normalized.startsWith('"');
    const terms = normalized.replaceAll('"', '').split(/\s+/).filter(Boolean);
    if (!terms.length) return { cards: [], notes: [], url: null };
    const matches = entries.map((entry) => {
      const cardScore = scoreAddress(entry, terms, isExact);
      const noteMatch = isExact
        ? entry.note.includes(terms.join(' '))
        : terms.every((term) => entry.note.includes(term));
      return { entry, cardScore, noteMatch };
    });
    const foundCards = matches
      .filter(({ cardScore }) => cardScore > 0)
      .toSorted((a, b) => b.cardScore - a.cardScore)
      .map(({ entry }) => entry.card);
    const foundNotes = matches
      .filter(({ noteMatch }) => noteMatch)
      .map(({ entry }) => {
        const note = entry.card.note ?? '';
        const start = Math.max(
          0,
          entry.note.indexOf(terms[0] ?? '') - NOTE_CONTEXT_CHARS,
        );
        return {
          card: entry.card,
          snippet: note.slice(start, start + NOTE_SNIPPET_CHARS),
        };
      });
    return { cards: foundCards, notes: foundNotes, url: parseLineUrl(query) };
  };
}

export function searchCards<T extends SearchableCard>(
  cards: T[],
  query: string,
): T[] {
  const result = buildSearchIndex(cards)(query);
  return [
    ...new Map(
      [...result.cards, ...result.notes.map(({ card }) => card)].map((card) => [
        card.id,
        card,
      ]),
    ).values(),
  ];
}
