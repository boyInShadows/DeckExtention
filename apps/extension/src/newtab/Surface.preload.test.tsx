// @vitest-environment happy-dom
import { SETTINGS_DEFAULTS } from 'deck-schema';
import type { ComponentChildren } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { strings } from '../i18n/strings';
import { render } from '../testing/render';
import type { SurfaceData } from './bootstrap';
import { Surface } from './Surface';

/*
 * Its own file because the drawer chunk must fail to load here, while
 * Surface.test.tsx needs it to load. Pins and the dnd-kit provider are
 * passed through for the same reason as there.
 */
vi.mock('../drawer/drawer', () => {
  throw new Error('chunk missing');
});
vi.mock('./Pins', () => ({ Pins: () => null }));
vi.mock('../drawer/WorkspaceDnd', () => ({ WorkspaceDnd: PassThrough }));

function PassThrough({ children }: { children: ComponentChildren }) {
  return <>{children}</>;
}

const callbacks: (() => void)[] = [];

beforeEach(() => {
  callbacks.length = 0;
  const schedule = (callback: () => void) => callbacks.push(callback);
  vi.stubGlobal('requestAnimationFrame', schedule);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('requestIdleCallback', schedule);
  vi.stubGlobal('cancelIdleCallback', vi.fn());
  vi.stubGlobal('chrome', {
    storage: { local: { get: () => Promise.resolve({}), remove: vi.fn() } },
    runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
  });
  performance.mark('deck-start');
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('Surface drawer preload failure', () => {
  it('tells the owner when the drawer chunk cannot be loaded', async () => {
    const data: SurfaceData = {
      cards: [],
      decks: [],
      pages: [],
      defaultDeckId: 'deck_a',
      settings: SETTINGS_DEFAULTS,
      repository: {} as SurfaceData['repository'],
    };
    const view = await render(<Surface initialData={data} />);
    // Two rounds: the frame schedules the idle callback, which preloads.
    for (let round = 0; round < 2; round += 1) {
      await view.act(() => {
        for (const callback of callbacks.splice(0)) callback();
      });
    }
    await vi.waitFor(async () => {
      await view.act(async () => {
        await vi.dynamicImportSettled();
      });
      expect(view.get('[data-deck="error"]').textContent).toContain(
        strings.updateFailed,
      );
    });
    view.unmount();
  });
});
