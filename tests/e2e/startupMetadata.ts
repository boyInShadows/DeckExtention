import type {} from './startupProbe';

export function observeStartupMetadata() {
  const profile = (window.__deckStartupProfile ??= {
    spans: [],
    renderMs: null,
  });
  function observe<T>(promise: Promise<T>, kind: string, startMs: number) {
    const finish = (isFailure: boolean) =>
      profile.spans.push({
        kind,
        startMs,
        endMs: performance.now(),
        stores: [],
        isFailure,
      });
    void promise.then(
      () => finish(false),
      () => finish(true),
    );
    return promise;
  }
  const databases = IDBFactory.prototype.databases;
  IDBFactory.prototype.databases = function () {
    const startMs = performance.now();
    return observe(databases.call(this), 'metadata:databases', startMs);
  };
  const local = chrome.storage.local;
  const get = local.get;
  // Forward every overload; only promise calls contribute timing spans.
  local.get = function (this: typeof local, ...args: unknown[]) {
    const startMs = performance.now();
    const result: unknown = Reflect.apply(get, this, args);
    if (result instanceof Promise) observe(result, 'metadata:storage', startMs);
    return result;
  } as typeof get;
}
