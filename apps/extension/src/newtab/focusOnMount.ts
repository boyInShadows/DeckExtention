/**
 * Callback ref that focuses an element when it mounts: `ref={focusOnMount}`.
 *
 * Needed because the runtime is preact/compat (vite.config.ts): Preact passes
 * `autoFocus` through as the HTML `autofocus` attribute, which browsers honour
 * only once per page load. React focuses on mount; Preact does not. Without
 * this, keys meant for a freshly opened input land on whatever had focus -
 * in Inbox triage that turned a typed "x" into "trash these cards".
 *
 * Module-level on purpose: a stable function is called once on mount and once
 * (with null) on unmount, never on re-render.
 */
export function focusOnMount(element: HTMLElement | null): void {
  element?.focus();
}
