import type { Card } from 'deck-schema';
import { describe, expect, it } from 'vitest';

import { captureStrings } from '../i18n/captureStrings';
import { toastStylesheet } from './toast';
import {
  buildToastModel,
  TOAST_DURATION_MS,
  TOAST_MESSAGE_TYPE,
} from './toastModel';

const card = { id: 'card_1', title: 'A' } as Card;

describe('buildToastModel', () => {
  it('offers note and undo after a save, for 2.5 s', () => {
    const model = buildToastModel({ kind: 'saved', card }, 'night', 'css');
    expect(model).toMatchObject({
      mode: 'saved',
      message: captureStrings.saved,
      hint: captureStrings.savedHint,
      theme: 'night',
      css: 'css',
      durationMs: TOAST_DURATION_MS,
    });
    expect(TOAST_DURATION_MS).toBe(2_500);
    expect(model.report).toEqual({
      type: TOAST_MESSAGE_TYPE,
      cardId: 'card_1',
      pageId: 'inbox',
    });
  });

  it('names where a duplicate already lives', () => {
    const model = buildToastModel(
      { kind: 'duplicate', card, pageId: 'p1', location: 'Work › Docs' },
      'day',
      '',
    );
    expect(model.mode).toBe('duplicate');
    expect(model.message).toBe(`${captureStrings.duplicate} Work › Docs`);
    expect(model.hint).toBe(captureStrings.duplicateHint);
    expect(model.report?.pageId).toBe('p1');
  });

  it('calls an Inbox duplicate "Inbox"', () => {
    const model = buildToastModel(
      { kind: 'duplicate', card, pageId: 'inbox', location: null },
      'system',
      '',
    );
    expect(model.message).toBe(
      `${captureStrings.duplicate} ${captureStrings.inbox}`,
    );
  });
});

describe('toastStylesheet', () => {
  it('scopes tokens to the shadow host so the page is never styled', () => {
    const css = toastStylesheet(
      ':root, [data-theme="night"] { --a: 1; }\n:root { --b: 2; }',
      '.toast {}',
    );
    expect(css).not.toContain(':root');
    expect(css).toContain(':host, [data-theme="night"]');
    expect(css.endsWith('.toast {}')).toBe(true);
  });
});
