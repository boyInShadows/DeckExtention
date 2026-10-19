import { describe, expect, it } from 'vitest';

import { springFrames } from './spring';

describe('springFrames', () => {
  it('starts and finishes at the requested positions with a spring overshoot', () => {
    const enter = springFrames(380, 32, true, '100%');
    const exit = springFrames(380, 32, false, '100%');
    expect(enter).toHaveLength(21);
    expect(enter[0]?.transform).toBe('translateY(calc(100% * 1))');
    expect(enter.at(-1)?.transform).toBe('translateY(calc(100% * 0))');
    expect(exit[0]?.transform).toBe('translateY(calc(100% * 0))');
    expect(exit.at(-1)?.transform).toBe('translateY(calc(100% * 1))');
    expect(
      enter.some(({ transform }) => String(transform).includes(' * -')),
    ).toBe(true);
  });
});
