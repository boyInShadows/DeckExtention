export interface StartupSpan {
  kind: string;
  startMs: number;
  endMs: number;
  stores: string[];
  isFailure: boolean;
}

export interface StartupProfile {
  spans: StartupSpan[];
  renderMs: number | null;
}

declare global {
  interface Window {
    __deckStartupProfile?: StartupProfile;
  }
}

// Init-script order is unspecified; each hook can initialize the same state.
export function observeDatabaseOpen() {
  const profile = (window.__deckStartupProfile ??= {
    spans: [],
    renderMs: null,
  });
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (...args: Parameters<typeof open>) {
    const startMs = performance.now();
    const request = open.apply(this, args);
    const finish = (event: Event) =>
      profile.spans.push({
        kind: 'database-open',
        startMs,
        endMs: performance.now(),
        stores: [],
        isFailure: event.type === 'error',
      });
    request.addEventListener('success', finish, { once: true });
    request.addEventListener('error', finish, { once: true });
    return request;
  };
}

export function observeDatabaseTransactions() {
  const profile = (window.__deckStartupProfile ??= {
    spans: [],
    renderMs: null,
  });
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (
    ...args: Parameters<typeof transaction>
  ) {
    const startMs = performance.now();
    const tx = transaction.apply(this, args);
    const finish = (event: Event) =>
      profile.spans.push({
        kind: `transaction:${tx.mode}`,
        startMs,
        endMs: performance.now(),
        stores: Array.from(tx.objectStoreNames),
        isFailure: event.type === 'abort',
      });
    tx.addEventListener('complete', finish, { once: true });
    tx.addEventListener('abort', finish, { once: true });
    return tx;
  };
}

export function observeSurfaceRender() {
  const profile = (window.__deckStartupProfile ??= {
    spans: [],
    renderMs: null,
  });
  const observer = new MutationObserver(() => {
    if (!document.querySelector('[data-deck="clock"]')) return;
    profile.renderMs = performance.now();
    performance.mark('probe-surface-render');
    observer.disconnect();
  });
  observer.observe(document, { childList: true, subtree: true });
}
