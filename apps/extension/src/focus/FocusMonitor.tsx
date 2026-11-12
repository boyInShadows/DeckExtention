import { useEffect } from 'react';
import type { DeckRepository } from '../storage/repository';
import type { FocusEntry } from './model';
import { panelStrings as strings } from '../i18n/panelStrings';
import { useFocus } from './useFocus';

export default function FocusMonitor({
  repository,
  onError,
  onComplete,
}: {
  repository: DeckRepository;
  onError: (message: string) => void;
  onComplete: (entry: FocusEntry) => void;
}) {
  const { state } = useFocus(repository, onError);
  useEffect(() => {
    if (!state?.unreadId || document.hidden) return;
    void repository
      .takeFocusCompletion()
      .then((entry) => {
        if (entry) onComplete(entry);
      })
      .catch((error: unknown) => {
        onError(
          `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }, [state, repository, onComplete, onError]);
  return null;
}
