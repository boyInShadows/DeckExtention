import {
  CardSchema,
  DeckSchema,
  OpSchema,
  PageSchema,
  SettingsSchema,
  type Card,
  type Deck,
  type Op,
  type Page,
  type Settings,
} from 'deck-schema';
export { parseDocument } from './document';
export { migrateDocument } from './documentMigration';

export const parsePage = (value: Page): Page =>
  PageSchema.parse(structuredClone(value));
export const parseDeck = (value: Deck): Deck =>
  DeckSchema.parse(structuredClone(value));
export const parseCard = (value: Card): Card =>
  CardSchema.parse(structuredClone(value));
export const parseSettings = (value: Settings): Settings =>
  SettingsSchema.parse(structuredClone(value));
export const parseOps = (value: unknown): Op[] => OpSchema.array().parse(value);
