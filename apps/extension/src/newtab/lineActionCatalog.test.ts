import { describe, expect, it } from 'vitest';

import { LINE_ACTIONS } from './lineActionCatalog';

describe('Line action catalogue', () => {
  it('makes every Phase 1 command discoverable from the bare prefix', () => {
    expect(LINE_ACTIONS.map(({ command }) => command)).toEqual([
      '>blur',
      '>theme night',
      '>theme day',
      '>theme system',
      '>export',
      '>import',
      '>settings',
      '>new page',
      '>stash',
    ]);
  });
});
