import { defineManifest } from '@crxjs/vite-plugin';

import pkg from './package.json' with { type: 'json' };

/**
 * Deck's MV3 manifest.
 *
 * AGENTS.md section 3.1 is the rule this file exists to keep honest:
 * install-time permissions are exactly the four below and never grow. Anything
 * that can read a page, a tab list or a bookmark tree is optional and is asked
 * for in context, at the moment the feature is first used.
 *
 * On `commands` - corrected 2026-09-08, CTO decision. MasterPlan section 4 and
 * FableTasks P1.S1 both list `commands` as a fifth install-time permission.
 * That is a factual error in the plan: Chrome defines no `commands` permission.
 * `commands` is a top-level manifest key, declared below and working as
 * specified. Listing it under `permissions` would make Chrome show
 * "Permission 'commands' is unknown or URL pattern is malformed" on every
 * install - damaging the exact P3-Trustworthy property the rule protects.
 * Removing it changes no behaviour: the three hotkeys come from the manifest
 * key, not from a permission. Four permissions is a stronger trust story than
 * five, and one of the five was never real.
 */
const INSTALL_PERMISSIONS = [
  'storage',
  'unlimitedStorage',
  'favicon',
  'contextMenus',
] as const;

/**
 * Requested one at a time, with a one-sentence reason, and revocable from
 * Settings (MasterPlan I7).
 */
const OPTIONAL_PERMISSIONS = [
  'activeTab',
  'tabs',
  'tabGroups',
  'bookmarks',
  'search',
] as const;

export default defineManifest({
  manifest_version: 3,
  name: 'Deck',
  short_name: 'Deck',
  description:
    'Calm surface, deep drawer. A quiet new tab with your clock, one line and your links - offline, no account.',
  version: pkg.version,
  minimum_chrome_version: '116',

  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },

  chrome_url_overrides: {
    newtab: 'src/newtab/index.html',
  },

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  commands: {
    'quick-save': {
      suggested_key: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' },
      description: 'Save the current page to Deck’s Inbox',
    },
    stash: {
      suggested_key: { default: 'Ctrl+Shift+D', mac: 'Command+Shift+D' },
      description: 'Stash every tab in this window into a session deck',
    },
    'toggle-drawer': {
      suggested_key: { default: 'Ctrl+J', mac: 'Command+J' },
      description: 'Open or close the Deck drawer',
    },
  },

  permissions: [...INSTALL_PERMISSIONS],
  optional_permissions: [...OPTIONAL_PERMISSIONS],

  /** One shared instance, so an incognito tab sees the same decks. */
  incognito: 'spanning',
});
