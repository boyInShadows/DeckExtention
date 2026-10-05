import { z } from 'zod';
import {
  IdSchema,
  NoteSchema,
  OrderKeySchema,
  TimestampSchema,
  TitleSchema,
  TokenNameSchema,
  softDeletableFields,
} from './common';

/**
 * `inbox` is the Quick Save landing deck (MasterPlan I3); `session` decks come
 * from `>stash` and expire (I4). Both are system decks the user cannot delete,
 * which is why the kind lives on the record rather than being inferred.
 */
export const DeckKindSchema = z.enum(['normal', 'inbox', 'session']);

export const DeckSchema = z.strictObject({
  ...softDeletableFields,
  pageId: IdSchema,
  title: TitleSchema,
  kind: DeckKindSchema,
  order: OrderKeySchema,
  /** Design-token name for the deck accent, or null for the default. */
  color: TokenNameSchema.nullable(),
  isCollapsed: z.boolean(),
  /** Deck-level markdown note, rendered above the deck's cards. */
  note: NoteSchema.optional(),
  /** Session decks self-clean after 30 days unless pinned (MasterPlan I4). */
  expiresAt: TimestampSchema.optional(),
});

export type DeckKind = z.infer<typeof DeckKindSchema>;
export type Deck = z.infer<typeof DeckSchema>;
