import { describe, expect, it } from 'vitest';
import { isoWeek } from '../apps/extension/src/newtab/isoWeek';

describe('local ISO week', () => {
  it.each([
    [2015, 12, 31, 2015, 53],
    [2016, 1, 1, 2015, 53],
    [2016, 1, 3, 2015, 53],
    [2016, 1, 4, 2016, 1],
    [2020, 12, 31, 2020, 53],
    [2021, 1, 1, 2020, 53],
    [2021, 1, 4, 2021, 1],
    [2024, 2, 29, 2024, 9],
    [2024, 12, 30, 2025, 1],
    [2026, 11, 16, 2026, 47],
    [2027, 1, 1, 2026, 53],
  ])(
    '%i-%i-%i belongs to ISO %i week %i',
    (year, month, day, weekYear, week) => {
      const date = new Date(year, month - 1, day, 23, 59);
      const before = date.getTime();
      expect(isoWeek(date)).toEqual({ year: weekYear, week });
      expect(date.getTime()).toBe(before);
    },
  );
  it.each([
    'UTC',
    'America/New_York',
    'Pacific/Kiritimati',
    'Pacific/Honolulu',
  ])('uses local dates and stable DST arithmetic in %s', (timezone) => {
    const previous = process.env.TZ;
    process.env.TZ = timezone;
    try {
      expect(isoWeek(new Date(2021, 0, 4, 0, 15))).toEqual({
        year: 2021,
        week: 1,
      });
      expect(isoWeek(new Date(2021, 2, 14, 23, 59))).toEqual({
        year: 2021,
        week: 10,
      });
      expect(isoWeek(new Date(2021, 2, 15, 0, 1))).toEqual({
        year: 2021,
        week: 11,
      });
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
