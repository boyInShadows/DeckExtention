import type { Settings } from 'deck-schema';

let language: Settings['language'] = 'en';

export const LANGUAGE_MESSAGE = 'deck:language';

export const getLanguage = (): Settings['language'] => language;
export const getLocale = (): string | undefined =>
  language === 'fa' ? 'fa-IR' : undefined;

export function setLanguage(value: Settings['language']): void {
  language = value;
}

export function applyDocumentLanguage(value: Settings['language']): void {
  setLanguage(value);
  document.documentElement.lang = value;
  document.documentElement.dir = value === 'fa' ? 'rtl' : 'ltr';
}

/** Existing imports read the active catalog, including after a settings change. */
export function createCatalog<Catalog extends object>(
  english: Catalog,
  persian: Catalog,
): Catalog {
  return new Proxy(english, {
    get: (_target, key) =>
      Reflect.get(language === 'fa' ? persian : english, key),
  });
}
