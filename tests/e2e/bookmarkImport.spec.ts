import { expect, test, type Page } from '@playwright/test';

import { launchExtension } from './extension';

const READY_SELECTOR = 'html[data-deck-ready="true"]';
/** FableTasks P2.S7 star finish: 1,000 bookmarks under 2 s. */
const IMPORT_BUDGET_MS = 2_000;
const IMPORT_TEST_TIMEOUT_MS = 90_000;

/** 4 folders x 5 subfolders x 50 links = 1,000; 9 more repeat earlier URLs. */
const FOLDERS = 4;
const SUBFOLDERS = 5;
const LINKS_PER_SUBFOLDER = 50;
const REPEATED_LINKS = 9;
const TOTAL_LINKS = FOLDERS * SUBFOLDERS * LINKS_PER_SUBFOLDER;

const NETSCAPE_FILE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
  <DL><p>
    <DT><H3>Reading</H3>
    <DL><p>
      <DT><H3>Essays</H3>
      <DL><p>
        <DT><A HREF="https://essay.example/one">One &amp; only</A>
        <DT><A HREF="https://essay.example/two">Two</A>
      </DL><p>
    </DL><p>
  </DL><p>
</DL><p>`;

function hasBookmarksPermission(): Promise<boolean> {
  return chrome.permissions.contains({ permissions: ['bookmarks'] });
}

/**
 * Chrome shows `bookmarks`' grant as a native dialog that headless Playwright
 * cannot click, so the grant and `getTree()` are stubbed in the page: the
 * same 1,009-node tree Chrome would return, and a permission that flips the
 * way Chrome's would. Everything after `getTree()` is the real code path.
 */
async function stubChromeBookmarks(page: Page): Promise<void> {
  await page.evaluate(
    ({ folders, subfolders, links, repeated }) => {
      let isGranted = false;
      const permissions = chrome.permissions as unknown as Record<
        string,
        unknown
      >;
      const flip = (value: boolean) => () => {
        isGranted = value;
        return Promise.resolve(true);
      };
      permissions.request = flip(true);
      permissions.remove = flip(false);
      permissions.contains = () => Promise.resolve(isGranted);
      let isSeeded = false;
      const tree = () => ({
        title: '',
        children: [
          {
            title: 'Bookmarks bar',
            children: !isSeeded
              ? []
              : [
                  ...Array.from({ length: folders }, (_, f) => ({
                    title: `Folder ${f}`,
                    children: Array.from({ length: subfolders }, (_, s) => ({
                      title: `Sub ${s}`,
                      children: Array.from({ length: links }, (_, l) => ({
                        title: `Link ${f}.${s}.${l}`,
                        url: `https://bookmarks.example/${f}/${s}/${l}`,
                      })),
                    })),
                  })),
                  ...Array.from({ length: repeated }, (_, r) => ({
                    title: `Again ${r}`,
                    url: `https://bookmarks.example/0/0/${r}#again`,
                  })),
                ],
          },
          { title: 'Other bookmarks', children: [] },
        ],
      });
      const stubbed = window as unknown as {
        chrome: { bookmarks: unknown };
        seedBookmarks: () => void;
        isBookmarksGranted: () => boolean;
      };
      stubbed.chrome.bookmarks = { getTree: () => Promise.resolve([tree()]) };
      stubbed.seedBookmarks = () => {
        isSeeded = true;
      };
      stubbed.isBookmarksGranted = () => isGranted;
    },
    {
      folders: FOLDERS,
      subfolders: SUBFOLDERS,
      links: LINKS_PER_SUBFOLDER,
      repeated: REPEATED_LINKS,
    },
  );
}

const isStubGranted = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { isBookmarksGranted: () => boolean }
    ).isBookmarksGranted(),
  );

/** Records whether the progress bar was ever in the DOM. */
async function watchForProgress(page: Page): Promise<void> {
  await page.evaluate(() => {
    const flagged = window as unknown as { sawProgress?: boolean };
    flagged.sawProgress = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-deck="import-progress"] progress'))
        flagged.sawProgress = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
}

test('chrome bookmarks: preview, 1,000 links under 2 s, idempotent, revocable', async () => {
  test.setTimeout(IMPORT_TEST_TIMEOUT_MS);
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/#settings');
    await page.waitForSelector(READY_SELECTOR);
    const importButton = page.getByRole('button', {
      name: 'Import Chrome bookmarks',
    });
    const status = page.locator(
      '[data-deck="bookmark-import"] [role="status"]',
    );

    // Not granted at install (real API); granted by the click, in context.
    expect(await page.evaluate(hasBookmarksPermission)).toBe(false);
    await stubChromeBookmarks(page);
    await importButton.click();
    await expect(status).toHaveText('Nothing new to import.');
    expect(await isStubGranted(page)).toBe(true);

    await page.evaluate(() =>
      (window as unknown as { seedBookmarks: () => void }).seedBookmarks(),
    );
    await importButton.click();
    await expect(status).toHaveText(
      `${FOLDERS + 1} folders → ${FOLDERS + 1} pages, ` +
        `${FOLDERS * SUBFOLDERS + 1} subfolders → ${FOLDERS * SUBFOLDERS + 1} decks, ` +
        `${TOTAL_LINKS} links (${REPEATED_LINKS} duplicates skipped)`,
    );

    const restoreButtons = page.getByRole('button', { name: /^Restore/ });
    const snapshotsBefore = await restoreButtons.count();
    await watchForProgress(page);
    const startedAt = Date.now();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(status).toHaveText(`Imported ${TOTAL_LINKS} links.`);
    const elapsedMs = Date.now() - startedAt;
    test.info().annotations.push({
      type: 'import-ms',
      description: `${TOTAL_LINKS} bookmarks in ${elapsedMs} ms`,
    });
    expect(elapsedMs).toBeLessThan(IMPORT_BUDGET_MS);
    expect(
      await page.evaluate(
        () => (window as unknown as { sawProgress?: boolean }).sawProgress,
      ),
    ).toBe(true);

    // Re-running changes nothing.
    await importButton.click();
    await expect(status).toHaveText(
      `Nothing new to import - ${TOTAL_LINKS + REPEATED_LINKS} duplicates skipped.`,
    );

    // The import landed in the workspace, and a snapshot preceded it.
    await expect(restoreButtons).toHaveCount(snapshotsBefore + 1);
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.keyboard.press('Control+J');
    await page
      .locator('[data-deck="page"]')
      .filter({ hasText: 'Folder 3' })
      .click();
    await expect(page.locator('[data-deck="deck"]')).toHaveCount(SUBFOLDERS);
    await expect(page.locator('[data-deck="card"]')).toHaveCount(
      SUBFOLDERS * LINKS_PER_SUBFOLDER,
    );

    // Revocable from the same panel, right after.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings' }).click();
    const revoke = page
      .locator('[data-deck="bookmark-import"]')
      .getByRole('button', { name: 'Revoke' });
    await revoke.click();
    await expect(revoke).toHaveCount(0);
    expect(await isStubGranted(page)).toBe(false);
  } finally {
    await context.close();
  }
});

test('netscape bookmark file: imports without any permission', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/#settings');
    await page.waitForSelector(READY_SELECTOR);
    const status = page.locator(
      '[data-deck="bookmark-import"] [role="status"]',
    );
    const fileInput = page.getByLabel('Bookmarks file (.html)');
    const upload = () =>
      fileInput.setInputFiles({
        name: 'bookmarks.html',
        mimeType: 'text/html',
        buffer: Buffer.from(NETSCAPE_FILE),
      });

    await upload();
    await expect(status).toHaveText(
      '1 folder → 1 page, 1 subfolder → 1 deck, 2 links',
    );
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(status).toHaveText('Imported 2 links.');
    expect(await page.evaluate(hasBookmarksPermission)).toBe(false);

    await upload();
    await expect(status).toHaveText(
      'Nothing new to import - 2 duplicates skipped.',
    );

    // Searchable from The Line straight away - no reload.
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.keyboard.press('/');
    await page.keyboard.type('One & only');
    await expect(
      page.locator('[data-deck="line-results"]').getByText('One & only'),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
