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

export function searchCards<T extends SearchableCard>(
  cards: T[],
  query: string,
): T[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return cards.filter((card) => {
    const haystack =
      `${card.title} ${card.hostname} ${card.note ?? ''}`.toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
