import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { strings } from '../i18n/strings';
import { WorkspaceDnd } from '../drawer/WorkspaceDnd';
import { blackScrimForWhiteText } from '../wallpaper/contrast';
import type { SurfaceData } from './bootstrap';
import { Line } from './Line';
import { Pins } from './Pins';
import { greetingForHour } from './surfaceModel';

const SettingsPanel = lazy(() => import('./SettingsPanel'));
const loadDrawer = () => import('../drawer/drawer');
const Drawer = lazy(loadDrawer);
const CLOCK_UPDATE_MS = 1_000;
const DRAWER_EXIT_MS = 320;
const BRIGHT_WALLPAPER_THRESHOLD = 0.18;

export interface SurfaceProps {
  initialData: SurfaceData;
}

export function Surface({ initialData }: SurfaceProps) {
  const [now, setNow] = useState(() => new Date());
  const [cards, setCards] = useState(initialData.cards);
  const [decks, setDecks] = useState(initialData.decks);
  const [pages, setPages] = useState(initialData.pages);
  const [settings, setSettings] = useState(initialData.settings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isDrawerMounted, setIsDrawerMounted] = useState(false);
  const [loadedWallpaper, setLoadedWallpaper] = useState<{
    key: string;
    url: string;
  } | null>(null);
  const [error, setError] = useState('');
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
        setError('');
      } catch (saveError) {
        const detail =
          saveError instanceof Error ? saveError.message : String(saveError);
        setError(`${strings.updateFailed} ${detail}`);
      }
    },
    [initialData.repository],
  );

  useEffect(() => {
    let idle: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      idle = window.requestIdleCallback(() => {
        void loadDrawer().catch((loadError: unknown) => {
          const detail =
            loadError instanceof Error ? loadError.message : String(loadError);
          setError(`${strings.updateFailed} ${detail}`);
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (idle !== null) window.cancelIdleCallback(idle);
    };
  }, []);

  useEffect(() => {
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

  useEffect(() => {
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
        .catch((loadError: unknown) => {
          const detail =
            loadError instanceof Error ? loadError.message : String(loadError);
          setError(`${strings.updateFailed} ${detail}`);
        });
    }
    return () => {
      isCurrent = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [initialData.repository, settings.wallpaper]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isInput =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;
      if (event.key.toLocaleLowerCase() === 'b' && !isInput) {
        void saveSettings({ ...settings, isBlurred: !settings.isBlurred });
      }
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
            notify={setError}
            canSpaceOpenDrawer={settings.canSpaceOpenDrawer}
            openDrawer={openDrawer}
          />
          <Pins
            cards={cards}
            defaultDeckId={initialData.defaultDeckId}
            repository={initialData.repository}
            onCardsChange={setCards}
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
        {error ? (
          <p data-deck="error" className="deck-error" role="alert">
            {error}
          </p>
        ) : null}
        <Suspense fallback={null}>
          {isSettingsOpen ? (
            <SettingsPanel
              settings={settings}
              repository={initialData.repository}
              onChange={saveSettings}
              onClose={() => setIsSettingsOpen(false)}
            />
          ) : null}
        </Suspense>
        <Suspense fallback={null}>
          {isDrawerMounted ? (
            <Drawer
              data={initialData}
              cards={cards}
              decks={decks}
              pages={pages}
              isOpen={isDrawerOpen}
              onClose={closeDrawer}
              onCardsChange={setCards}
              onDecksChange={setDecks}
              onPagesChange={setPages}
              onError={setError}
            />
          ) : null}
        </Suspense>
        <style data-deck="custom-css">{settings.customCss}</style>
      </main>
    </WorkspaceDnd>
  );
}
