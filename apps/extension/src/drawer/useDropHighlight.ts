import { useDndContext } from '@dnd-kit/core';

export function useDropHighlight(id: string): boolean {
  const { collisions } = useDndContext();
  // Current collisions avoid waiting for dnd-kit's passive `over` state update.
  return collisions?.[0]?.id === id;
}
