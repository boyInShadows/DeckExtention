import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from 'react';

import { strings } from '../i18n/strings';
import { blackScrimForWhiteText } from '../wallpaper/contrast';
import type { SurfaceData } from './bootstrap';
import { Line } from './Line';
import { Pins } from './Pins';
import { greetingForHour } from './surfaceModel';

const SettingsPanel = lazy(() => import('./SettingsPanel'));
const CLOCK_UPDATE_MS = 1_000;
const BRIGHT_WALLPAPER_THRESHOLD = 0.18;

export interface SurfaceProps {
  initialData: SurfaceData;
}

export function Surface({ initialData }: SurfaceProps) {
  const [now, setNow] = useState(() => new Date());
  const [cards, setCards] = useState(initialData.cards);
  const [settings, setSettings] = useState(initialData.settings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [loadedWallpaper, setLoadedWallpaper] = useState<{
    key: string;
    url: string;
  } | null>(null);
  const [error, setError] = useState('');

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
      <style data-deck="custom-css">{settings.customCss}</style>
    </main>
  );
}
