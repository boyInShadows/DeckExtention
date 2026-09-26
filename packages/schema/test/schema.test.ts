import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';

import {
  CardSchema,
  DeckSchema,
  OpSchema,
  PageSchema,
  SCHEMA_VERSION,
  SETTINGS_DEFAULTS,
  SettingsSchema,
  SnapshotSchema,
} from '../src/index';

import invalidFixtures from './fixtures/invalid.json';
import validFixtures from './fixtures/valid.json';

const SCHEMAS: Record<string, ZodType> = {
  Page: PageSchema,
  Deck: DeckSchema,
  Card: CardSchema,
  Settings: SettingsSchema,
  Op: OpSchema,
  Snapshot: SnapshotSchema,
};

describe('valid fixtures parse', () => {
  it('parses a Page', () => {
    expect(PageSchema.parse(validFixtures.page)).toEqual(validFixtures.page);
  });

  it('parses an inbox Deck and a session Deck with expiresAt', () => {
    expect(DeckSchema.parse(validFixtures.deck).kind).toBe('inbox');
    const session = DeckSchema.parse(validFixtures.sessionDeck);
    expect(session.kind).toBe('session');
    expect(session.expiresAt).toBe(1759592000000);
  });

  it('parses a Card with note, done and a pinned flag', () => {
    const card = CardSchema.parse(validFixtures.card);
    expect(card.pinned).toBe(true);
    expect(card.done).toBe(false);
    expect(card.lastOpenedAt).toBeNull();
  });

  it('accepts a chrome:// card, which has no fetchable metadata', () => {
    expect(CardSchema.parse(validFixtures.minimalCard).url).toBe(
      'chrome://extensions/shortcuts',
    );
  });

  it('parses Settings and its shipped defaults', () => {
    expect(SettingsSchema.parse(validFixtures.settings).theme).toBe('night');
    expect(SettingsSchema.parse(SETTINGS_DEFAULTS)).toEqual(SETTINGS_DEFAULTS);
  });

  it('parses an upsert Op and a delete Op', () => {
    const upsert = OpSchema.parse(validFixtures.op);
    expect(upsert.entity).toBe('card');
    expect(upsert.payload).not.toBeNull();
    expect(OpSchema.parse(validFixtures.deleteOp).payload).toBeNull();
  });

  it('parses a Snapshot at the current schema version', () => {
    const snapshot = SnapshotSchema.parse(validFixtures.snapshot);
    expect(snapshot.schemaVersion).toBe(SCHEMA_VERSION);
    expect(JSON.parse(snapshot.blob)).toEqual({
      pages: [],
      decks: [],
      cards: [],
    });
  });

  it('round-trips one fixture per schema through JSON unchanged', () => {
    const byKey: Record<string, unknown> = {
      Page: validFixtures.page,
      Deck: validFixtures.deck,
      Card: validFixtures.card,
      Settings: validFixtures.settings,
      Op: validFixtures.op,
      Snapshot: validFixtures.snapshot,
    };

    for (const [name, schema] of Object.entries(SCHEMAS)) {
      const parsed = schema.parse(byKey[name]);
      expect(JSON.parse(JSON.stringify(parsed)), name).toEqual(parsed);
    }
  });
});

describe('invalid fixtures are rejected', () => {
  for (const [index, fixture] of invalidFixtures.entries()) {
    it(`rejects ${fixture.schema} #${index}: ${fixture.reason}`, () => {
      const schema = SCHEMAS[fixture.schema];
      if (!schema) {
        throw new Error(`fixture names an unknown schema: ${fixture.schema}`);
      }
      expect(schema.safeParse(fixture.value).success).toBe(false);
    });
  }

  it('covers every schema with at least one rejection case', () => {
    const covered = new Set(invalidFixtures.map((fixture) => fixture.schema));
    for (const name of Object.keys(SCHEMAS)) {
      expect(covered.has(name), `${name} has no negative fixture`).toBe(true);
    }
  });
});

describe('defaults are the zero-setup-tax state', () => {
  it('defaults to Night with no greeting name and no wallpaper', () => {
    expect(SETTINGS_DEFAULTS.theme).toBe('night');
    expect(SETTINGS_DEFAULTS.ownerName).toBe('');
    expect(SETTINGS_DEFAULTS.wallpaper).toEqual({ kind: 'none' });
    expect(SETTINGS_DEFAULTS.canSpaceOpenDrawer).toBe(true);
  });
});
