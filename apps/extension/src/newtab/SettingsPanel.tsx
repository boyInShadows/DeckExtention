import type { Settings, Snapshot, Theme } from 'deck-schema';
import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';

import { strings } from '../i18n/strings';
import { BackupService, openDeckDatabase } from '../storage';
import { processWallpaper } from '../wallpaper/processWallpaper';
import type { SurfaceData } from './bootstrap';

interface SettingsPanelProps {
  settings: Settings;
  repository: SurfaceData['repository'];
  onChange: (settings: Settings) => Promise<void>;
  onClose: () => void;
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'night', label: strings.themeNight },
  { value: 'day', label: strings.themeDay },
  { value: 'system', label: strings.themeSystem },
];

export default function SettingsPanel({
  settings,
  repository,
  onChange,
  onClose,
}: SettingsPanelProps) {
  const [error, setError] = useState('');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [backups] = useState(
    () => new BackupService(repository, openDeckDatabase()),
  );
  const update = (change: Partial<Settings>) =>
    onChange({ ...settings, ...change });

  useEffect(() => {
    void backups
      .listSnapshots()
      .then(setSnapshots)
      .catch((snapshotError: unknown) => {
        const detail =
          snapshotError instanceof Error
            ? snapshotError.message
            : String(snapshotError);
        setError(`${strings.updateFailed} ${detail}`);
      });
  }, [backups]);

  const showError = (actionError: unknown) => {
    const detail =
      actionError instanceof Error ? actionError.message : String(actionError);
    setError(`${strings.updateFailed} ${detail}`);
  };

  const exportData = async () => {
    try {
      const result = await backups.exportData();
      const url = URL.createObjectURL(
        new Blob([result.json], { type: 'application/json' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `deck-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      showError(exportError);
    }
  };

  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const document = JSON.parse(await file.text()) as unknown;
      await backups.previewImport(document, 'replace');
      if (!window.confirm(strings.importConfirm)) return;
      await backups.importData(document, 'replace');
      window.location.reload();
    } catch (importError) {
      const detail =
        importError instanceof Error
          ? importError.message
          : String(importError);
      setError(`${strings.updateFailed} ${detail}`);
    }
  };

  const restore = async (snapshot: Snapshot) => {
    if (!window.confirm(strings.restoreConfirm)) return;
    try {
      await backups.restoreSnapshot(snapshot.id);
      window.location.reload();
    } catch (restoreError) {
      showError(restoreError);
    }
  };

  const selectWallpaper = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const { gradient, luminance } = await processWallpaper(file);
      const blobKey = crypto.randomUUID();
      await repository.setWallpaperBlob(blobKey, file);
      await update({
        wallpaper: { kind: 'file', blobKey },
        wallpaperGradient: gradient,
        wallpaperLuminance: luminance,
      });
      setError('');
    } catch (wallpaperError) {
      const detail =
        wallpaperError instanceof Error
          ? wallpaperError.message
          : String(wallpaperError);
      setError(`${strings.updateFailed} ${detail}`);
    }
  };

  return (
    <aside
      data-deck="settings"
      className="deck-settings"
      aria-label={strings.settings}
    >
      <header>
        <h2>{strings.settings}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={strings.closeSettings}
        >
          ×
        </button>
      </header>
      <SettingsGroup title={strings.appearance}>
        <label>
          {strings.theme}
          <select
            value={settings.theme}
            onChange={(event) =>
              void update({ theme: event.currentTarget.value as Theme })
            }
          >
            {THEMES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {strings.yourName}
          <input
            value={settings.ownerName}
            onChange={(event) =>
              void update({ ownerName: event.currentTarget.value })
            }
          />
        </label>
        <Toggle
          label={strings.showSeconds}
          checked={settings.showSeconds}
          onChange={(showSeconds) => void update({ showSeconds })}
        />
        <Toggle
          label={strings.privacyBlur}
          checked={settings.isBlurred}
          onChange={(isBlurred) => void update({ isBlurred })}
        />
        <label>
          {strings.wallpaperDim}
          <input
            type="range"
            min="0"
            max="60"
            value={settings.wallpaperDim}
            onChange={(event) =>
              void update({ wallpaperDim: Number(event.currentTarget.value) })
            }
          />
        </label>
        <div className="deck-settings__wallpaper">
          <button
            type="button"
            onClick={() =>
              void update({
                wallpaper: { kind: 'none' },
                wallpaperGradient: null,
                wallpaperLuminance: null,
              })
            }
          >
            {strings.wallpaperNone}
          </button>
          <button
            type="button"
            onClick={() =>
              void update({
                wallpaper: { kind: 'color', token: 'canvas-raised' },
                wallpaperGradient: null,
                wallpaperLuminance: null,
              })
            }
          >
            {strings.wallpaperColor}
          </button>
          <label>
            {strings.wallpaperLocal}
            <input
              type="file"
              accept="image/*"
              onChange={(event) => void selectWallpaper(event)}
            />
          </label>
        </div>
      </SettingsGroup>
      <SettingsGroup title={strings.keys}>
        <Toggle
          label={strings.spaceOpensDrawer}
          checked={settings.canSpaceOpenDrawer}
          onChange={(canSpaceOpenDrawer) => void update({ canSpaceOpenDrawer })}
        />
        <p>{strings.keyHint}</p>
        <button
          type="button"
          onClick={() =>
            void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
          }
        >
          {strings.openShortcutSettings}
        </button>
      </SettingsGroup>
      <SettingsGroup title={strings.backups}>
        <p>{strings.backupHint}</p>
        {snapshots.length > 0 ? (
          snapshots.map((snapshot) => (
            <button
              key={snapshot.id}
              type="button"
              onClick={() => void restore(snapshot)}
            >
              {strings.restore} · {new Date(snapshot.ts).toLocaleDateString()}
            </button>
          ))
        ) : (
          <p>{strings.noBackups}</p>
        )}
        <button type="button" onClick={() => void exportData()}>
          {strings.exportData}
        </button>
        <label>
          {strings.importData}
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importData(event)}
          />
        </label>
      </SettingsGroup>
      <SettingsGroup title={strings.advanced}>
        <label>
          {strings.searchEngine}
          <input
            value={settings.searchUrlTemplate}
            onChange={(event) =>
              void update({ searchUrlTemplate: event.currentTarget.value })
            }
          />
        </label>
        <label>
          {strings.customCss}
          <textarea
            value={settings.customCss}
            onChange={(event) =>
              void update({ customCss: event.currentTarget.value })
            }
          />
        </label>
        <p>{strings.customCssHint}</p>
      </SettingsGroup>
      {error ? <p role="alert">{error}</p> : null}
    </aside>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section data-deck="settings-group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="deck-settings__toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}
