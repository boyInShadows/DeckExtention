import { useCallback, useEffect } from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import { isTypingTarget } from '../keys/keymap';

const UNDO_DURATION_MS = 6_000;

export interface UndoAction {
  label: string;
  undo: () => Promise<void>;
}

export default function UndoToast({
  action,
  onDismiss,
  onError,
}: {
  action: UndoAction;
  onDismiss: (value: null) => void;
  onError: (message: string) => void;
}) {
  const run = useCallback(async () => {
    onDismiss(null);
    try {
      await action.undo();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      onError(`${strings.updateFailed} ${detail}`);
    }
  }, [action, onDismiss, onError]);

  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(null), UNDO_DURATION_MS);
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 'z' ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        isTypingTarget(event.target)
      )
        return;
      event.preventDefault();
      void run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onDismiss, run]);

  return (
    <div data-deck="undo-toast" role="status" className="deck-undo-toast">
      <span>{action.label}</span>
      <button type="button" onClick={() => void run()}>
        {strings.undo}
      </button>
    </div>
  );
}
