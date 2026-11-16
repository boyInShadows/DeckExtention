import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { isTypingTarget } from '../keys/keymap';

export function useDrawerFilter(
  mainRef: RefObject<HTMLElement | null>,
  isEnabled: boolean,
  pageId: string | null,
) {
  const [query, setQuery] = useState<string | null>(null);
  const [scope, setScope] = useState({ pageId, isEnabled });
  if (scope.pageId !== pageId || scope.isEnabled !== isEnabled) {
    setScope({ pageId, isEnabled });
    setQuery(null);
  }
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const previousCardId = useRef<string | null>(null);
  const focusFilter = useCallback((element: HTMLInputElement | null) => {
    inputRef.current = element;
    element?.focus();
  }, []);
  const reset = () => {
    setQuery(null);
    const target = previousFocus.current;
    requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
      else {
        const card = previousCardId.current
          ? mainRef.current?.querySelector<HTMLElement>(
              `[data-card-id="${CSS.escape(previousCardId.current)}"]`,
            )
          : null;
        (card ?? mainRef.current)?.focus();
      }
    });
  };
  useLayoutEffect(() => {
    if (!isEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (
        event.target instanceof Element &&
        event.target !== document.body &&
        !event.target.closest('[data-deck="drawer"]')
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="menu"], [role="dialog"]')
      )
        return;
      if (document.querySelector('[data-dragging]')) return;
      const isFilter = event.target === inputRef.current;
      if (isTypingTarget(event.target) && !isFilter) return;
      if (event.key === 'Escape' && query !== null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        reset();
      } else if (
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (query === null) {
          previousFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          previousCardId.current =
            previousFocus.current
              ?.closest('[data-card-id]')
              ?.getAttribute('data-card-id') ?? null;
          setQuery('');
        } else {
          inputRef.current?.focus();
          inputRef.current?.select();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });
  return { query, setQuery, focusFilter, reset };
}
