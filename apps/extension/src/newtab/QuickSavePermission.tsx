import { CAPTURE_PERMISSIONS } from 'deck-schema';
import { useEffect, useState } from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';

const PERMISSIONS = { permissions: [...CAPTURE_PERMISSIONS] };

/**
 * Quick Save's one-time grant (FableTasks P2.S4, AGENTS.md 3.1): requested in
 * context with a one-sentence reason, revocable from the same row.
 */
export function QuickSavePermission({
  onError,
}: {
  onError: (error: unknown) => void;
}) {
  const [isGranted, setIsGranted] = useState<boolean | null>(null);

  useEffect(() => {
    chrome.permissions.contains(PERMISSIONS).then(setIsGranted, onError);
  }, [onError]);

  const change = async (shouldGrant: boolean) => {
    try {
      if (shouldGrant)
        setIsGranted(await chrome.permissions.request(PERMISSIONS));
      else setIsGranted(!(await chrome.permissions.remove(PERMISSIONS)));
    } catch (permissionError) {
      onError(permissionError);
    }
  };

  if (isGranted === null) return null;
  return (
    <div data-deck="quick-save-permission">
      <p>
        <strong>{strings.quickSave}</strong> {strings.quickSaveReason}
      </p>
      <button type="button" onClick={() => void change(!isGranted)}>
        {isGranted ? strings.revokeAccess : strings.allowAccess}
      </button>
    </div>
  );
}
