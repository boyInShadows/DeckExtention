/**
 * Component test harness (happy-dom + Preact, the runtime the extension
 * ships). Test-only: nothing in the extension imports this folder, and it is
 * excluded from coverage.
 *
 * Usage, in a file starting with `// @vitest-environment happy-dom`:
 *
 *   const view = await render(<Pins ... />);
 *   await view.act(() => click(view.getByLabel('Add pin')));
 *   view.unmount();
 */
import type { ComponentChild } from 'preact';
import { render as preactRender } from 'preact';
import { act } from 'preact/test-utils';

export interface RenderResult {
  container: HTMLElement;
  /** Runs `work` and flushes Preact's effects and re-renders after it. */
  act: (work: () => void | Promise<void>) => Promise<void>;
  rerender: (ui: ComponentChild) => Promise<void>;
  unmount: () => void;
  query: <T extends Element = HTMLElement>(selector: string) => T | null;
  get: <T extends Element = HTMLElement>(selector: string) => T;
  getAll: <T extends Element = HTMLElement>(selector: string) => T[];
  /** The element whose accessible label (aria-label or text) is `label`. */
  getByLabel: <T extends Element = HTMLElement>(label: string) => T;
  getByText: <T extends Element = HTMLElement>(text: string) => T;
}

function labelOf(element: Element): string {
  return (
    element.getAttribute('aria-label') ??
    element.getAttribute('title') ??
    element.textContent ??
    ''
  ).trim();
}

export async function render(ui: ComponentChild): Promise<RenderResult> {
  const container = document.createElement('div');
  document.body.append(container);
  await act(() => {
    preactRender(ui, container);
  });

  const getAll = <T extends Element = HTMLElement>(selector: string): T[] => [
    ...container.querySelectorAll<T>(selector),
  ];
  const get = <T extends Element = HTMLElement>(selector: string): T => {
    const found = container.querySelector<T>(selector);
    if (!found) throw new Error(`No element matches ${selector}`);
    return found;
  };
  const findBy = <T extends Element>(
    predicate: (element: Element) => boolean,
    description: string,
  ): T => {
    const found = getAll<T>('*').find(predicate);
    if (!found) throw new Error(`No element ${description}`);
    return found;
  };

  return {
    container,
    act: async (work) => {
      await act(work);
    },
    rerender: async (next) => {
      await act(() => {
        preactRender(next, container);
      });
    },
    unmount: () => {
      preactRender(null, container);
      container.remove();
    },
    query: (selector) => container.querySelector(selector),
    get,
    getAll,
    getByLabel: (label) =>
      findBy(
        (element) =>
          element.getAttribute('aria-label') === label ||
          ((element instanceof HTMLButtonElement ||
            element instanceof HTMLAnchorElement) &&
            labelOf(element) === label),
        `labelled "${label}"`,
      ),
    getByText: (text) =>
      findBy(
        (element) =>
          element.children.length === 0 && element.textContent?.trim() === text,
        `with text "${text}"`,
      ),
  };
}

/** Events from tests are untrusted; mark them as the browser would. */
export function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
}

export function click(element: Element): void {
  element.dispatchEvent(
    trusted(new MouseEvent('click', { bubbles: true, cancelable: true })),
  );
}

export function keyDown(
  target: EventTarget,
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = trusted(
    new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
  target.dispatchEvent(event);
  return event;
}

/** Sets an input's value the way typing does, firing `input`. */
export function type(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  input.value = value;
  input.dispatchEvent(trusted(new Event('input', { bubbles: true })));
}
