import type { DeckRepository } from '../storage/repository';
import type { BookmarkImportPlan } from './bookmarkPlan';

/** Records per transaction: small enough that the progress bar moves. */
export const IMPORT_CHUNK_SIZE = 200;

export interface ImportProgress {
  done: number;
  total: number;
}

/**
 * Writes a plan. Pages and decks go first so a card never points at a deck
 * that is not stored yet; then cards in chunks, reporting progress after each.
 *
 * Not one transaction on purpose: a bar that jumps 0 → 100 is not a progress
 * bar. The caller snapshots before calling, and the plan is idempotent, so an
 * interrupted import is finished by running it again.
 */
export async function applyBookmarkPlan(
  repository: Pick<DeckRepository, 'upsertMany'>,
  plan: BookmarkImportPlan,
  onProgress: (progress: ImportProgress) => void = () => undefined,
): Promise<void> {
  const total = plan.pages.length + plan.decks.length + plan.cards.length;
  let done = 0;
  onProgress({ done, total });
  if (plan.pages.length + plan.decks.length > 0) {
    await repository.upsertMany({ pages: plan.pages, decks: plan.decks });
    done += plan.pages.length + plan.decks.length;
    onProgress({ done, total });
  }
  for (let start = 0; start < plan.cards.length; start += IMPORT_CHUNK_SIZE) {
    const cards = plan.cards.slice(start, start + IMPORT_CHUNK_SIZE);
    await repository.upsertMany({ cards });
    done += cards.length;
    onProgress({ done, total });
  }
}
