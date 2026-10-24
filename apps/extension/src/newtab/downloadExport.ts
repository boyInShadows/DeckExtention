import { BackupService } from '../storage/backup';
import { openDeckDatabase } from '../storage/database';
import type { SurfaceData } from './bootstrap';

export async function downloadExport(repository: SurfaceData['repository']) {
  const { json } = await new BackupService(
    repository,
    openDeckDatabase(),
  ).exportData();
  const url = URL.createObjectURL(
    new Blob([json], { type: 'application/json' }),
  );
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `deck-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
