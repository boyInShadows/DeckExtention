import { z } from 'zod';
import { CUSTOM_CSS_MAX_LENGTH, TokenNameSchema, UrlSchema } from './common';

/** Night is the default; System follows `prefers-color-scheme`. */
export const ThemeSchema = z.enum(['night', 'day', 'system']);

/** Percent of dimming laid over a wallpaper (FableTasks P1.S5). */
export const WALLPAPER_DIM_MAX = 60;

/**
 * A wallpaper never blocks first paint (MasterPlan I10): the stored gradient is
 * painted immediately and the image fades in once decoded. `file` keeps only a
 * key into the `meta` store so Settings itself stays small and JSON-safe.
 */
export const WallpaperSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('color'), token: TokenNameSchema }),
  z.strictObject({ kind: z.literal('url'), url: UrlSchema }),
  z.strictObject({ kind: z.literal('file'), blobKey: z.string().min(1) }),
]);

export const SettingsSchema = z.strictObject({
  theme: ThemeSchema,
  /** Empty means no greeting line at all - never a placeholder (P1.S3). */
  ownerName: z.string().max(80),
  showSeconds: z.boolean(),
  /** The `B` blur toggle; persisted across tabs (P1.S5). */
  isBlurred: z.boolean(),
  /** Space on an empty Line opens the drawer. On by default, per AGENTS.md 2. */
  canSpaceOpenDrawer: z.boolean(),
  wallpaper: WallpaperSchema,
  wallpaperDim: z.number().int().min(0).max(WALLPAPER_DIM_MAX),
  /** CSS-derived gradient painted before the image decodes. */
  wallpaperGradient: z.string().max(1024).nullable(),
  wallpaperLuminance: z.number().min(0).max(1).nullable().optional(),
  customCss: z.string().max(CUSTOM_CSS_MAX_LENGTH),
  searchUrlTemplate: z
    .string()
    .max(1024)
    .includes('{query}')
    .default('https://www.google.com/search?q={query}'),
});

/**
 * The zero-setup-tax defaults (rubric P2). A fresh install is valid Settings
 * without the user touching anything.
 */
export const SETTINGS_DEFAULTS: Settings = Object.freeze({
  theme: 'night',
  ownerName: '',
  showSeconds: false,
  isBlurred: false,
  canSpaceOpenDrawer: true,
  wallpaper: { kind: 'none' },
  wallpaperDim: 0,
  wallpaperGradient: null,
  wallpaperLuminance: null,
  customCss: '',
  searchUrlTemplate: 'https://www.google.com/search?q={query}',
} satisfies Settings);

export type Theme = z.infer<typeof ThemeSchema>;
export type Wallpaper = z.infer<typeof WallpaperSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
