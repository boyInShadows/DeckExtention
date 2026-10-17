import {
  CardSchema,
  DeckSchema,
  PageSchema,
  SETTINGS_DEFAULTS,
  SettingsSchema,
} from 'deck-schema';
import { describe, expect, it } from 'vitest';

import { isCard, isDeck, isPage, isSettings } from './hydrationValidation';

const page = {
  id: 'page_test',
  title: 'Work',
  order: 'a0',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const deck = {
  ...page,
  id: 'deck_test',
  pageId: page.id,
  kind: 'normal',
  color: null,
  isCollapsed: false,
};
const card = {
  ...page,
  id: 'card_test',
  deckId: deck.id,
  url: 'https://example.com/',
  hostname: 'example.com',
  pinned: false,
  lastOpenedAt: null,
};

describe('warm hydration guards', () => {
  it.each([
    [PageSchema, isPage, page],
    [PageSchema, isPage, { ...page, title: 42 }],
    [PageSchema, isPage, { ...page, unexpected: true }],
    [DeckSchema, isDeck, deck],
    [DeckSchema, isDeck, { ...deck, color: 'bad token' }],
    [DeckSchema, isDeck, { ...deck, note: 42 }],
    [CardSchema, isCard, card],
    [CardSchema, isCard, { ...card, url: 'ftp://files.test/x' }],
    [CardSchema, isCard, { ...card, url: 'not a URL' }],
    [CardSchema, isCard, { ...card, lastOpenedAt: -1 }],
    [CardSchema, isCard, { ...card, pinIcon: 'x'.repeat(17) }],
    [SettingsSchema, isSettings, SETTINGS_DEFAULTS],
    [SettingsSchema, isSettings, { ...SETTINGS_DEFAULTS, ownerName: 42 }],
    [
      SettingsSchema,
      isSettings,
      {
        ...SETTINGS_DEFAULTS,
        keymap: [{ action: 'blur', chord: 'b', extra: true }],
      },
    ],
    [
      SettingsSchema,
      isSettings,
      {
        ...SETTINGS_DEFAULTS,
        wallpaper: { kind: 'color', token: 'bad token' },
      },
    ],
  ] as const)('agrees with full schema for %#', (schema, guard, value) => {
    expect(guard(value)).toBe(schema.safeParse(value).success);
  });
});
