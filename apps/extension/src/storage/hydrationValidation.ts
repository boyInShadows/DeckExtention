import {
  CUSTOM_CSS_MAX_LENGTH,
  HOSTNAME_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  SETTINGS_DEFAULTS,
  TITLE_MAX_LENGTH,
  URL_MAX_LENGTH,
  WALLPAPER_DIM_MAX,
} from 'deck-schema/constants';
import { type Card, type Deck, type Page, type Settings } from 'deck-schema';

const BASE_FIELDS = ['id', 'createdAt', 'updatedAt', 'deletedAt'];
const PAGE_FIELDS = [...BASE_FIELDS, 'title', 'order'];
const DECK_FIELDS = [
  ...BASE_FIELDS,
  'pageId',
  'title',
  'kind',
  'order',
  'color',
  'isCollapsed',
  'isTaskMode',
  'note',
  'expiresAt',
];
const CARD_FIELDS = [
  ...BASE_FIELDS,
  'deckId',
  'kind',
  'url',
  'title',
  'hostname',
  'order',
  'pinned',
  'pinLabel',
  'pinIcon',
  'done',
  'note',
  'lastOpenedAt',
  'reviewedAt',
];
const SETTINGS_FIELDS = [
  'theme',
  'ownerName',
  'showSeconds',
  'showDate',
  'use12HourClock',
  'showResurface',
  'isBlurred',
  'canSpaceOpenDrawer',
  'wallpaper',
  'wallpaperDim',
  'wallpaperGradient',
  'wallpaperLuminance',
  'customCss',
  'keymap',
  'searchUrlTemplate',
  'searchPermission',
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOnlyFields = (value: Record<string, unknown>, fields: string[]) =>
  Object.keys(value).every((key) => fields.includes(key));
const isString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;
const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(value);
const isOrder = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9A-Za-z]{1,64}$/.test(value);
const isToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(value);
const isUrl = (value: unknown): value is string => {
  if (!isString(value, URL_MAX_LENGTH)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};
const isOptional = (value: unknown, check: (value: unknown) => boolean) =>
  value === undefined || check(value);
const isBase = (value: unknown): value is Record<string, unknown> =>
  isObject(value) &&
  isId(value.id) &&
  isTime(value.createdAt) &&
  isTime(value.updatedAt) &&
  (value.deletedAt === null || isTime(value.deletedAt));

export function isPage(value: unknown): value is Page {
  return (
    isBase(value) &&
    hasOnlyFields(value, PAGE_FIELDS) &&
    isString(value.title, TITLE_MAX_LENGTH) &&
    isOrder(value.order)
  );
}

export function isDeck(value: unknown): value is Deck {
  return (
    isBase(value) &&
    hasOnlyFields(value, DECK_FIELDS) &&
    isId(value.pageId) &&
    isString(value.title, TITLE_MAX_LENGTH) &&
    typeof value.kind === 'string' &&
    ['normal', 'inbox', 'session'].includes(value.kind) &&
    isOrder(value.order) &&
    (value.color === null || isToken(value.color)) &&
    typeof value.isCollapsed === 'boolean' &&
    isOptional(value.isTaskMode, (item) => typeof item === 'boolean') &&
    isOptional(value.note, (note) => isString(note, NOTE_MAX_LENGTH)) &&
    isOptional(value.expiresAt, isTime)
  );
}

export function isCard(value: unknown): value is Card {
  return (
    isBase(value) &&
    hasOnlyFields(value, CARD_FIELDS) &&
    isId(value.deckId) &&
    isOptional(value.kind, (kind) => kind === 'link' || kind === 'task') &&
    (value.url === undefined
      ? value.kind === 'task' && value.pinned === false
      : isUrl(value.url)) &&
    isString(value.title, TITLE_MAX_LENGTH) &&
    isString(value.hostname, HOSTNAME_MAX_LENGTH) &&
    isOrder(value.order) &&
    typeof value.pinned === 'boolean' &&
    (value.lastOpenedAt === null || isTime(value.lastOpenedAt)) &&
    isOptional(value.reviewedAt, isTime) &&
    isOptional(value.pinLabel, (label) => isString(label, TITLE_MAX_LENGTH)) &&
    isOptional(value.pinIcon, (icon) => isString(icon, 16)) &&
    isOptional(value.done, (done) => typeof done === 'boolean') &&
    isOptional(value.note, (note) => isString(note, NOTE_MAX_LENGTH))
  );
}

function isWallpaper(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    (value.kind === 'none' && hasOnlyFields(value, ['kind'])) ||
    (value.kind === 'color' &&
      hasOnlyFields(value, ['kind', 'token']) &&
      isToken(value.token)) ||
    (value.kind === 'file' &&
      hasOnlyFields(value, ['kind', 'blobKey']) &&
      isString(value.blobKey, Infinity) &&
      value.blobKey.length > 0) ||
    (value.kind === 'url' &&
      hasOnlyFields(value, ['kind', 'url']) &&
      isUrl(value.url))
  );
}

function isKeymap(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every(
      (entry) =>
        isObject(entry) &&
        hasOnlyFields(entry, ['action', 'chord']) &&
        isString(entry.action, 32) &&
        isString(entry.chord, 32),
    )
  );
}

export function isSettings(value: unknown): value is Settings {
  if (!isObject(value)) return false;
  return (
    isWallpaper(value.wallpaper) &&
    hasOnlyFields(value, SETTINGS_FIELDS) &&
    typeof value.theme === 'string' &&
    ['night', 'day', 'system'].includes(value.theme) &&
    isString(value.ownerName, 80) &&
    typeof value.showSeconds === 'boolean' &&
    isOptional(value.showDate, (item) => typeof item === 'boolean') &&
    isOptional(value.use12HourClock, (item) => typeof item === 'boolean') &&
    isOptional(value.showResurface, (item) => typeof item === 'boolean') &&
    typeof value.isBlurred === 'boolean' &&
    typeof value.canSpaceOpenDrawer === 'boolean' &&
    typeof value.wallpaperDim === 'number' &&
    Number.isInteger(value.wallpaperDim) &&
    value.wallpaperDim >= 0 &&
    value.wallpaperDim <= WALLPAPER_DIM_MAX &&
    (value.wallpaperGradient === null ||
      isString(value.wallpaperGradient, 1024)) &&
    (value.wallpaperLuminance === undefined ||
      value.wallpaperLuminance === null ||
      (typeof value.wallpaperLuminance === 'number' &&
        value.wallpaperLuminance >= 0 &&
        value.wallpaperLuminance <= 1)) &&
    isString(value.customCss, CUSTOM_CSS_MAX_LENGTH) &&
    isOptional(value.keymap, isKeymap) &&
    isOptional(
      value.searchUrlTemplate,
      (template) => isString(template, 1024) && template.includes('{query}'),
    ) &&
    isOptional(
      value.searchPermission,
      (permission) => permission === 'declined',
    )
  );
}

export function hydratedSettings(value: Settings): Settings {
  return { ...SETTINGS_DEFAULTS, ...value };
}

export { isId };
