import { strings } from '../i18n/strings';

export interface SearchableCard {
  id: string;
  title: string;
  hostname: string;
  note?: string | undefined;
}

export function greetingForHour(hour: number): string {
  if (hour < 12) return strings.greetingMorning;
  if (hour < 18) return strings.greetingAfternoon;
  return strings.greetingEvening;
}

export function shouldSpaceOpenDrawer(
  key: string,
  value: string,
  isEnabled: boolean,
): boolean {
  return isEnabled && key === ' ' && value.length === 0;
}

export function searchCards<T extends SearchableCard>(
  cards: T[],
  query: string,
): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  const isExact = normalized.startsWith('"');
  const terms = normalized.replaceAll('"', '').split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return cards
    .map((card) => {
      const title = card.title.toLocaleLowerCase();
      const haystack =
        `${title} ${card.hostname} ${card.note ?? ''}`.toLocaleLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return null;
      const score = isExact
        ? haystack.includes(terms.join(' '))
          ? 1
          : 0
        : terms.reduce(
            (total, term) =>
              total +
              (title.startsWith(term) ? 100 : 0) +
              (title.split(/\s+/).some((word) => word.startsWith(term))
                ? 50
                : 0) +
              10,
            0,
          );
      return score > 0 ? { card, score } : null;
    })
    .filter((result): result is { card: T; score: number } => result !== null)
    .toSorted((a, b) => b.score - a.score)
    .map(({ card }) => card);
}
