import type { Settings } from './settings';

export const INBOX_DECK_ID = 'deck_inbox';
export const OPEN_PAGE_HASH_PREFIX = '#page=';
export const OPEN_SETTINGS_HASH = '#settings';
export const SETTINGS_ENTITY_ID = 'settings';
export const MAINTENANCE_MESSAGE = 'deck:maintenance';
export const SCHEMA_VERSION = 3;
export const TITLE_MAX_LENGTH = 300;
export const URL_MAX_LENGTH = 4096;
export const NOTE_MAX_LENGTH = 20_000;
export const CUSTOM_CSS_MAX_LENGTH = 100_000;
export const HOSTNAME_MAX_LENGTH = 253;
export const WALLPAPER_DIM_MAX = 60;
export const ROW_DENSITIES = ['compact', 'comfortable'] as const;
export const FONT_SIZES = ['default', 'large', 'extra-large'] as const;
export const ACCENT_COLORS = [
  'warm',
  'slate',
  'blue',
  'green',
  'amber',
  'rose',
] as const;

export const SETTINGS_DEFAULTS: Settings = Object.freeze({
  theme: 'night',
  accentColor: 'warm',
  rowDensity: 'compact',
  fontSize: 'default',
  ownerName: '',
  showSeconds: false,
  showDate: true,
  showWeekNumber: false,
  use12HourClock: false,
  showResurface: true,
  showShelf: false,
  showGoogleSuggestions: true,
  shelfDeckIds: [],
  isBlurred: false,
  canSpaceOpenDrawer: true,
  wallpaper: { kind: 'none' },
  wallpaperDim: 0,
  wallpaperGradient: null,
  wallpaperLuminance: null,
  customCss: '',
  keymap: [],
  searchUrlTemplate: 'https://www.google.com/search?q={query}',
} satisfies Settings);
