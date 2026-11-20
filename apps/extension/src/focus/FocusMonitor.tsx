import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { DeckRepository } from '../storage/repository';
import { focusElapsed, type FocusEntry, type FocusState } from './model';
import { panelStrings as strings } from '../i18n/panelStrings';
import { useFocus } from './useFocus';
import { FocusProgress } from './FocusProgress';
import { formatFocusCountdown, useFocusNow } from './focusClock';
import './focusIndicator.css';

interface MonitorProps {
  repository: DeckRepository;
  onError: (message: string) => void;
  onComplete: (entry: FocusEntry) => void;
}

function useFocusCompletion(
  state: FocusState | null,
  { repository, onComplete, onError }: MonitorProps,
) {
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
}

export default function FocusMonitor(props: MonitorProps) {
  const { state } = useFocus(props.repository, props.onError);
  useFocusCompletion(state, props);
  const active = state?.active;
  const now = useFocusNow(Boolean(active && active.runningSince !== null));
  const slot = document.querySelector('[data-deck="focus-indicator-slot"]');
  if (!active || !slot) return null;
  const elapsed = focusElapsed(active, now);
  const remaining = formatFocusCountdown(active.durationMs - elapsed);
  const status =
    active.runningSince === null ? strings.focusPaused : strings.focusRunning;
  return createPortal(
    <span
      data-deck="focus-indicator"
      id="deck-focus-indicator"
      className="deck-focus-indicator"
      title={`${status} · ${remaining}`}
      aria-label={`${status} · ${remaining}`}
    >
      <span data-deck="focus-compact-countdown">{remaining}</span>
      <FocusProgress value={elapsed / active.durationMs} />
    </span>,
    slot,
  );
}
