import { BackupService } from '../storage/backup';
import { openDeckDatabase } from '../storage/database';
import type { SurfaceData } from './bootstrap';

export async function downloadExport(
  repository: SurfaceData['repository'],
  format: 'json' | 'html' = 'json',
) {
  const result = await new BackupService(
    repository,
    openDeckDatabase(),
  ).exportData();
  const content =
    format === 'html'
      ? (await import('../storage/bookmarkExport')).serializeBookmarks(
          result.document,
        )
      : result.json;
  const url = URL.createObjectURL(
    new Blob([content], {
      type: format === 'html' ? 'text/html;charset=utf-8' : 'application/json',
    }),
  );
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `deck-${new Date().toISOString().slice(0, 10)}.${format}`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
