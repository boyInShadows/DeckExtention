import type { Page } from '@playwright/test';

function armDrawerTimer() {
  return {
    measured: new Promise<number>((resolve, reject) => {
      let startedAt: number | null = null;
      const onKey = (event: KeyboardEvent) => {
        if (event.ctrlKey && event.key.toLowerCase() === 'j')
          startedAt = event.timeStamp;
      };
      window.addEventListener('keydown', onKey, { capture: true });
      const observer = new MutationObserver(() => {
        if (!document.querySelector('[data-deck="drawer"][data-open]')) return;
        observer.disconnect();
        window.removeEventListener('keydown', onKey, { capture: true });
        if (startedAt === null) {
          reject(new Error('Missing drawer keydown timestamp'));
          return;
        }
        const start = startedAt;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(performance.now() - start)),
        );
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    }),
  };
}

/** Keydown to the second animation frame with the drawer open. */
export async function measureDrawerOpen(page: Page): Promise<number> {
  // Await the object handle so the observer exists before keyboard input.
  const probe = await page.evaluateHandle(armDrawerTimer);
  try {
    await page.keyboard.press('Control+J');
    return await probe.evaluate(({ measured }) => measured);
  } finally {
    await probe.dispose();
  }
}
