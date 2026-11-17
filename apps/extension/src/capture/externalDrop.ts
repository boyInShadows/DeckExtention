import { UrlSchema } from 'deck-schema';
import type { DeckRepository } from '../storage/repository';
import { panelStrings as strings } from '../i18n/panelStrings';
import type { NoticeInput } from '../newtab/ToastStack';
import { openCard } from '../drawer/inboxActions';
import { saveDroppedLink } from './saveDroppedLink';
import type { DropDestination } from './dropTarget';

export function parseDroppedUrl(
  uriList: string,
  plainText: string,
): string | null {
  const lines = (uriList || plainText)
    .split(/\r\n|[\r\n]/)
    .map((line) => line.trim())
    .filter((line) => line && (!uriList || !line.startsWith('#')));
  if (lines.length !== 1) return null;
  if (lines[0] && /\s/.test(lines[0])) return null;
  const parsed = UrlSchema.safeParse(lines[0]);
  if (!parsed.success || !/^https?:\/\//i.test(parsed.data)) return null;
  const url = new URL(parsed.data);
  return url.hostname && !/[%\s]/.test(url.hostname) ? url.href : null;
}

export async function handleExternalLinkDrop({
  repository,
  uriList,
  plainText,
  destination,
  onSaved,
  notify,
}: {
  repository: DeckRepository;
  uriList: string;
  plainText: string;
  destination: DropDestination | null;
  onSaved: () => void;
  notify: (notice: NoticeInput) => void;
}): Promise<void> {
  const url = parseDroppedUrl(uriList, plainText);
  if (!url) throw new Error(strings.dropOneLink);
  if (!destination) throw new Error(strings.dropDestination);
  const result = await saveDroppedLink(repository, url, destination);
  if (result.kind === 'duplicate') {
    notify({
      kind: 'info',
      text: strings.alreadySavedIn(result.duplicate.location),
      action: {
        label: strings.openSavedLink,
        run: async () => {
          await openCard(repository, result.duplicate.card, true);
        },
      },
    });
    return;
  }
  onSaved();
  notify({ kind: 'success', text: strings.saved });
}
