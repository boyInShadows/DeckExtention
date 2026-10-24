import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpenTabsState } from './openTabs';
import type { observeOpenTabs } from './observeOpenTabs';

const EMPTY: OpenTabsState = { hasAccess: false, tabs: [] };

export function useOpenTabs(
  isEnabled: boolean,
  onError: (message: string) => void,
) {
  const [state, setState] = useState({ isEnabled, value: EMPTY });
  if (state.isEnabled !== isEnabled) setState({ isEnabled, value: EMPTY });
  const observer = useRef<ReturnType<typeof observeOpenTabs> | null>(null);
  useEffect(() => {
    if (!isEnabled || typeof chrome === 'undefined') return;
    let isCurrent = true;
    void import('./observeOpenTabs')
      .then((module) => {
        if (isCurrent)
          observer.current = module.observeOpenTabs(
            (value) => setState({ isEnabled, value }),
            (error) => onError(String(error)),
          );
      })
      .catch((error) => {
        if (isCurrent) onError(String(error));
      });
    return () => {
      isCurrent = false;
      observer.current?.stop();
      observer.current = null;
    };
  }, [isEnabled, onError]);
  const refresh = useCallback(async () => {
    await observer.current?.refresh();
  }, []);
  return { ...(isEnabled && state.isEnabled ? state.value : EMPTY), refresh };
}
