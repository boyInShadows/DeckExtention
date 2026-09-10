import { describe, expect, it } from 'vitest';

import { blackScrimForWhiteText, contrastWithWhite } from './contrast';

describe('wallpaper contrast', () => {
  it.each([0.2, 0.4, 0.6, 0.8, 1])(
    'keeps white text at AA contrast over luminance %s',
    (luminance) => {
      const scrim = blackScrimForWhiteText(luminance);
      expect(contrastWithWhite(luminance, scrim)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
