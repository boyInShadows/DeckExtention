import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { strings as english } from '../../src/i18n/en/strings';
import { strings as persian } from '../../src/i18n/fa/strings';
import { panelStrings as englishPanels } from '../../src/i18n/en/panelStrings';
import { panelStrings as persianPanels } from '../../src/i18n/fa/panelStrings';
import { captureStrings as englishCapture } from '../../src/i18n/en/captureStrings';
import { captureStrings as persianCapture } from '../../src/i18n/fa/captureStrings';

function catalogShape(value: unknown): unknown {
  return value !== null && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, catalogShape(child)]),
      )
    : typeof value;
}

function catalogText(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return value !== null && typeof value === 'object'
    ? Object.values(value).flatMap(catalogText)
    : [];
}

describe('Persian catalogs', () => {
  it('retains the pinned self-hosted font and its upstream license', () => {
    const font = readFileSync(
      new URL(
        '../../src/assets/fonts/vazirmatn-variable.woff2',
        import.meta.url,
      ),
    );
    expect(font.subarray(0, 4).toString()).toBe('wOF2');
    expect(createHash('sha256').update(font).digest('hex')).toBe(
      '4e3fa217d38fdafc1fea4414ceb58ca5e662cf0ab5fa735a8c8c20e8b42cad92',
    );
    const license = readFileSync(
      new URL('../../src/assets/fonts/LICENSE-Vazirmatn.txt', import.meta.url),
      'utf8',
    );
    expect(license).toContain('SIL Open Font License, Version 1.1.');
    expect(license).toContain('The Vazirmatn Project Authors');
  });
  it('retains every surface key and a translated accessible drawer label', () => {
    expect(Object.keys(persian).sort()).toEqual(Object.keys(english).sort());
    expect(persian.openDrawer).toContain(persian.drawerHandle);
    expect(persian.links).toBe('پیوندها');
    expect(persian.lineKeyboardHint).toContain('?:');
    expect(persian.examples).toEqual(english.examples);
  });

  it('renders Persian counts and keeps user text intact', () => {
    expect(persian.pinRange(7, 12, 12)).toBe('۷–۱۲ از ۱۲');
    expect(persian.isoWeek(2026, 1)).toBe('۲۰۲۶-W۰۱');
    expect(persian.openSection('Work / کار')).toContain('Work / کار');
    expect(persian.dragPickedUp('card_one')).toContain('card_one');
    expect(persian.dragOver('card_one', 'deck_two')).toContain('deck_two');
    expect(persian.dragLeft('card_one')).toContain('card_one');
    expect(persian.dragDropped('card_one', undefined)).toContain('card_one');
    expect(persian.dragDropped('card_one', 0)).toContain('0');
    expect(persian.dragCancelled('card_one')).toContain('card_one');
    expect(persian.isoWeekLabel(2026, 1)).toContain('۲۰۲۶');
  });

  it('provides complete panel/capture keys without English fallback', () => {
    expect(catalogShape(persianPanels)).toEqual(catalogShape(englishPanels));
    expect(catalogShape(persianCapture)).toEqual(catalogShape(englishCapture));
    expect(persianPanels.settings).toBe(persian.settings);
    expect(persianCapture.saved).toBe('در ورودی ذخیره شد');
    expect(persianPanels.deckColorNames.slate).toBe('خاکستری');
    const namesAndKeys = new Set<string>([...english.examples, 'Enter']);
    for (const text of catalogText([persianPanels, persianCapture])) {
      if (!namesAndKeys.has(text)) expect(text).toMatch(/[\u0621-\u06ff]/u);
    }
  });

  it('renders every interpolated panel message in Persian', () => {
    const counts = {
      pages: 2,
      decks: 3,
      cards: 4,
      size: '1 KB',
      skipped: 1,
      links: 5,
      duplicates: 1,
      unsupported: 2,
    };
    const summaries = new Set([
      'backupSummary',
      'dataImportPreview',
      'importPreview',
    ]);
    for (const [key, value] of Object.entries(persianPanels)) {
      if (typeof value !== 'function') continue;
      const args = summaries.has(key) ? [counts] : [2, 3, 5];
      const text = Reflect.apply(value, undefined, args);
      expect(typeof text, key).toBe('string');
      expect(text, key).toMatch(/[\u0600-\u06ff]/u);
      expect(text, key).not.toContain('NaN');
    }
  });

  it('handles optional titles and empty/duplicate/unsupported import summaries', () => {
    expect(persianPanels.focusCompleted(undefined)).toBe(
      'تمرکز کامل شد. یک قدم جلوتر رفتید.',
    );
    expect(persianPanels.focusCompleted('Work / کار')).toContain('Work / کار');
    expect(persianPanels.importNothingNew(0)).toBe(
      'مورد تازه‌ای برای ورود نیست.',
    );
    expect(persianPanels.importNothingNew(1)).toContain('۱');
    const counts = {
      pages: 0,
      decks: 0,
      links: 0,
      duplicates: 0,
      unsupported: 0,
    };
    expect(persianPanels.importPreview(counts)).not.toContain('(');
    expect(persianPanels.importPreview({ ...counts, duplicates: 1 })).toContain(
      '۱ تکراری',
    );
    expect(
      persianPanels.importPreview({ ...counts, unsupported: 1 }),
    ).toContain('۱ پشتیبانی‌نشده');
  });
});
