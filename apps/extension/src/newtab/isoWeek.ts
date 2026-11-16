const DAY_MS = 86_400_000;
const DAYS_PER_WEEK = 7;
const THURSDAY = 4;

/** Use local calendar fields, then UTC arithmetic so DST cannot alter week lengths. */
export function isoWeek(date: Date): { year: number; week: number } {
  const thursday = new Date(0);
  thursday.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = thursday.getUTCDay() || DAYS_PER_WEEK;
  thursday.setUTCDate(thursday.getUTCDate() + THURSDAY - weekday);
  const year = thursday.getUTCFullYear();
  const yearStart = new Date(0);
  yearStart.setUTCFullYear(year, 0, 1);
  const week = Math.ceil(
    ((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / DAYS_PER_WEEK,
  );
  return { year, week };
}
