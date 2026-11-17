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

it('keeps legacy text size unchanged and accepts the bounded readable scale', () => {
  const legacy = { ...SETTINGS_DEFAULTS };
  Reflect.deleteProperty(legacy, 'fontSize');
  expect(SettingsSchema.parse(legacy).fontSize).toBe('default');
  expect(hydratedSettings(legacy).fontSize).toBe('default');
  for (const fontSize of ['default', 'large', 'extra-large']) {
    const settings = { ...legacy, fontSize };
    expect(isSettings(settings)).toBe(true);
    expect(SettingsSchema.parse(settings).fontSize).toBe(fontSize);
    expect(hydratedSettings(settings).fontSize).toBe(fontSize);
  }
});

it.each(['small', '', 200, null])(
  'rejects invalid text size %s at both boundaries',
  (fontSize) => {
    const settings = { ...SETTINGS_DEFAULTS, fontSize };
    expect(SettingsSchema.safeParse(settings).success).toBe(false);
    expect(isSettings(settings)).toBe(false);
  },
);

it.each(['default', 'large', 'extra-large'] as const)(
  'preserves %s through reopen and full export, wipe, import',
  async (fontSize) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const name = `font-size-${crypto.randomUUID()}`;
    const repository = new DeckRepository({ databaseName: name });
    const database = openDeckDatabase(name);
    const backups = new BackupService(repository, database, {
      snapshotStorage: null,
    });
    try {
      await repository.setSettings({ ...SETTINGS_DEFAULTS, fontSize });
      const reopened = new DeckRepository({ databaseName: name });
      try {
        expect((await reopened.getSettings()).fontSize).toBe(fontSize);
      } finally {
        await reopened.close();
      }
      const exported = await backups.exportData();
      await backups.importData(
        { ...exported.document, settings: SETTINGS_DEFAULTS },
        'replace',
      );
      expect((await repository.getSettings()).fontSize).toBe('default');
      await backups.importData(exported.document, 'replace');
      expect((await repository.getSettings()).fontSize).toBe(fontSize);
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
