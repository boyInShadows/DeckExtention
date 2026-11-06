import { createRequire } from 'node:module';
const extensionRequire = createRequire(
  new URL('../../apps/extension/package.json', import.meta.url),
);
extensionRequire('fake-indexeddb/auto');

import {
  SETTINGS_DEFAULTS,
  SettingsSchema,
} from '../../packages/schema/src/index';
import { expect, it } from 'vitest';

import { BackupService } from '../../apps/extension/src/storage/backup';
import { openDeckDatabase } from '../../apps/extension/src/storage/database';
import { DeckRepository } from '../../apps/extension/src/storage/repository';
import {
  hydratedSettings,
  isSettings,
} from '../../apps/extension/src/storage/hydrationValidation';

it('defaults legacy settings on and preserves an explicit off choice', () => {
  const legacy = { ...SETTINGS_DEFAULTS };
  Reflect.deleteProperty(legacy, 'showGoogleSuggestions');
  expect(SettingsSchema.parse(legacy).showGoogleSuggestions).toBe(true);
  expect(hydratedSettings(legacy).showGoogleSuggestions).toBe(true);
  const off = { ...legacy, showGoogleSuggestions: false };
  expect(isSettings(off)).toBe(true);
  expect(SettingsSchema.parse(off).showGoogleSuggestions).toBe(false);
  expect(hydratedSettings(off).showGoogleSuggestions).toBe(false);
});

it('rejects invalid suggestion preferences at both storage boundaries', () => {
  const invalid = { ...SETTINGS_DEFAULTS, showGoogleSuggestions: 'false' };
  expect(SettingsSchema.safeParse(invalid).success).toBe(false);
  expect(isSettings(invalid)).toBe(false);
});

it('keeps the off choice through repository reopen, export, wipe and import', async () => {
  const name = `google-preference-${crypto.randomUUID()}`;
  const repository = new DeckRepository({ databaseName: name });
  const database = openDeckDatabase(name);
  const backups = new BackupService(repository, database, {
    snapshotStorage: null,
  });
  try {
    await repository.setSettings({
      ...SETTINGS_DEFAULTS,
      showGoogleSuggestions: false,
    });
    const reopened = new DeckRepository({ databaseName: name });
    try {
      expect((await reopened.getSettings()).showGoogleSuggestions).toBe(false);
    } finally {
      await reopened.close();
    }
    const exported = await backups.exportData();
    await backups.importData(
      { ...exported.document, settings: SETTINGS_DEFAULTS },
      'replace',
    );
    expect((await repository.getSettings()).showGoogleSuggestions).toBe(true);
    await backups.importData(exported.document, 'replace');
    expect((await repository.getSettings()).showGoogleSuggestions).toBe(false);
  } finally {
    await repository.close();
    (await database).close();
    const { deleteDB } = extensionRequire('idb');
    await deleteDB(name);
  }
});
