import { useCallback, useEffect, useRef } from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import { isTypingTarget } from '../keys/keymap';
import { playSpring } from '../motion/spring';
import { Icon } from './Icon';

const TOAST_DURATION_MS = 4_000;

export interface NoticeInput {
  kind: 'info' | 'success' | 'error';
  text: string;
  action?: { label: string; run: () => Promise<void> | void };
}

export interface Notice extends NoticeInput {
  id: string;
}

export default function ToastStack({
  notices,
  dismiss,
  notify,
}: {
  notices: Notice[];
  dismiss: (id: string) => void;
  notify: (notice: NoticeInput) => void;
}) {
  const running = useRef(new Set<string>());
  const undo = [...notices]
    .reverse()
    .find(({ action }) => action?.label === strings.undo);
  const run = useCallback(
    async (notice: Notice) => {
      if (running.current.has(notice.id)) return;
      running.current.add(notice.id);
      dismiss(notice.id);
      try {
        await notice.action?.run();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        notify({ kind: 'error', text: `${strings.updateFailed} ${detail}` });
      }
    },
    [dismiss, notify],
  );

  useEffect(() => {
    if (!undo) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 'z' ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        isTypingTarget(event.target)
      )
        return;
      event.preventDefault();
      void run(undo);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [run, undo]);

  return (
    <div
      data-deck="toast-stack"
      className="deck-toast-stack"
      role="status"
      aria-live="polite"
    >
      {notices.map((notice) => (
        <Toast key={notice.id} notice={notice} dismiss={dismiss} run={run} />
      ))}
    </div>
  );
}

function Toast({
  notice,
  dismiss,
  run,
}: {
  notice: Notice;
  dismiss: (id: string) => void;
  run: (notice: Notice) => Promise<void>;
}) {
  const toastRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const animation =
      toastRef.current && playSpring(toastRef.current, true, '1rem', true);
    return () => animation?.cancel();
  }, []);
  useEffect(() => {
    if (notice.kind === 'error') return;
    const timer = window.setTimeout(
      () => dismiss(notice.id),
      TOAST_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [dismiss, notice]);

  return (
    <div
      ref={toastRef}
      data-deck="toast"
      data-kind={notice.kind}
      role={notice.kind === 'error' ? 'alert' : undefined}
      className="deck-toast"
    >
      <span className="deck-blurrable">{notice.text}</span>
      {notice.action ? (
        <button type="button" onClick={() => void run(notice)}>
          {notice.action.label}
        </button>
      ) : null}
      {notice.kind === 'error' ? (
        <button
          type="button"
          aria-label={strings.dismiss}
          title={strings.dismiss}
          onClick={() => dismiss(notice.id)}
        >
          <Icon name="close" />
        </button>
      ) : null}
    </div>
  );
}
