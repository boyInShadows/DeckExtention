export async function toggleDrawer(tab?: chrome.tabs.Tab): Promise<void> {
  try {
    const active =
      tab ??
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (active?.id !== undefined) {
      try {
        const reply: unknown = await chrome.runtime.sendMessage({
          drawer: active.id,
        });
        if (reply === true) return;
      } catch {
        // A normal site has no Deck page to answer.
      }
    }
    await chrome.tabs.create({
      url: chrome.runtime.getURL('src/newtab/index.html#page=last'),
    });
    await chrome.storage.local.remove('drawerCommandError');
  } catch (error) {
    await chrome.storage.local.set({
      drawerCommandError: {
        message: error instanceof Error ? error.message : String(error),
        occurredAt: Date.now(),
      },
    });
  }
}
