import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());

it('defers Persian formatter construction until used and reuses it without changing digits', async () => {
  vi.resetModules();
  const construct = vi.spyOn(Intl, 'NumberFormat');
  const { number } = await import('../../src/i18n/fa/numbers');
  expect(construct).not.toHaveBeenCalled();
  expect(number(12)).toBe('۱۲');
  expect(number(0)).toBe('۰');
  expect(construct).toHaveBeenCalledExactlyOnceWith('fa-IR', {
    useGrouping: false,
  });
});
