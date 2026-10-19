import { IdSchema } from 'deck-schema';
import { z } from 'zod';
import { STASH_MESSAGE, UNDO_STASH_MESSAGE } from './constants';

export const StashMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal(STASH_MESSAGE) }),
  z.strictObject({ type: z.literal(UNDO_STASH_MESSAGE), deckId: IdSchema }),
]);
export const StashReplySchema = z.strictObject({
  error: z.string().nullable(),
});
export const StashNoticeSchema = z.strictObject({
  kind: z.enum(['success', 'error', 'info']),
  message: z.string(),
  deckId: IdSchema.optional(),
});
