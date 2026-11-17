import { createRequire } from 'node:module';
const extensionRequire = createRequire(
  new URL('../apps/extension/package.json', import.meta.url),
);
extensionRequire('fake-indexeddb/auto');

import {
  SETTINGS_DEFAULTS,
  SettingsSchema,
} from '../packages/schema/src/index';
import { expect, it, vi } from 'vitest';

import { BackupService } from '../apps/extension/src/storage/backup';
import { openDeckDatabase } from '../apps/extension/src/storage/database';
import { DeckRepository } from '../apps/extension/src/storage/repository';
import {
  hydratedSettings,
  isSettings,
} from '../apps/extension/src/storage/hydrationValidation';

it('defaults legacy settings off and preserves an explicit on choice', () => {
  const legacy = { ...SETTINGS_DEFAULTS };
  Reflect.deleteProperty(legacy, 'showWeekNumber');
  expect(SettingsSchema.parse(legacy).showWeekNumber).toBe(false);
  expect(hydratedSettings(legacy).showWeekNumber).toBe(false);
  const on = { ...legacy, showWeekNumber: true };
  expect(isSettings(on)).toBe(true);
  expect(SettingsSchema.parse(on).showWeekNumber).toBe(true);
  expect(hydratedSettings(on).showWeekNumber).toBe(true);
});

it('rejects invalid week preferences at both storage boundaries', () => {
  const invalid = { ...SETTINGS_DEFAULTS, showWeekNumber: 'true' };
  expect(SettingsSchema.safeParse(invalid).success).toBe(false);
  expect(isSettings(invalid)).toBe(false);
});

it('keeps the on choice through repository reopen, export, wipe and import', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  const name = `week-preference-${crypto.randomUUID()}`;
  const repository = new DeckRepository({ databaseName: name });
  const database = openDeckDatabase(name);
  const backups = new BackupService(repository, database, {
    snapshotStorage: null,
  });
  try {
    await repository.setSettings({
      ...SETTINGS_DEFAULTS,
      showWeekNumber: true,
    });
    const reopened = new DeckRepository({ databaseName: name });
    try {
      expect((await reopened.getSettings()).showWeekNumber).toBe(true);
    } finally {
      await reopened.close();
    }
    const exported = await backups.exportData();
    await backups.importData(
      { ...exported.document, settings: SETTINGS_DEFAULTS },
      'replace',
    );
    expect((await repository.getSettings()).showWeekNumber).toBe(false);
    await backups.importData(exported.document, 'replace');
    expect((await repository.getSettings()).showWeekNumber).toBe(true);
    expect((await backups.exportData()).document).toEqual(exported.document);
  } finally {
    clock.mockRestore();
    await repository.close();
    (await database).close();
    const { deleteDB } = extensionRequire('idb');
    await deleteDB(name);
  }
});
