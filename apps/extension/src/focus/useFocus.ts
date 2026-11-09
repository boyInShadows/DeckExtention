import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { panelStrings as strings } from '../i18n/panelStrings';
import type { DeckRepository } from '../storage/repository';
import {
  FOCUS_CHANNEL,
  focusElapsed,
  type FocusAction,
  type FocusState,
} from './model';

type Change = (action: FocusAction) => Promise<FocusState>;
type Report = (error: unknown) => void;

function useFocusEvents(
  refresh: () => void,
  revision: MutableRefObject<number>,
) {
  useEffect(() => {
    const onReturn = () => {
      if (!document.hidden) refresh();
    };
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(FOCUS_CHANNEL);
    channel?.addEventListener('message', onReturn);
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    refresh();
    return () => {
      revision.current += 1;
      channel?.close();
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [refresh, revision]);
}

function useFocusCommand(change: Change, report: Report) {
  const pending = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const run = useCallback(
    async (action: FocusAction) => {
      if (pending.current) return;
      pending.current = true;
      setIsSaving(true);
      try {
        await change(action);
      } catch (error) {
        report(error);
      } finally {
        pending.current = false;
        setIsSaving(false);
      }
    },
    [change, report],
  );
  return { isSaving, run };
}

export function useFocus(
  repository: Pick<DeckRepository, 'changeFocus'>,
  onError: (message: string) => void,
) {
  const [state, setState] = useState<FocusState | null>(null);
  const revision = useRef(0);
  const report = useCallback(
    (error: unknown) => {
      onError(
        `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`,
      );
    },
    [onError],
  );
  const change = useCallback(
    async (action: FocusAction) => {
      const request = ++revision.current;
      const next = await repository.changeFocus(action);
      if (request === revision.current) setState(next);
      return next;
    },
    [repository],
  );
  const refresh = useCallback(() => {
    void change({ type: 'sync' }).catch(report);
  }, [change, report]);
  useFocusEvents(refresh, revision);
  useEffect(() => {
    const active = state?.active;
    if (!active || active.runningSince === null) return;
    const timer = window.setTimeout(
      refresh,
      active.durationMs - focusElapsed(active, Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [state?.active, refresh]);
  return { state, ...useFocusCommand(change, report) };
}
