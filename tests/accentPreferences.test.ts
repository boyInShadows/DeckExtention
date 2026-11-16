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

it('defaults legacy settings to warm and preserves an explicit accent', () => {
  const legacy = { ...SETTINGS_DEFAULTS };
  Reflect.deleteProperty(legacy, 'accentColor');
  expect(SettingsSchema.parse(legacy).accentColor).toBe('warm');
  expect(hydratedSettings(legacy).accentColor).toBe('warm');
  const on = { ...legacy, accentColor: 'blue' };
  expect(isSettings(on)).toBe(true);
  expect(SettingsSchema.parse(on).accentColor).toBe('blue');
  expect(hydratedSettings(on).accentColor).toBe('blue');
});

it('rejects invalid accent preferences at both storage boundaries', () => {
  const invalid = { ...SETTINGS_DEFAULTS, accentColor: 'purple' };
  expect(SettingsSchema.safeParse(invalid).success).toBe(false);
  expect(isSettings(invalid)).toBe(false);
});

it.each(['warm', 'slate', 'blue', 'green', 'amber', 'rose'] as const)(
  'keeps %s through repository reopen, export, wipe and import',
  async (accentColor) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const name = `accent-preference-${crypto.randomUUID()}`;
    const repository = new DeckRepository({ databaseName: name });
    const database = openDeckDatabase(name);
    const backups = new BackupService(repository, database, {
      snapshotStorage: null,
    });
    try {
      await repository.setSettings({
        ...SETTINGS_DEFAULTS,
        accentColor,
      });
      const reopened = new DeckRepository({ databaseName: name });
      try {
        expect((await reopened.getSettings()).accentColor).toBe(accentColor);
      } finally {
        await reopened.close();
      }
      const exported = await backups.exportData();
      await backups.importData(
        { ...exported.document, settings: SETTINGS_DEFAULTS },
        'replace',
      );
      expect((await repository.getSettings()).accentColor).toBe('warm');
      await backups.importData(exported.document, 'replace');
      expect((await repository.getSettings()).accentColor).toBe(accentColor);
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
