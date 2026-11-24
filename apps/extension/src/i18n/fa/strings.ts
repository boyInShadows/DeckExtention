import type { SurfaceCatalog } from '../catalogs';
import { number } from './numbers';

export const strings = {
  isoWeek: (year, week) => `${number(year)}-W${number(week).padStart(2, '۰')}`,
  isoWeekLabel: (year, week) =>
    `هفتهٔ ${number(week)} سال ${number(year)} بر پایهٔ ISO`,
  links: 'پیوندها',
  tasks: 'کارها',
  sessions: 'نشست‌ها',
  focus: 'تمرکز',
  sections: 'بخش‌های فضای کار',
  openSection: (label) => `باز کردن ${label}`,
  taskSaved: 'کار در ورودی ذخیره شد',
  linePlaceholder: 'جست‌وجو کنید یا > بنویسید',
  lineKeyboardHint: 'فاصله: Deck · ?: کلیدها',
  greetingMorning: 'صبح بخیر',
  greetingNight: 'شب بخیر',
  greetingAfternoon: 'بعدازظهر بخیر',
  greetingEvening: 'عصر بخیر',
  examplesTitle: 'نمونه‌ها',
  examples: [
    'MDN Web Docs',
    'GitHub',
    'Internet Archive',
    'Wikipedia',
    'Web Standards',
    'TypeScript',
  ],
  pinsLabel: 'سنجاق‌ها',
  pinsEmptyHint: 'سایتی را سنجاق کنید · فاصله Deck را باز می‌کند',
  addPin: 'افزودن سنجاق',
  pinLimit: 'حداکثر ۱۲ سنجاق',
  previousLinks: 'پیوندهای قبلی',
  moreLinks: 'پیوندهای بیشتر',
  surfaceExtras: 'فضای کار شما',
  pinRange: (first, last, total) =>
    `${number(first)}–${number(last)} از ${number(total)}`,
  settings: 'تنظیمات',
  blurMode: 'محو کردن',
  updateFailed: 'انجام نشد.',
  backupFailed: 'پشتیبان‌گیری انجام نشد.',
  saved: 'ذخیره شد',
  undo: 'واگرد',
  openDrawer: 'باز کردن کشوی Deck: Deck · فاصله',
  inbox: 'ورودی',
  newPage: 'صفحهٔ تازه',
  newDeck: 'دستهٔ تازه',
  drawerHandle: 'Deck · فاصله',
  sortable: 'قابل جابه‌جایی',
  dragInstructions:
    'برای برداشتن مورد، کلید فاصله را بزنید. هنگام جابه‌جایی از کلیدهای جهت استفاده کنید. برای رها کردن دوباره فاصله و برای لغو Escape را بزنید.',
  dragPickedUp: (id) => `مورد ${id} برداشته شد.`,
  dragOver: (id, overId) => `مورد ${id} روی مقصد ${overId} قرار گرفت.`,
  dragLeft: (id) => `مورد ${id} دیگر روی مقصدی قرار ندارد.`,
  dragDropped: (id, overId) =>
    overId === undefined
      ? `مورد ${id} رها شد.`
      : `مورد ${id} روی مقصد ${overId} رها شد.`,
  dragCancelled: (id) => `جابه‌جایی لغو شد. مورد ${id} رها شد.`,
} satisfies SurfaceCatalog;
