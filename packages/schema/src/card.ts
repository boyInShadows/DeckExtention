import { z } from 'zod';
import {
  IdSchema,
  NoteSchema,
  OrderKeySchema,
  TimestampSchema,
  TitleSchema,
  UrlSchema,
  softDeletableFields,
} from './common';

export const HOSTNAME_MAX_LENGTH = 253;

/**
 * A Card is a link that may also be a note and a task (MasterPlan I5).
 *
 * `hostname` is derived from `url` at write time, never fetched: titles default
 * to the hostname precisely so that saving a card costs zero network calls
 * (AGENTS.md section 3.2).
 */
export const CardSchema = z.strictObject({
  ...softDeletableFields,
  deckId: IdSchema,
  url: UrlSchema,
  title: TitleSchema,
  hostname: z.string().max(HOSTNAME_MAX_LENGTH),
  order: OrderKeySchema,
  /** Mirrored onto the surface's Pins strip. */
  pinned: z.boolean(),
  /** Surface-only label override; the saved-card title stays intact. */
  pinLabel: TitleSchema.optional(),
  /** Optional emoji used instead of the favicon tile. */
  pinIcon: z.string().max(16).optional(),
  /** Present only once the card has been used as a task. */
  done: z.boolean().optional(),
  note: NoteSchema.optional(),
  /** null means never opened - that is what Resurface selects on (I6). */
  lastOpenedAt: TimestampSchema.nullable(),
});

export type Card = z.infer<typeof CardSchema>;
