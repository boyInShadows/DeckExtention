import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { OPEN_PAGE_HASH_PREFIX, OPEN_SETTINGS_HASH } from 'deck-schema';

import { strings } from '../i18n/strings';
import { WorkspaceDnd } from '../drawer/WorkspaceDnd';
import type { UndoAction } from '../drawer/UndoToast';
import type { Notice, NoticeInput } from './ToastStack';
import { blackScrimForWhiteText } from '../wallpaper/contrast';
import type { SurfaceData } from './bootstrap';
import { Line } from './Line';
import { Pins } from './Pins';
import { greetingForHour } from './surfaceModel';

const SettingsPanel = lazy(() => import('./SettingsPanel'));
const HelpOverlay = lazy(() => import('./HelpOverlay'));
const RecoveryNotice = lazy(() =>
  import('./RecoverySurface').then(({ RecoveryNotice }) => ({
    default: RecoveryNotice,
  })),
);
const loadDrawer = () => import('../drawer/drawer');
const Drawer = lazy(loadDrawer);
const ToastStack = lazy(() => import('./ToastStack'));
const CLOCK_UPDATE_MS = 1_000;
const DRAWER_EXIT_MS = 320;
const BRIGHT_WALLPAPER_THRESHOLD = 0.18;

export interface SurfaceProps {
  initialData: SurfaceData;
}

export function Surface({ initialData }: SurfaceProps) {
  const recoveryIssueCount = initialData.repository.getRecoveryIssueCount();
  const [now, setNow] = useState(() => new Date());
  const [cards, setCards] = useState(initialData.cards);
  const [decks, setDecks] = useState(initialData.decks);
  const [pages, setPages] = useState(initialData.pages);
  const [settings, setSettings] = useState(initialData.settings);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(
    () => location.hash === OPEN_SETTINGS_HASH,
  );
  // A `#page=` link (Quick Save's "open Deck") arrives with the drawer open.
  const [isDrawerOpen, setIsDrawerOpen] = useState(() =>
    location.hash.startsWith(OPEN_PAGE_HASH_PREFIX),
  );
  const [isDrawerMounted, setIsDrawerMounted] = useState(isDrawerOpen);
  const [loadedWallpaper, setLoadedWallpaper] = useState<{
    key: string;
    url: string;
  } | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const notify = useCallback((notice: NoticeInput) => {
    setNotices((current) => [
      ...current,
      { ...notice, id: crypto.randomUUID() },
    ]);
  }, []);
  const notifyError = useCallback(
    (text: string) => notify({ kind: 'error', text }),
    [notify],
  );
  const notifyFailure = useCallback(
    (error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      notifyError(`${strings.updateFailed} ${detail}`);
    },
    [notifyError],
  );
  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);
  const offerUndo = useCallback(
    (action: UndoAction) => {
      notify({
        kind: 'success',
        text: action.label,
        action: { label: strings.undo, run: action.undo },
      });
    },
    [notify],
  );
  const drawerExitTimer = useRef<number | null>(null);

  const openDrawer = useCallback(() => {
    if (drawerExitTimer.current !== null) {
      window.clearTimeout(drawerExitTimer.current);
      drawerExitTimer.current = null;
    }
    setIsSettingsOpen(false);
    setIsDrawerMounted(true);
    window.requestAnimationFrame(() => setIsDrawerOpen(true));
  }, []);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    drawerExitTimer.current = window.setTimeout(() => {
      setIsDrawerMounted(false);
      drawerExitTimer.current = null;
    }, DRAWER_EXIT_MS);
  }, []);

  useEffect(
    () => () => {
      if (drawerExitTimer.current !== null) {
        window.clearTimeout(drawerExitTimer.current);
      }
    },
    [],
  );

  const saveSettings = useCallback(
    async (next: typeof settings) => {
      try {
        const saved = await initialData.repository.setSettings(next);
        setSettings(saved);
        document.documentElement.dataset.theme = saved.theme;
        document.body.style.backgroundImage = saved.wallpaperGradient ?? '';
        notify({ kind: 'success', text: strings.saved });
      } catch (saveError) {
        notifyFailure(saveError);
      }
    },
    [initialData.repository, notify, notifyFailure],
  );

  // A bulk write from Settings (bookmark import) - re-read what changed.
  const reloadWorkspace = useCallback(() => {
    const { repository } = initialData;
    void Promise.all([
      repository.listPages(),
      repository.listDecks(),
      repository.listCards(),
    ])
      .then(([storedPages, storedDecks, storedCards]) => {
        setPages(storedPages);
        setDecks(storedDecks);
        setCards(storedCards);
      })
      .catch(notifyFailure);
  }, [initialData, notifyFailure]);

  // Quick Save hands over here when its toast could not show (P2.S4).
  useEffect(() => {
    // Consumed once: a reload of this tab should start calm again.
    if (location.hash === OPEN_SETTINGS_HASH)
      history.replaceState(null, '', location.pathname);
    void import('./pendingNotices')
      .then(({ readPendingNotices }) => readPendingNotices(notify))
      .catch((noticeError: unknown) => notifyError(String(noticeError)));
  }, [notify, notifyError]);

  useEffect(() => {
    let idle: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      idle = window.requestIdleCallback(() => {
        void loadDrawer().catch(notifyFailure);
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (idle !== null) window.cancelIdleCallback(idle);
    };
  }, [notifyFailure]);

  useLayoutEffect(() => {
    if (!isDrawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      const isInput =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;
      if (event.key === 'Escape' && !isInput) closeDrawer();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [closeDrawer, isDrawerOpen]);

  useLayoutEffect(() => {
    const toggleDrawer = () => {
      if (isDrawerOpen) closeDrawer();
      else openDrawer();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLocaleLowerCase() === 'j') {
        event.preventDefault();
        toggleDrawer();
      }
    };
    const onMessage = (message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'deck:toggle-drawer'
      ) {
        toggleDrawer();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, [closeDrawer, isDrawerOpen, openDrawer]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.documentElement.dataset.deckReady = 'true';
      if (performance.getEntriesByName('deck-ready').length === 0) {
        performance.mark('deck-ready');
        performance.measure('deck-interactive', 'deck-start', 'deck-ready');
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(
      () => setNow(new Date()),
      CLOCK_UPDATE_MS,
    );
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let objectUrl: string | null = null;
    let isCurrent = true;
    if (settings.wallpaper.kind === 'file') {
      const { blobKey } = settings.wallpaper;
      void initialData.repository
        .getWallpaperBlob(blobKey)
        .then(async (blob) => {
          if (!blob || !isCurrent) return;
          objectUrl = URL.createObjectURL(blob);
          const image = new Image();
          image.src = objectUrl;
          await image.decode();
          if (isCurrent)
            setLoadedWallpaper({
              key: blobKey,
              url: objectUrl,
            });
        })
        .catch(notifyFailure);
    }
    return () => {
      isCurrent = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [initialData.repository, notifyFailure, settings.wallpaper]);

  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isInput =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;
      const isPlain = !event.ctrlKey && !event.altKey && !event.metaKey;
      if (isInput || !isPlain) return;
      // Surface keys are single characters (keys/keymap.ts), so a plain
      // comparison here keeps the keymap code off the first paint.
      const blurKey = settings.keymap.find(({ action }) => action === 'blur');
      if (event.key === (blurKey?.chord ?? 'b')) {
        void saveSettings({ ...settings, isBlurred: !settings.isBlurred });
      }
      if (event.key === '?') setIsHelpOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveSettings, settings]);

  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: settings.showSeconds ? '2-digit' : undefined,
    hour12: false,
  }).format(now);
  const wallpaperUrl =
    settings.wallpaper.kind === 'file' &&
    loadedWallpaper?.key === settings.wallpaper.blobKey
      ? loadedWallpaper.url
      : null;
  const surfaceStyle = {
    '--deck-wallpaper-gradient': settings.wallpaperGradient ?? 'none',
    '--deck-wallpaper-image': wallpaperUrl ? `url("${wallpaperUrl}")` : 'none',
    '--deck-wallpaper-dim': `${settings.wallpaperDim / 100}`,
    '--deck-auto-scrim': `${blackScrimForWhiteText(settings.wallpaperLuminance ?? 0)}`,
    '--deck-wallpaper-color':
      settings.wallpaper.kind === 'color'
        ? `var(--deck-color-wallpaper-${settings.wallpaper.token})`
        : 'transparent',
  } as CSSProperties;

  return (
    <WorkspaceDnd>
      <main
        data-deck="surface"
        className="deck-surface"
        style={surfaceStyle}
        data-wallpaper-kind={settings.wallpaper.kind}
        data-blurred={settings.isBlurred || undefined}
        data-bright-wallpaper={
          (settings.wallpaperLuminance ?? 0) > BRIGHT_WALLPAPER_THRESHOLD ||
          undefined
        }
        data-drawer-open={isDrawerMounted || undefined}
      >
        <div
          data-deck="wallpaper"
          className="deck-wallpaper"
          data-loaded={Boolean(wallpaperUrl) || undefined}
        />
        <div data-deck="surface-column" className="deck-surface__column">
          <time
            data-deck="clock"
            className="deck-clock"
            dateTime={now.toISOString()}
          >
            {time}
          </time>
          {settings.ownerName ? (
            <p data-deck="greeting" className="deck-greeting">
              {greetingForHour(now.getHours())}, {settings.ownerName}
            </p>
          ) : null}
          <Line
            cards={cards}
            settings={settings}
            repository={initialData.repository}
            openSettings={() => setIsSettingsOpen(true)}
            saveSettings={saveSettings}
            notify={notifyError}
            notifyInfo={(text) => notify({ kind: 'info', text })}
            notifySuccess={(text) => notify({ kind: 'success', text })}
            canSpaceOpenDrawer={settings.canSpaceOpenDrawer}
            openHelp={() => setIsHelpOpen(true)}
            openDrawer={openDrawer}
          />
          <Pins
            cards={cards}
            defaultDeckId={initialData.defaultDeckId}
            repository={initialData.repository}
            onCardsChange={setCards}
            offerUndo={offerUndo}
            notify={notify}
          />
        </div>
        <nav data-deck="surface-controls" className="deck-surface-controls">
          <button
            type="button"
            data-deck="blur-toggle"
            onClick={() =>
              void saveSettings({ ...settings, isBlurred: !settings.isBlurred })
            }
            aria-pressed={settings.isBlurred}
          >
            ◉
          </button>
          <button
            type="button"
            data-deck="settings-toggle"
            onClick={() => setIsSettingsOpen(true)}
            aria-label={strings.settings}
          >
            ⚙
          </button>
        </nav>
        <button
          type="button"
          data-deck="drawer-handle"
          className="deck-drawer-handle"
          onClick={openDrawer}
          aria-label={strings.openDrawer}
        >
          {strings.drawerHandle}
        </button>
        <Suspense fallback={null}>
          {recoveryIssueCount ? (
            <RecoveryNotice
              count={recoveryIssueCount}
              onOpenSettings={() => setIsSettingsOpen(true)}
            />
          ) : null}
        </Suspense>
        <Suspense fallback={null}>
          {isSettingsOpen ? (
            <SettingsPanel
              settings={settings}
              repository={initialData.repository}
              onChange={saveSettings}
              onDataChange={reloadWorkspace}
              onClose={() => setIsSettingsOpen(false)}
              notify={notify}
            />
          ) : null}
        </Suspense>
        <Suspense fallback={null}>
          {isDrawerMounted ? (
            <Drawer
              keymapOverrides={settings.keymap}
              data={initialData}
              cards={cards}
              decks={decks}
              pages={pages}
              isOpen={isDrawerOpen}
              onClose={closeDrawer}
              onCardsChange={setCards}
              onDecksChange={setDecks}
              onPagesChange={setPages}
              onError={notifyError}
              onSuccess={(text) => notify({ kind: 'success', text })}
              offerUndo={offerUndo}
            />
          ) : null}
        </Suspense>
        <Suspense fallback={null}>
          {isHelpOpen ? (
            <HelpOverlay
              keymapOverrides={settings.keymap}
              onClose={() => setIsHelpOpen(false)}
            />
          ) : null}
        </Suspense>
        <Suspense fallback={null}>
          {notices.length ? (
            <ToastStack
              notices={notices}
              dismiss={dismissNotice}
              notify={notify}
            />
          ) : null}
        </Suspense>
        <style data-deck="custom-css">{settings.customCss}</style>
      </main>
    </WorkspaceDnd>
  );
}
