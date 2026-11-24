import type { CaptureCatalog } from '../catalogs';

export const captureStrings = {
  menuSavePage: 'ذخیره در Deck',
  menuSaveLink: 'ذخیرهٔ پیوند در Deck',
  saved: 'در ورودی ذخیره شد',
  savedHint: '↩ افزودن یادداشت · ⌫ واگرد',
  duplicate: 'قبلاً ذخیره شده در',
  duplicateHint: '↩ باز کردن Deck',
  inbox: 'ورودی',
  addNote: 'افزودن یادداشت',
  undo: 'واگرد',
  openDeck: 'باز کردن Deck',
  notePlaceholder: 'یادداشت کنید، سپس Enter را بزنید',
  noteSaved: 'یادداشت ذخیره شد',
  undone: 'از ورودی برداشته شد',
  unsupportedPage:
    'Deck نمی‌تواند این صفحه را ذخیره کند. فقط صفحه‌های وب قابل ذخیره‌اند.',
  savedWithoutToast: 'در ورودی ذخیره شد:',
  needsPermission:
    'ذخیرهٔ سریع به دسترسی این برگه نیاز دارد. در تنظیمات ← پیشرفته اجازه دهید.',
  permissionReason: 'ذخیرهٔ سریع این برگه را برای ذخیرهٔ پیوند می‌خواند.',
  permissionPromptFailed:
    'Chrome نتوانست درخواست دسترسی را نشان دهد. ذخیرهٔ سریع را در تنظیمات ← پیشرفته فعال کنید.',
  saveFailed: 'ذخیرهٔ سریع انجام نشد:',
  toastFailed: 'انجام نشد. Deck را برای بررسی باز کنید.',
} satisfies CaptureCatalog;
