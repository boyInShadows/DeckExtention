const WCAG_AA_NORMAL_TEXT = 4.5;
const CONTRAST_SAFETY_MARGIN = 0.01;
const WHITE_LUMINANCE = 1;
const CONTRAST_OFFSET = 0.05;

export function blackScrimForWhiteText(backgroundLuminance: number): number {
  const maximumBackground =
    (WHITE_LUMINANCE + CONTRAST_OFFSET) /
      (WCAG_AA_NORMAL_TEXT + CONTRAST_SAFETY_MARGIN) -
    CONTRAST_OFFSET;
  if (backgroundLuminance <= maximumBackground) return 0;
  return Math.min(1, 1 - maximumBackground / backgroundLuminance);
}

export function contrastWithWhite(
  backgroundLuminance: number,
  scrim: number,
): number {
  const composited = backgroundLuminance * (1 - scrim);
  return (WHITE_LUMINANCE + CONTRAST_OFFSET) / (composited + CONTRAST_OFFSET);
}
