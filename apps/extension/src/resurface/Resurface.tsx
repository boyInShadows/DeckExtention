import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, Deck, Page } from 'deck-schema';
import { panelStrings as strings } from '../i18n/panelStrings';
import { Icon } from '../newtab/Icon';
import type { NoticeInput } from '../newtab/ToastStack';
import type { DeckRepository } from '../storage/repository';
import {
  localDay,
  type DailyResurface,
  type ResurfaceAction,
} from '../storage/resurface';
import './resurface.css';

interface Props {
  repository: DeckRepository;
  cards: Card[];
  decks: Deck[];
  pages: Page[];
  now: Date;
  isVisible: boolean;
  onDataChange: () => void;
  notify: (notice: NoticeInput) => void;
}

export default function Resurface({
  repository,
  cards,
  decks,
  pages,
  now,
  isVisible,
  onDataChange,
  notify,
}: Props) {
  const [daily, setDaily] = useState<DailyResurface | null>(null);
  const [isPending, setIsPending] = useState(false);
  const isBusy = useRef(false);
  const revision = useRef(0);
  const panel = useRef<HTMLElement>(null);
  const day = localDay(now.getTime());
  const reportError = useCallback(
    (error: unknown) => {
      notify({
        kind: 'error',
        text: `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`,
      });
    },
    [notify],
  );
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const next = await repository.getResurface();
      if (request === revision.current) setDaily(next);
    } catch (error) {
      if (request !== revision.current) return;
      setDaily(null);
      reportError(error);
    }
  }, [repository, reportError]);
  useEffect(() => {
    const reload = () => {
      void refresh();
    };
    reload();
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', reload);
    return () => {
      revision.current += 1;
      window.removeEventListener('focus', reload);
      document.removeEventListener('visibilitychange', reload);
    };
  }, [refresh, cards, decks, pages, day]);

  const act = async (action: ResurfaceAction) => {
    if (!daily?.card || isBusy.current) return;
    isBusy.current = true;
    setIsPending(true);
    try {
      const saved = await repository.resolveResurface(
        daily.card,
        daily.day,
        action,
      );
      if (panel.current?.contains(document.activeElement))
        document
          .querySelector<HTMLInputElement>('[data-deck="line"] input')
          ?.focus();
      revision.current += 1;
      setDaily(null);
      onDataChange();
      if (action === 'open') await chrome.tabs.create({ url: saved.url });
      if (action === 'keep')
        notify({ kind: 'success', text: strings.resurfaceKept });
      if (action === 'trash')
        notify({
          kind: 'success',
          text: strings.resurfaceTrashed,
          action: {
            label: strings.undo,
            run: async () => {
              await repository.restoreCards([saved.id]);
              onDataChange();
            },
          },
        });
    } catch (error) {
      reportError(error);
      await refresh();
    } finally {
      isBusy.current = false;
      setIsPending(false);
    }
  };
  if (!isVisible || !daily?.card || daily.day !== day) return null;
  return (
    <section
      ref={panel}
      data-deck="resurface"
      data-deck-id={daily.card.id}
      className="deck-resurface deck-blurrable"
      aria-labelledby="deck-resurface-title"
    >
      <div data-deck="resurface-header">
        <h2 id="deck-resurface-title">{strings.resurface}</h2>
        <button
          type="button"
          data-deck="resurface-dismiss"
          disabled={isPending}
          aria-label={strings.resurfaceDismiss}
          title={strings.resurfaceDismiss}
          onClick={() => void act('dismiss')}
        >
          <Icon name="close" />
        </button>
      </div>
      <p data-deck="resurface-hint">{strings.resurfaceHint}</p>
      <p data-deck="resurface-link" title={daily.card.title}>
        {daily.card.title}
        <small>{daily.card.hostname}</small>
      </p>
      <div data-deck="resurface-actions">
        <button
          type="button"
          data-deck="resurface-open"
          disabled={isPending}
          onClick={() => void act('open')}
        >
          {strings.resurfaceOpen}
        </button>
        <button
          type="button"
          data-deck="resurface-keep"
          disabled={isPending}
          onClick={() => void act('keep')}
        >
          {strings.resurfaceKeep}
        </button>
        <button
          type="button"
          data-deck="resurface-trash"
          disabled={isPending}
          onClick={() => void act('trash')}
        >
          {strings.resurfaceTrash}
        </button>
      </div>
    </section>
  );
}
