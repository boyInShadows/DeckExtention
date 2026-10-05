import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common';

/**
 * A daily full backup (MasterPlan I8, section 4). `blob` is the serialised JSON
 * document rather than a nested object so that a snapshot can be restored, and
 * exported, even when the live schema has moved on - `schemaVersion` says which
 * migration path to take. This is the record that makes "upgrade wiped my
 * links" structurally impossible.
 */
export const SnapshotSchema = z.strictObject({
  id: IdSchema,
  ts: TimestampSchema,
  schemaVersion: z.number().int().positive(),
  blob: z.string().min(1),
});

export type Snapshot = z.infer<typeof SnapshotSchema>;
