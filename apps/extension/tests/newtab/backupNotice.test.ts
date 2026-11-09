import { afterEach, expect, it, vi } from 'vitest';

import { backupFailureNotice } from '../../src/newtab/pendingNotices';

const schemaError = JSON.stringify([
  {
    code: 'unrecognized_keys',
    keys: ['showGoogleSuggestions'],
    path: ['settings'],
    message: 'Unrecognized key: "showGoogleSuggestions"',
  },
]);

afterEach(() => vi.unstubAllGlobals());

it('offers extension reload for the older settings validator without clearing evidence', () => {
  const reload = vi.fn();
  const remove = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: { reload },
    storage: { local: { remove } },
  });
  const notice = backupFailureNotice(schemaError);
  expect(notice.kind).toBe('error');
  expect(notice.text).toContain('Reload Deck');
  expect(notice.action?.label).toBe('Reload Deck');
  expect(backupFailureNotice(schemaError).action).toBe(notice.action);
  expect(reload).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  notice.action?.run();
  expect(reload).toHaveBeenCalledOnce();
  expect(remove).not.toHaveBeenCalled();
});

it.each([
  'disk full',
  '[invalid JSON',
  JSON.stringify([
    { code: 'unrecognized_keys', keys: ['unknown'], path: ['settings'] },
  ]),
  JSON.stringify([
    {
      code: 'unrecognized_keys',
      keys: ['showGoogleSuggestions'],
      path: ['cards'],
    },
  ]),
  JSON.stringify([
    {
      code: 'invalid_type',
      keys: ['showGoogleSuggestions'],
      path: ['settings'],
    },
  ]),
  JSON.stringify([]),
])('preserves other failures and avoids an unrelated reload: %s', (message) => {
  expect(backupFailureNotice(message)).toEqual({
    kind: 'error',
    text: `Backup failed. ${message}`,
  });
});
