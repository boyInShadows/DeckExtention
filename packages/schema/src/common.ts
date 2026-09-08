import { z } from 'zod';

/**
 * Shared primitives. Every persisted record in Deck is built from these, so a
 * boundary check (imported JSON, restored snapshot, migrated record) never has
 * to trust a raw value. AGENTS.md section 6: validate at every boundary.
 */

/** Bumped whenever a persisted shape changes. Snapshots carry it. */
export const SCHEMA_VERSION = 1;

/** URL-safe ids (nanoid alphabet). Long enough for uuid v4 too. */
const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * `fractional-indexing` keys are alphanumeric over its base-62 charset. Storing
 * the key as an opaque string is what keeps a reorder from renumbering siblings.
 */
const ORDER_KEY_PATTERN = /^[0-9A-Za-z]{1,64}$/;

/** Design-token name, never a raw colour. Enforces AGENTS.md section 6. */
const TOKEN_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export const TITLE_MAX_LENGTH = 300;
export const URL_MAX_LENGTH = 4096;
export const NOTE_MAX_LENGTH = 20_000;
export const CUSTOM_CSS_MAX_LENGTH = 100_000;

export const IdSchema = z.string().regex(ID_PATTERN, 'invalid id');

export const OrderKeySchema = z
  .string()
  .regex(ORDER_KEY_PATTERN, 'invalid fractional index key');

export const TokenNameSchema = z
  .string()
  .regex(TOKEN_NAME_PATTERN, 'expected a design-token name, not a raw colour');

/** Epoch milliseconds. Integer so it survives JSON round trips unchanged. */
export const TimestampSchema = z
  .number()
  .int('timestamp must be an integer')
  .nonnegative('timestamp must not be negative');

export const TitleSchema = z.string().max(TITLE_MAX_LENGTH);

export const UrlSchema = z.url().max(URL_MAX_LENGTH);

export const NoteSchema = z.string().max(NOTE_MAX_LENGTH);

/**
 * Every entity is soft-deleted first and purged after 30 days (FableTasks
 * P1.S2), so a mis-click is always recoverable.
 */
export const softDeletableFields = {
  id: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  deletedAt: TimestampSchema.nullable(),
} as const;

export type Id = z.infer<typeof IdSchema>;
export type OrderKey = z.infer<typeof OrderKeySchema>;
export type Timestamp = z.infer<typeof TimestampSchema>;
