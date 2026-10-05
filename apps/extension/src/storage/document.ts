import {
  CardSchema,
  DeckSchema,
  PageSchema,
  SCHEMA_VERSION,
  SettingsSchema,
  type Card,
  type Deck,
  type Page,
  type Settings,
} from 'deck-schema';
import { z } from 'zod';

export const DeckDocumentSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  exportedAt: z.number().int().nonnegative(),
  pages: z.array(PageSchema),
  decks: z.array(DeckSchema),
  cards: z.array(CardSchema),
  settings: SettingsSchema,
});

export type DeckDocument = {
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: number;
  pages: Page[];
  decks: Deck[];
  cards: Card[];
  settings: Settings;
};

export function parseDocument(value: unknown): DeckDocument {
  return DeckDocumentSchema.parse(value);
}

export function parseDocumentJson(json: string): DeckDocument {
  return parseDocument(JSON.parse(json) as unknown);
}

export function serializeDocument(document: DeckDocument): string {
  return JSON.stringify(parseDocument(document));
}
