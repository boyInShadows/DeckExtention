import type { Card } from 'deck-schema';

import { parseDragId } from '../drawer/dragIdentity';
import { fractionalOrderForMove } from '../drawer/fractionalOrder';
import type { WorkspaceDropDetail } from '../drawer/WorkspaceDnd';
import type { SurfaceData } from './bootstrap';

export async function reorderPin(
  repository: SurfaceData['repository'],
  pins: Card[],
  { activeId, overId }: WorkspaceDropDetail,
): Promise<Card | null> {
  const active = parseDragId(activeId);
  const over = parseDragId(overId);
  if (active?.entity !== 'pin' || over?.entity !== 'pin') return null;
  const moved = pins.find(({ id }) => id === active.id);
  if (!moved) return null;
  return repository.upsertCard({
    ...moved,
    order: fractionalOrderForMove(pins, active.id, over.id),
    updatedAt: Date.now(),
  });
}
