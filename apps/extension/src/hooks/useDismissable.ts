import { useLayoutEffect, useRef, type RefObject } from 'react';

const active: symbol[] = [];

/** Dismiss the topmost panel and restore its trigger after Escape. */
export function useDismissable(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void | Promise<void>,
  returnFocus?: HTMLElement | (() => HTMLElement | null) | null,
  outside = true,
) {
  const latest = useRef(onDismiss);
  useLayoutEffect(() => {
    latest.current = onDismiss;
  }, [onDismiss]);

  useLayoutEffect(() => {
    const id = Symbol();
    active.push(id);
    const isTop = () => active.at(-1) === id;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isTop()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void Promise.resolve(latest.current()).then(() =>
        (typeof returnFocus === 'function'
          ? returnFocus()
          : returnFocus
        )?.focus(),
      );
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!outside || !isTop() || ref.current?.contains(event.target as Node))
        return;
      const anchor =
        typeof returnFocus === 'function' ? returnFocus() : returnFocus;
      if (anchor?.contains(event.target as Node)) return;
      void latest.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      active.splice(active.indexOf(id), 1);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [outside, ref, returnFocus]);
}
