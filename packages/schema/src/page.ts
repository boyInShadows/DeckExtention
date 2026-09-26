import { z } from 'zod';
import { OrderKeySchema, TitleSchema, softDeletableFields } from './common';

/**
 * A Page is a vertical tab in the drawer's left rail (MasterPlan section 3.2).
 * Inbox and Sessions are system pages; they are Decks, not Pages, so a Page
 * carries no kind of its own.
 */
export const PageSchema = z.strictObject({
  ...softDeletableFields,
  title: TitleSchema,
  order: OrderKeySchema,
});

export type Page = z.infer<typeof PageSchema>;
