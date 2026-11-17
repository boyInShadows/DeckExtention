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

it('defaults legacy settings to compact and preserves an explicit density', () => {
  const legacy = { ...SETTINGS_DEFAULTS };
  Reflect.deleteProperty(legacy, 'rowDensity');
  expect(SettingsSchema.parse(legacy).rowDensity).toBe('compact');
  expect(hydratedSettings(legacy).rowDensity).toBe('compact');
  const on = { ...legacy, rowDensity: 'comfortable' };
  expect(isSettings(on)).toBe(true);
  expect(SettingsSchema.parse(on).rowDensity).toBe('comfortable');
  expect(hydratedSettings(on).rowDensity).toBe('comfortable');
});

it('rejects invalid density preferences at both storage boundaries', () => {
  const invalid = { ...SETTINGS_DEFAULTS, rowDensity: 'purple' };
  expect(SettingsSchema.safeParse(invalid).success).toBe(false);
  expect(isSettings(invalid)).toBe(false);
});

it.each(['compact', 'comfortable'] as const)(
  'keeps %s through repository reopen, export, wipe and import',
  async (rowDensity) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const name = `density-preference-${crypto.randomUUID()}`;
    const repository = new DeckRepository({ databaseName: name });
    const database = openDeckDatabase(name);
    const backups = new BackupService(repository, database, {
      snapshotStorage: null,
    });
    try {
      await repository.setSettings({
        ...SETTINGS_DEFAULTS,
        rowDensity,
      });
      const reopened = new DeckRepository({ databaseName: name });
      try {
        expect((await reopened.getSettings()).rowDensity).toBe(rowDensity);
      } finally {
        await reopened.close();
      }
      const exported = await backups.exportData();
      await backups.importData(
        { ...exported.document, settings: SETTINGS_DEFAULTS },
        'replace',
      );
      expect((await repository.getSettings()).rowDensity).toBe('compact');
      await backups.importData(exported.document, 'replace');
      expect((await repository.getSettings()).rowDensity).toBe(rowDensity);
      expect((await backups.exportData()).document).toEqual(exported.document);
    } finally {
      clock.mockRestore();
      await repository.close();
      (await database).close();
      const { deleteDB } = extensionRequire('idb');
      await deleteDB(name);
    }
  },
);
