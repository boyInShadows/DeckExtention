import { useEffect, useState } from 'react';

import type { Snapshot } from 'deck-schema';

import { panelStrings as strings } from '../i18n/panelStrings';
import { Icon } from './Icon';
import { BackupService } from '../storage/backup';
import { openDeckDatabase } from '../storage/database';
import { DeckRepository } from '../storage/repository';

interface RecoverySurfaceProps {
  error: unknown;
  onContinue: () => Promise<void>;
  onOpenSettings: () => Promise<void>;
}

export function RecoverySurface({
  error,
  onContinue,
  onOpenSettings,
}: RecoverySurfaceProps) {
  const [backups] = useState(
    () => new BackupService(new DeckRepository(), openDeckDatabase()),
  );
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [message, setMessage] = useState(
    error instanceof Error ? error.message : String(error),
  );
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void backups
      .listSnapshots()
      .then(setSnapshots)
      .catch((loadError: unknown) => {
        setMessage(
          loadError instanceof Error ? loadError.message : String(loadError),
        );
      });
  }, [backups]);

  const run = async (action: () => Promise<void>) => {
    setIsBusy(true);
    try {
      await action();
      setMessage('');
    } catch (actionError) {
      setMessage(
        actionError instanceof Error
          ? actionError.message
          : String(actionError),
      );
    } finally {
      setIsBusy(false);
    }
  };

  const exportData = async () => {
    const result = await backups.exportData();
    const url = URL.createObjectURL(
      new Blob([result.json], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `deck-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main data-deck="recovery" className="deck-recovery">
      <section data-deck="recovery-panel" className="deck-recovery__panel">
        <h1>{strings.recoveryTitle}</h1>
        <p>{strings.recoveryDetail}</p>
        {message ? <p role="alert">{message}</p> : null}
        <div className="deck-recovery__actions">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void run(exportData)}
          >
            {strings.recoveryExport}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void run(onContinue)}
          >
            {strings.recoveryContinue}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void run(onOpenSettings)}
          >
            {strings.recoveryOpenSettings}
          </button>
        </div>
        <p>{strings.recoveryRestoreWarning}</p>
        {snapshots.length === 0 ? <p>{strings.recoveryNoSnapshots}</p> : null}
        <ul data-deck="recovery-snapshots" className="deck-recovery-snapshots">
          {snapshots.map((snapshot) => (
            <li key={snapshot.id}>
              <time dateTime={new Date(snapshot.ts).toISOString()}>
                {new Date(snapshot.ts).toLocaleString()}
              </time>
              <button
                type="button"
                disabled={isBusy}
                onClick={() =>
                  void run(async () => {
                    await backups.restoreToFreshDatabase(snapshot.id);
                    window.location.reload();
                  })
                }
              >
                {strings.recoveryRestore}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export function RecoveryNotice({
  count,
  onOpenSettings,
}: {
  count: number;
  onOpenSettings: () => void;
}) {
  const [isDismissed, setIsDismissed] = useState(false);
  if (isDismissed) return null;
  return (
    <aside
      data-deck="recovery-notice"
      className="deck-recovery-notice"
      role="status"
    >
      <p>{strings.recoveryRecords(count)}</p>
      <button type="button" onClick={onOpenSettings}>
        {strings.settings}
      </button>
      <button
        type="button"
        onClick={() => setIsDismissed(true)}
        aria-label={strings.dismiss}
        title={strings.dismiss}
      >
        <Icon name="close" />
      </button>
    </aside>
  );
}
