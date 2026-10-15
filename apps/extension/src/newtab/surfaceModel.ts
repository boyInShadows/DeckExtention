import { strings } from '../i18n/strings';

export function greetingForHour(hour: number): string {
  if (hour < 12) return strings.greetingMorning;
  if (hour < 18) return strings.greetingAfternoon;
  return strings.greetingEvening;
}

export function shouldSpaceOpenDrawer(
  key: string,
  value: string,
  isEnabled: boolean,
): boolean {
  return isEnabled && key === ' ' && value.length === 0;
}
