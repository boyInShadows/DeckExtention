import { useEffect, useLayoutEffect, useState } from 'react';

import {
  GOOGLE_SUGGESTIONS_ORIGIN,
  GOOGLE_SUGGESTIONS_PERMISSION,
  suggestionQuery,
} from './googleSuggestionPolicy';

type Access = 'off' | 'on' | 'unavailable';
type Suggestions = { query: string; items: string[]; isUnavailable: boolean };
const DEBOUNCE_MS = 100;

export function useGoogleAccess(isActive = true): Access {
  const [access, setAccess] = useState<Access>('off');
  useEffect(() => {
    if (!isActive || typeof chrome === 'undefined') return;
    let isCurrent = true;
    let revision = 0;
    const refresh = () => {
      const current = ++revision;
      void chrome.permissions.contains(GOOGLE_SUGGESTIONS_PERMISSION).then(
        (granted) => {
          if (isCurrent && current === revision)
            setAccess(granted ? 'on' : 'off');
        },
        () => {
          if (isCurrent && current === revision) setAccess('unavailable');
        },
      );
    };
    refresh();
    chrome.permissions.onAdded.addListener(refresh);
    chrome.permissions.onRemoved.addListener(refresh);
    return () => {
      isCurrent = false;
      chrome.permissions.onAdded.removeListener(refresh);
      chrome.permissions.onRemoved.removeListener(refresh);
    };
  }, [isActive]);
  return access;
}

export function useGoogleSuggestions(
  raw: string,
  isFocused: boolean,
  isEnabled = true,
) {
  const query = suggestionQuery(raw);
  const access = useGoogleAccess(isEnabled && isFocused && Boolean(query));
  const [result, setResult] = useState<Suggestions>({
    query: '',
    items: [] as string[],
    isUnavailable: false,
  });
  useLayoutEffect(() => {
    if (!isEnabled || !query || !isFocused || access !== 'on') return;
    return observeSuggestions(query, setResult);
  }, [query, isFocused, access, isEnabled]);
  const isCurrent = isEnabled && access === 'on' && result.query === query;
  return {
    items: isCurrent ? result.items : [],
    isUnavailable:
      isEnabled &&
      Boolean(query) &&
      (access === 'unavailable' || (isCurrent && result.isUnavailable)),
  };
}

function observeSuggestions(
  query: string,
  onResult: (result: Suggestions) => void,
) {
  let isCurrent = true;
  const controller = new AbortController();
  const revoke = (removed: chrome.permissions.Permissions) => {
    if (!removed.origins?.includes(GOOGLE_SUGGESTIONS_ORIGIN)) return;
    controller.abort();
    onResult({ query: '', items: [], isUnavailable: false });
  };
  chrome.permissions.onRemoved.addListener(revoke);
  const timer = window.setTimeout(() => {
    void import('./googleSuggestions')
      .then(({ fetchGoogleSuggestions }) =>
        fetchGoogleSuggestions(query, controller.signal),
      )
      .then((items) => {
        if (isCurrent && !controller.signal.aborted)
          onResult({ query, items, isUnavailable: false });
      })
      .catch(() => {
        if (isCurrent && !controller.signal.aborted)
          onResult({ query, items: [], isUnavailable: true });
      });
  }, DEBOUNCE_MS);
  return () => {
    isCurrent = false;
    window.clearTimeout(timer);
    controller.abort();
    chrome.permissions.onRemoved.removeListener(revoke);
  };
}
