import { z } from 'zod';
import { CardSchema } from './card';
import { IdSchema, TimestampSchema } from './common';
import { DeckSchema } from './deck';
import { PageSchema } from './page';
import { SettingsSchema } from './settings';

/**
 * Every write appends an Op (MasterPlan I8). The oplog is what a snapshot is
 * replayed onto and, later, what sync ships. It is append-only: ops are never
 * rewritten, which is why the payload is a whole record rather than a patch.
 */
export const OpKindSchema = z.enum(['upsert', 'delete', 'restore']);

export const OpEntitySchema = z.enum(['page', 'deck', 'card', 'settings']);

const opFields = {
  id: IdSchema,
  ts: TimestampSchema,
  kind: OpKindSchema,
  /** Which machine wrote it. Meaningless until sync (P4), stable from day one. */
  clientId: IdSchema,
} as const;

/**
 * Discriminating on `entity` is what stops a Page payload being filed as a
 * Card. `payload` is null for delete and restore, where the id is enough.
 */
const entityOp = <TEntity extends string, TSchema extends z.ZodType>(
  entity: TEntity,
  payload: TSchema,
) =>
  z.strictObject({
    ...opFields,
    entity: z.literal(entity),
    entityId: IdSchema,
    payload: payload.nullable(),
  });

/** Settings is a singleton, so its "id" is the fixed key below. */
export const SETTINGS_ENTITY_ID = 'settings';

export const OpSchema = z
  .discriminatedUnion('entity', [
    entityOp('page', PageSchema),
    entityOp('deck', DeckSchema),
    entityOp('card', CardSchema),
    entityOp('settings', SettingsSchema),
  ])
  .superRefine((op, ctx) => {
    if (op.kind === 'upsert' && op.payload === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload'],
        message: 'an upsert op must carry the record it wrote',
      });
    }
  });

export type OpKind = z.infer<typeof OpKindSchema>;
export type OpEntity = z.infer<typeof OpEntitySchema>;
export type Op = z.infer<typeof OpSchema>;
