import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useState, type ReactNode } from 'react';

import { parseDragId } from './dragIdentity';

export const WORKSPACE_DROP_EVENT = 'deck:workspace-drop';

export interface WorkspaceDropDetail {
  activeId: string | number;
  overId: string | number;
}

export function WorkspaceDnd({ children }: { children: ReactNode }) {
  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const finishDrag = ({ active, over }: DragEndEvent) => {
    setIsDraggingCard(false);
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
      collisionDetection={closestCenter}
      onDragStart={({ active }) =>
        setIsDraggingCard(parseDragId(active.id)?.entity === 'card')
      }
      onDragCancel={() => setIsDraggingCard(false)}
      onDragEnd={finishDrag}
    >
      <div
        data-deck="dnd-root"
        className="deck-dnd-root"
        data-dragging-card={isDraggingCard || undefined}
      >
        {children}
      </div>
    </DndContext>
  );
}
