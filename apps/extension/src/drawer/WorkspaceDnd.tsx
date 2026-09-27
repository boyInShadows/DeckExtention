import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type CollisionDetection,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { ReactNode } from 'react';

export const WORKSPACE_DROP_EVENT = 'deck:drop';

export interface WorkspaceDropDetail {
  activeId: string | number;
  overId: string | number;
}

const PIN_DROP_ID = 'pin:drawer';

/**
 * Space lifts and drops (FableTasks P2.S3). dnd-kit also lifts on Enter by
 * default; that key opens the focused card instead (P2.S6).
 */
const KEYBOARD_DRAG_CODES = {
  start: ['Space'],
  cancel: ['Escape'],
  end: ['Space', 'Enter'],
};

const collisionDetection: CollisionDetection = (arguments_) => {
  const pointerCollisions = pointerWithin(arguments_);
  const rectangleCollisions = rectIntersection(arguments_);
  const pinCollision = [...pointerCollisions, ...rectangleCollisions].find(
    ({ id }) => id === PIN_DROP_ID,
  );
  if (pinCollision) return [pinCollision];
  return pointerCollisions.length ? pointerCollisions : rectangleCollisions;
};

export function WorkspaceDnd({ children }: { children: ReactNode }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: KEYBOARD_DRAG_CODES,
    }),
  );
  const finishDrag = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    window.dispatchEvent(
      new CustomEvent<WorkspaceDropDetail>(WORKSPACE_DROP_EVENT, {
        detail: { activeId: active.id, overId: over.id },
      }),
    );
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragEnd={finishDrag}
    >
      <div data-deck="dnd-root">{children}</div>
    </DndContext>
  );
}
