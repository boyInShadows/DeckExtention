import { generateKeyBetween } from 'fractional-indexing';

import { compareOrder } from './workspaceModel';

export function fractionalOrderForMove<T extends { id: string; order: string }>(
  records: T[],
  activeId: string,
  overId?: string,
): string {
  const ordered = records.toSorted((left, right) =>
    compareOrder(left.order, right.order),
  );
  const siblings = ordered.filter(({ id }) => id !== activeId);
  if (!overId) return keyAt(siblings, siblings.length);
  const index = siblings.findIndex(({ id }) => id === overId);
  if (index < 0) return keyAt(siblings, siblings.length);
  const activeIndex = ordered.findIndex(({ id }) => id === activeId);
  const isMovingForward =
    activeIndex >= 0 &&
    activeIndex < ordered.findIndex(({ id }) => id === overId);
  return keyAt(siblings, index + Number(isMovingForward));
}

function keyAt<T extends { order: string }>(siblings: T[], index: number) {
  return generateKeyBetween(
    siblings[index - 1]?.order ?? null,
    siblings[index]?.order ?? null,
  );
}
