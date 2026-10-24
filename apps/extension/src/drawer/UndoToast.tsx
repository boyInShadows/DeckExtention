export interface UndoAction {
  label: string;
  undo: () => Promise<void>;
}
