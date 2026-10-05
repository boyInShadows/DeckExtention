export type DragEntity = 'card' | 'deck' | 'page' | 'pin';

export interface DragIdentity {
  entity: DragEntity;
  id: string;
}

export function dragId(entity: DragEntity, id: string): string {
  return `${entity}:${id}`;
}

export function parseDragId(value: string | number): DragIdentity | null {
  const [entity, ...parts] = String(value).split(':');
  const id = parts.join(':');
  if (!id || !isDragEntity(entity)) return null;
  return { entity, id };
}

function isDragEntity(value: string | undefined): value is DragEntity {
  return (
    value === 'card' || value === 'deck' || value === 'page' || value === 'pin'
  );
}
