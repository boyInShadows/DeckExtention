/**
 * Deck's MV3 service worker.
 *
 * It exists in P1.S1 so the manifest is loadable and the three commands have a
 * home, and it does nothing else on purpose. What lands here later:
 *   P1.S2  the daily `chrome.alarms` snapshot and the oplog writer
 *   P2.S4  the `quick-save` command, the "Save to Deck" context menus and the
 *          toast injected via `activeTab` at hotkey time only
 *   P3     `stash`
 *
 * There is no `chrome.commands.onCommand` listener yet: an empty handler would
 * be a lie about what the hotkeys do, and Chrome is happy for a declared
 * command to have no listener until the feature exists.
 */

export {};
