import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

import { launchExtension } from './extension';

test('backup preview, seven restores, import undo, and drawer export', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/#settings');
    await page.waitForSelector('html[data-deck-ready="true"]');
    const snapshots = page.locator('[data-deck="snapshot"]');
    for (let index = 0; index < 7; index += 1) {
      await page.locator('[data-deck="snapshot-now"]').click();
    }
    await expect(snapshots).toHaveCount(7);
    await expect(snapshots.first()).toContainText(
      /pages · .*decks · .*cards · .*KB/,
    );

    const [exported] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export data', exact: true }).click(),
    ]);
    const path = await exported.path();
    if (!path) throw new Error('Export did not produce a file');
    const document = JSON.parse(await readFile(path, 'utf8')) as {
      cards: Array<{
        id: string;
        title: string;
        url: string;
        hostname: string;
        createdAt: number;
        updatedAt: number;
      }>;
    };
    const original = document.cards[0];
    if (!original) throw new Error('No example card in the exported workspace');
    document.cards.push({
      ...original,
      id: crypto.randomUUID(),
      title: 'Imported proof link',
      url: 'https://import-proof.example/',
      hostname: 'import-proof.example',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await page.locator('input[aria-label="Import data"]').setInputFiles({
      name: 'deck-import.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(document)),
    });
    const preview = page.locator('[data-deck="data-import-preview"]');
    await expect(preview).toContainText('1 cards');
    await preview.getByRole('button', { name: 'Replace' }).click();
    await expect(preview).toContainText(`${document.cards.length} cards`);
    await preview.getByRole('button', { name: 'Merge' }).click();
    await preview.getByRole('button', { name: 'Import', exact: true }).click();
    const importToast = page
      .locator('[data-deck="toast"]')
      .filter({ hasText: 'Imported 1 cards' });
    await expect(importToast).toBeVisible();
    await importToast.getByRole('button', { name: 'Undo' }).click();
    await expect(
      page
        .locator('[data-deck="toast"]')
        .filter({ hasText: 'Backup restored' }),
    ).toBeVisible();

    await page.keyboard.press('Control+J');
    await expect(page.locator('[data-deck="drawer"][data-open]')).toBeVisible();
    await expect(page.getByText('Imported proof link')).toHaveCount(0);
    const [drawerExport] = await Promise.all([
      page.waitForEvent('download'),
      page.keyboard.press('Control+E'),
    ]);
    expect(drawerExport.suggestedFilename()).toMatch(
      /^deck-\d{4}-\d{2}-\d{2}\.json$/,
    );
  } finally {
    await context.close();
  }
});
