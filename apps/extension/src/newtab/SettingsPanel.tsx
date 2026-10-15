import {
  BACKUP_ERROR_KEY,
  BackgroundErrorSchema,
  SETTINGS_NOTICE_KEY,
  type Settings,
  type Snapshot,
  type Theme,
} from 'deck-schema';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import { useDismissable } from '../hooks/useDismissable';
import { Icon } from './Icon';
import { BackupService } from '../storage/backup';
import type { ImportMode, ImportPreview } from '../storage/backup';
import { openDeckDatabase } from '../storage/database';
import { parseDocumentJson } from '../storage/document';
import { processWallpaper } from '../wallpaper/processWallpaper';
import type { SurfaceData } from './bootstrap';
import { downloadExport } from './downloadExport';
import { BookmarkImport } from './BookmarkImport';
import { GrantedAccess } from './GrantedAccess';
import { KeymapEditor } from './KeymapEditor';
import { QuickSavePermission } from './QuickSavePermission';
import type { NoticeInput } from './ToastStack';

interface SettingsPanelProps {
  settings: Settings;
  repository: SurfaceData['repository'];
  onChange: (settings: Settings) => Promise<void>;
  /** Pages, decks or cards were written behind the surface's back. */
  onDataChange: () => void;
  onClose: () => void;
  notify: (notice: NoticeInput) => void;
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'night', label: strings.themeNight },
  { value: 'day', label: strings.themeDay },
  { value: 'system', label: strings.themeSystem },
];
const SEARCH_ENGINES = [
  { name: 'Google', url: 'https://www.google.com/search?q={query}' },
  { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}' },
  { name: 'Bing', url: 'https://www.bing.com/search?q={query}' },
  { name: 'Brave', url: 'https://search.brave.com/search?q={query}' },
] as const;
const WALLPAPER_COLORS = [
  'slate',
  'indigo',
  'teal',
  'rose',
  'sand',
  'moss',
] as const;
const currentTimestamp = () => Date.now();

function snapshotSummary(snapshot: Snapshot): string {
  const size = `${Math.ceil(new Blob([snapshot.blob]).size / 1024)} KB`;
  try {
    const document = parseDocumentJson(snapshot.blob);
    return strings.backupSummary({
      pages: document.pages.length,
      decks: document.decks.length,
      cards: document.cards.length,
      size,
    });
  } catch {
    return strings.backupUnreadable(size);
  }
}

export default function SettingsPanel({
  settings,
  repository,
  onChange,
  onDataChange,
  onClose,
  notify,
}: SettingsPanelProps) {
  const [backupError, setBackupError] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState(settings.ownerName);
  const [customCss, setCustomCss] = useState(settings.customCss);
  const [searchUrlTemplate, setSearchUrlTemplate] = useState(
    settings.searchUrlTemplate,
  );
  const [searchEngine, setSearchEngine] = useState(
    SEARCH_ENGINES.some(({ url }) => url === settings.searchUrlTemplate)
      ? settings.searchUrlTemplate
      : 'custom',
  );
  const latestSettings = useRef(settings);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const wallpaperInput = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [importDraft, setImportDraft] = useState<{
    document: unknown;
    mode: ImportMode;
    preview: ImportPreview;
  } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const importRequest = useRef(0);
  const [backups] = useState(
    () => new BackupService(repository, openDeckDatabase()),
  );
  const showError = useCallback(
    (actionError: unknown) => {
      const detail =
        actionError instanceof Error
          ? actionError.message
          : String(actionError);
      notify({ kind: 'error', text: `${strings.updateFailed} ${detail}` });
    },
    [notify],
  );
  const update = (change: Partial<Settings>) => {
    const next = { ...latestSettings.current, ...change };
    latestSettings.current = next;
    writeQueue.current = writeQueue.current
      .then(() => onChange(next))
      .catch(showError);
    return writeQueue.current;
  };

  const saveDraft = () => {
    const change: Partial<Settings> = {};
    if (ownerName !== latestSettings.current.ownerName)
      change.ownerName = ownerName;
    if (customCss !== latestSettings.current.customCss)
      change.customCss = customCss;
    if (searchUrlTemplate !== latestSettings.current.searchUrlTemplate)
      change.searchUrlTemplate = searchUrlTemplate;
    if (Object.keys(change).length) return update(change);
    return writeQueue.current;
  };

  const close = async () => {
    await saveDraft();
    document
      .querySelector<HTMLButtonElement>('[data-deck="settings-toggle"]')
      ?.focus();
    onClose();
  };

  useDismissable(panelRef, close, undefined, false);

  const loadSnapshots = useCallback(() => {
    void backups.listSnapshots().then(setSnapshots).catch(showError);
  }, [backups, showError]);

  useEffect(loadSnapshots, [loadSnapshots]);
  useEffect(() => {
    void chrome.storage.local
      .get(BACKUP_ERROR_KEY)
      .then((items) => {
        const result = BackgroundErrorSchema.safeParse(items[BACKUP_ERROR_KEY]);
        setBackupError(result.success ? result.data.message : null);
      })
      .catch(showError);
  }, [showError]);

  const retryBackup = async () => {
    try {
      await backups.createSnapshot();
      await repository.purge();
      await chrome.storage.local.remove(BACKUP_ERROR_KEY);
      setBackupError(null);
      loadSnapshots();
      notify({ kind: 'success', text: strings.backupSaved });
    } catch (error) {
      showError(error);
    }
  };

  const snapshotNow = async () => {
    try {
      await backups.createSnapshot();
      await chrome.storage.local.remove(BACKUP_ERROR_KEY);
      setBackupError(null);
      loadSnapshots();
      notify({ kind: 'success', text: strings.backupSaved });
    } catch (error) {
      showError(error);
    }
  };

  const afterImport = useCallback(
    (isSuccess: boolean) => {
      loadSnapshots();
      onDataChange();
      if (isSuccess) notify({ kind: 'success', text: strings.importSaved });
    },
    [loadSnapshots, notify, onDataChange],
  );

  const exportData = async () => {
    try {
      await downloadExport(repository);
      notify({ kind: 'success', text: strings.exportSaved });
    } catch (exportError) {
      showError(exportError);
    }
  };

  const readImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const request = ++importRequest.current;
    setImportDraft(null);
    event.currentTarget.value = '';
    try {
      const document = JSON.parse(await file.text()) as unknown;
      const preview = await backups.previewImport(document, 'merge');
      if (request === importRequest.current)
        setImportDraft({ document, mode: 'merge', preview });
    } catch (importError) {
      showError(importError);
    }
  };

  const chooseImportMode = async (mode: ImportMode) => {
    if (!importDraft) return;
    const request = ++importRequest.current;
    const document = importDraft.document;
    setImportDraft(null);
    try {
      const preview = await backups.previewImport(document, mode);
      if (request === importRequest.current)
        setImportDraft({ document, mode, preview });
    } catch (error) {
      showError(error);
    }
  };

  const applyImport = async () => {
    if (!importDraft || isImporting) return;
    setIsImporting(true);
    try {
      const { snapshotId, cards } = await backups.importData(
        importDraft.document,
        importDraft.mode,
      );
      onDataChange();
      onClose();
      notify({
        kind: 'success',
        text: strings.importedCards(cards),
        action: {
          label: strings.undo,
          run: async () => {
            await backups.restoreSnapshot(snapshotId);
            onDataChange();
            notify({ kind: 'success', text: strings.restoreSaved });
          },
        },
      });
    } catch (error) {
      showError(error);
    } finally {
      setIsImporting(false);
    }
  };

  const restore = async (snapshot: Snapshot) => {
    if (!window.confirm(strings.restoreConfirm)) return;
    try {
      await backups.restoreSnapshot(snapshot.id);
      await chrome.storage.local.set({
        [SETTINGS_NOTICE_KEY]: {
          message: strings.restoreSaved,
          createdAt: currentTimestamp(),
          kind: 'success',
        },
      });
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
    } catch (wallpaperError) {
      showError(wallpaperError);
    }
  };

  return (
    <>
      <button
        type="button"
        data-deck="settings-backdrop"
        className="deck-settings-backdrop"
        aria-label={strings.dismiss}
        onClick={() => void close()}
      />
      <aside
        ref={panelRef}
        data-deck="settings"
        className="deck-settings"
        aria-label={strings.settings}
      >
        <header>
          <h2>{strings.settings}</h2>
          <button
            type="button"
            onClick={() => void close()}
            aria-label={strings.closeSettings}
            title={strings.closeSettings}
          >
            <Icon name="close" size={20} />
          </button>
        </header>
        <SettingsGroup title={strings.appearance}>
          <div
            className="deck-settings__theme"
            role="group"
            aria-label={strings.theme}
          >
            {THEMES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={settings.theme === value}
                onClick={() => void update({ theme: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <label>
            {strings.yourName}
            <input
              value={ownerName}
              onChange={(event) => setOwnerName(event.currentTarget.value)}
              onBlur={saveDraft}
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
              onClick={() => wallpaperInput.current?.click()}
            >
              {strings.wallpaperLocal}
            </button>
            <input
              ref={wallpaperInput}
              className="deck-settings__file"
              type="file"
              aria-label={strings.wallpaperLocal}
              accept="image/*"
              onChange={(event) => void selectWallpaper(event)}
            />
          </div>
          <div
            className="deck-settings__swatches"
            role="group"
            aria-label={strings.wallpaperColor}
          >
            {WALLPAPER_COLORS.map((token) => (
              <button
                key={token}
                type="button"
                data-deck="wallpaper-swatch"
                className="deck-settings__swatch"
                style={{
                  backgroundColor: `var(--deck-color-wallpaper-${token})`,
                }}
                aria-label={`${strings.wallpaperColor}: ${token}`}
                aria-pressed={
                  settings.wallpaper.kind === 'color' &&
                  settings.wallpaper.token === token
                }
                onClick={() =>
                  void update({
                    wallpaper: { kind: 'color', token },
                    wallpaperGradient: null,
                    wallpaperLuminance: null,
                  })
                }
              />
            ))}
          </div>
        </SettingsGroup>
        <SettingsGroup title={strings.keys}>
          <Toggle
            label={strings.spaceOpensDrawer}
            checked={settings.canSpaceOpenDrawer}
            onChange={(canSpaceOpenDrawer) =>
              void update({ canSpaceOpenDrawer })
            }
          />
          <KeymapEditor
            overrides={settings.keymap}
            onChange={(keymap) => void update({ keymap })}
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
          {backupError ? (
            <p role="alert" data-deck="backup-error">
              {strings.backupError(backupError)}
            </p>
          ) : null}
          {backupError ? (
            <button
              type="button"
              data-deck="backup-retry"
              onClick={() => void retryBackup()}
            >
              {strings.backupRetry}
            </button>
          ) : null}
          <button
            type="button"
            data-deck="snapshot-now"
            onClick={() => void snapshotNow()}
          >
            {strings.snapshotNow}
          </button>
          <p data-deck="last-backup">
            {snapshots[0]
              ? strings.lastBackup(new Date(snapshots[0].ts).toLocaleString())
              : strings.noBackups}
          </p>
          {snapshots.length > 0
            ? snapshots.map((snapshot) => (
                <div
                  key={snapshot.id}
                  data-deck="snapshot"
                  className="deck-settings__snapshot"
                >
                  <span>{new Date(snapshot.ts).toLocaleString()}</span>
                  <small>{snapshotSummary(snapshot)}</small>
                  <button type="button" onClick={() => void restore(snapshot)}>
                    {strings.restore}
                  </button>
                </div>
              ))
            : null}
          <button type="button" onClick={() => void exportData()}>
            {strings.exportData}
          </button>
          <button type="button" onClick={() => importInput.current?.click()}>
            {strings.importData}
          </button>
          <input
            ref={importInput}
            className="deck-settings__file"
            type="file"
            aria-label={strings.importData}
            accept="application/json,.json"
            onChange={(event) => void readImport(event)}
          />
          {importDraft ? (
            <div
              data-deck="data-import-preview"
              className="deck-settings__import-preview"
            >
              <p>{strings.dataImportPreview(importDraft.preview)}</p>
              <div role="group" aria-label={strings.importMode}>
                {(['merge', 'replace'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={importDraft.mode === mode}
                    onClick={() => void chooseImportMode(mode)}
                  >
                    {mode === 'merge' ? strings.merge : strings.replace}
                  </button>
                ))}
              </div>
              <p>
                {importDraft.mode === 'merge'
                  ? strings.mergeHint
                  : strings.replaceHint}
              </p>
              <button
                type="button"
                disabled={isImporting}
                onClick={() => void applyImport()}
              >
                {isImporting ? strings.importing : strings.importConfirmButton}
              </button>
              <button type="button" onClick={() => setImportDraft(null)}>
                {strings.cancel}
              </button>
            </div>
          ) : null}
        </SettingsGroup>
        <SettingsGroup title={strings.import}>
          <BookmarkImport
            repository={repository}
            backups={backups}
            onImported={afterImport}
            onError={showError}
          />
        </SettingsGroup>
        <SettingsGroup title={strings.advanced}>
          <QuickSavePermission onError={showError} />
          <GrantedAccess onError={showError} />
          {settings.searchPermission === 'declined' ? (
            <button
              type="button"
              data-deck="search-permission-retry"
              onClick={() => void update({ searchPermission: undefined })}
            >
              {strings.searchPermissionRetry}
            </button>
          ) : null}
          <label>
            {strings.searchEngine}
            <select
              value={searchEngine}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setSearchEngine(value);
                if (value === 'custom') return;
                setSearchUrlTemplate(value);
                void update({ searchUrlTemplate: value });
              }}
            >
              {SEARCH_ENGINES.map(({ name, url }) => (
                <option key={name} value={url}>
                  {name}
                </option>
              ))}
              <option value="custom">{strings.searchCustom}</option>
            </select>
          </label>
          {searchEngine === 'custom' ? (
            <label>
              {strings.searchTemplate}
              <input
                value={searchUrlTemplate}
                onChange={(event) =>
                  setSearchUrlTemplate(event.currentTarget.value)
                }
                onBlur={saveDraft}
              />
            </label>
          ) : null}
          <label>
            {strings.customCss}
            <textarea
              value={customCss}
              onChange={(event) => setCustomCss(event.currentTarget.value)}
              onBlur={saveDraft}
            />
          </label>
          <p>{strings.customCssHint}</p>
        </SettingsGroup>
      </aside>
    </>
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
        className="deck-settings__checkbox"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}
