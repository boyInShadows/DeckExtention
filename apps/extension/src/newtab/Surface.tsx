import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import {
  MAINTENANCE_MESSAGE,
  OPEN_PAGE_HASH_PREFIX,
  OPEN_SETTINGS_HASH,
} from 'deck-schema/constants';

import { strings } from '../i18n/strings';
import { WorkspaceDnd } from '../drawer/WorkspaceDnd';
import type { UndoAction } from '../drawer/UndoToast';
import type { Notice, NoticeInput } from './ToastStack';
import { blackScrimForWhiteText } from '../wallpaper/contrast';
import type { SurfaceData } from './bootstrap';
import { Line } from './Line';
import { Pins } from './Pins';
import { greetingForHour } from './surfaceModel';
import type ResurfacePanel from '../resurface/Resurface';

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
const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;
const DRAWER_EXIT_MS = 480;
const BRIGHT_WALLPAPER_THRESHOLD = 0.18;

export interface SurfaceProps {
  initialData: SurfaceData;
}

export function Surface({ initialData }: SurfaceProps) {
  const recoveryIssueCount = initialData.repository.getRecoveryIssueCount();
  const [now, setNow] = useState(new Date());
  const [cards, setCards] = useState(initialData.cards);
  const [decks, setDecks] = useState(initialData.decks);
  const [pages, setPages] = useState(initialData.pages);
  const [settings, setSettings] = useState(initialData.settings);
  const [Resurface, setResurface] = useState<typeof ResurfacePanel | null>(
    null,
  );
  const keymap = useMemo(
    () => new Map(settings.keymap.map(({ action, chord }) => [action, chord])),
    [settings.keymap],
  );
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(
    location.hash === OPEN_SETTINGS_HASH,
  );
  // A `#page=` link (Quick Save's "open Deck") arrives with the drawer open.
  const [isDrawerOpen, setIsDrawerOpen] = useState(
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
  const drawerExitTimer = useRef(0);
  const beforeDrawerClose = useRef<(() => Promise<boolean>) | null>(null);
  const tabId = useRef(0);

  const openDrawer = useCallback(() => {
    clearTimeout(drawerExitTimer.current);
    setIsSettingsOpen(false);
    setIsDrawerMounted(true);
    requestAnimationFrame(() => setIsDrawerOpen(true));
  }, []);

  const closeDrawer = useCallback(async () => {
    if ((await beforeDrawerClose.current?.()) === false) return;
    setIsDrawerOpen(false);
    drawerExitTimer.current = window.setTimeout(
      setIsDrawerMounted,
      DRAWER_EXIT_MS,
      false,
    );
  }, []);

  const saveSettings = useCallback(
    async (next: typeof settings) => {
      try {
        const saved = await initialData.repository.setSettings(next);
        setSettings(saved);
        document.documentElement.dataset.theme = saved.theme;
        notify({ kind: 'success', text: strings.saved });
      } catch (saveError) {
        notifyFailure(saveError);
      }
    },
    [initialData.repository, notify, notifyFailure],
  );

  // A bulk write from Settings can also replace appearance and key bindings.
  const reloadWorkspace = useCallback(() => {
    void Promise.all([
      initialData.repository.listPages(),
      initialData.repository.listDecks(),
      initialData.repository.listCards(),
      initialData.repository.getSettings(),
    ])
      .then(([storedPages, storedDecks, storedCards, storedSettings]) => {
        setPages(storedPages);
        setDecks(storedDecks);
        setCards(storedCards);
        setSettings(storedSettings);
        document.documentElement.dataset.theme = storedSettings.theme;
      })
      .catch(notifyFailure);
  }, [initialData, notifyFailure]);

  useEffect(() => {
    if (!settings.showResurface) return;
    let isCurrent = true;
    void import('../resurface/Resurface')
      .then((module) => {
        if (isCurrent) setResurface(() => module.default);
      })
      .catch((error: unknown) => {
        if (isCurrent) notifyFailure(error);
      });
    return () => {
      isCurrent = false;
    };
  }, [settings.showResurface, notifyFailure]);

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
      document.documentElement.dataset.deckReady = 'true';
      if (performance.getEntriesByName('deck-ready').length === 0) {
        performance.mark('deck-ready');
        performance.measure('deck-interactive', 'deck-start', 'deck-ready');
      }
      idle = window.requestIdleCallback(() => {
        void loadDrawer().catch(notifyFailure);
        void chrome.runtime
          .sendMessage({ type: MAINTENANCE_MESSAGE })
          .then((reply: { error: string | null }) => {
            if (reply.error) notifyFailure(reply.error);
          })
          .catch(notifyFailure);
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (idle !== null) window.cancelIdleCallback(idle);
      clearTimeout(drawerExitTimer.current);
    };
  }, [notifyFailure]);

  useLayoutEffect(() => {
    if (!tabId.current)
      void chrome.tabs
        .getCurrent()
        .then((tab) => (tabId.current = tab?.id ?? 0), notifyFailure);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        (isDrawerOpen ? closeDrawer : openDrawer)();
        return;
      }
      if (
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      if (event.key === (keymap.get('blur') ?? 'b'))
        void saveSettings({ ...settings, isBlurred: !settings.isBlurred });
      if (event.key === '?') setIsHelpOpen(true);
    };
    const onMessage = (
      message: { drawer?: number } | null,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: boolean) => void,
    ) => {
      if (message?.drawer !== tabId.current) return;
      (isDrawerOpen ? closeDrawer : openDrawer)();
      sendResponse(true);
    };
    window.addEventListener('keydown', onKeyDown);
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, [
    closeDrawer,
    isDrawerOpen,
    keymap,
    notifyFailure,
    openDrawer,
    saveSettings,
    settings,
  ]);

  useEffect(() => {
    const period = settings.showSeconds ? SECOND_MS : MINUTE_MS;
    let timer: number;
    const tick = () => {
      setNow(new Date());
      timer = window.setTimeout(tick, period - (Date.now() % period));
    };
    timer = window.setTimeout(tick, period - (Date.now() % period));
    return () => window.clearTimeout(timer);
  }, [settings.showSeconds]);

  useLayoutEffect(() => {
    document.body.style.backgroundImage = settings.wallpaperGradient ?? '';
    return () => {
      document.body.style.backgroundImage = '';
    };
  }, [settings.wallpaperGradient]);

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

  const time = now.toLocaleTimeString(undefined, {
    timeStyle: settings.showSeconds ? 'medium' : 'short',
    hour12: settings.use12HourClock,
  });
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
          {settings.showDate && (
            <p data-deck="date">
              {now.toLocaleDateString(undefined, { dateStyle: 'full' })}
            </p>
          )}
          {settings.ownerName ? (
            <p data-deck="greeting" className="deck-greeting">
              {greetingForHour(now.getHours())}, {settings.ownerName}
            </p>
          ) : null}
          <Line
            onDataChange={reloadWorkspace}
            notifyNotice={notify}
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
            repository={initialData.repository}
            onCardsChange={setCards}
            offerUndo={offerUndo}
            notify={notify}
          />
        </div>
        <Suspense>
          {settings.showResurface && Resurface ? (
            <Resurface
              repository={initialData.repository}
              cards={cards}
              decks={decks}
              pages={pages}
              now={now}
              isVisible={!isDrawerMounted && !isSettingsOpen && !isHelpOpen}
              onDataChange={reloadWorkspace}
              notify={notify}
            />
          ) : null}
        </Suspense>
        <nav data-deck="surface-controls" className="deck-surface-controls">
          <button
            type="button"
            data-deck="blur-toggle"
            onClick={() =>
              void saveSettings({ ...settings, isBlurred: !settings.isBlurred })
            }
            aria-pressed={settings.isBlurred}
            aria-label={strings.blurMode}
            title={strings.blurMode}
          >
            <svg aria-hidden="true">
              <circle cx="10" cy="10" r="7" />
              <path d="M10 3v14" />
            </svg>
          </button>
          <button
            type="button"
            data-deck="settings-toggle"
            onClick={() => setIsSettingsOpen(true)}
            aria-label={strings.settings}
            title={strings.settings}
          >
            <svg aria-hidden="true">
              <circle cx="10" cy="10" r="3" />
              <circle cx="10" cy="10" r="8" strokeDasharray="3 2" />
            </svg>
          </button>
        </nav>
        <button
          type="button"
          data-deck="drawer-handle"
          onClick={openDrawer}
          aria-label={strings.openDrawer}
        >
          <svg aria-hidden="true">
            <path d="m2 11 6-6 6 6" />
          </svg>{' '}
          {strings.drawerHandle}
        </button>
        <Suspense>
          {recoveryIssueCount ? (
            <RecoveryNotice
              count={recoveryIssueCount}
              onOpenSettings={() => setIsSettingsOpen(true)}
            />
          ) : null}
        </Suspense>
        <Suspense>
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
        <Suspense>
          {isDrawerMounted ? (
            <Drawer
              keymapOverrides={settings.keymap}
              data={initialData}
              cards={cards}
              decks={decks}
              pages={pages}
              isOpen={isDrawerOpen}
              onClose={closeDrawer}
              beforeCloseRef={beforeDrawerClose}
              onCardsChange={setCards}
              onDecksChange={setDecks}
              onPagesChange={setPages}
              onError={notifyError}
              onSuccess={(text) => notify({ kind: 'success', text })}
              offerUndo={offerUndo}
            />
          ) : null}
        </Suspense>
        <Suspense>
          {isHelpOpen ? (
            <HelpOverlay
              keymapOverrides={settings.keymap}
              onClose={() => setIsHelpOpen(false)}
            />
          ) : null}
        </Suspense>
        <Suspense>
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
