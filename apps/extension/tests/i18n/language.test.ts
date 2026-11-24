// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';

import {
  applyDocumentLanguage,
  getLanguage,
  getLocale,
  setLanguage,
} from '../../src/i18n/language';
import { strings } from '../../src/i18n/strings';
import { panelStrings } from '../../src/i18n/panelStrings';
import { captureStrings } from '../../src/i18n/captureStrings';

afterEach(() => applyDocumentLanguage('en'));

it('switches every existing catalog import together and restores English', () => {
  expect(getLanguage()).toBe('en');
  expect(strings.links).toBe('Links');
  setLanguage('fa');
  expect(strings.links).toBe('پیوندها');
  expect(panelStrings.settings).toBe('تنظیمات');
  expect(captureStrings.saved).toBe('در ورودی ذخیره شد');
  expect(panelStrings.focusCompleted('Work / کار')).toContain('Work / کار');
  expect(panelStrings.isoWeek(2026, 1)).toBe('۲۰۲۶-W۰۱');
  setLanguage('en');
  expect(strings.links).toBe('Links');
  expect(panelStrings.settings).toBe('Settings');
  expect(captureStrings.saved).toBe('Saved to Inbox');
});

it('applies matching document language/direction and native formatting locale', () => {
  applyDocumentLanguage('fa');
  expect(document.documentElement.lang).toBe('fa');
  expect(document.documentElement.dir).toBe('rtl');
  expect(getLocale()).toBe('fa-IR');
  applyDocumentLanguage('en');
  expect(document.documentElement.lang).toBe('en');
  expect(document.documentElement.dir).toBe('ltr');
  expect(getLocale()).toBeUndefined();
});
