import { useEffect, useState } from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';

/**
 * Optional permissions asked for in context elsewhere (AGENTS.md 3.1), listed
 * here once granted so each can be given back from Settings. Quick Save and
 * bookmarks have their own rows next to the feature that uses them.
 */
const IN_CONTEXT_ACCESS = [
  {
    permission: 'tabs',
    name: strings.accessTabs,
    reason: strings.accessTabsReason,
  },
  {
    permission: 'search',
    name: strings.accessSearch,
    reason: strings.accessSearchReason,
  },
] as const satisfies readonly {
  permission: chrome.runtime.ManifestOptionalPermission;
  name: string;
  reason: string;
}[];

type AccessPermission = (typeof IN_CONTEXT_ACCESS)[number]['permission'];

export function GrantedAccess({
  onError,
}: {
  onError: (error: unknown) => void;
}) {
  const [granted, setGranted] = useState<AccessPermission[]>([]);

  useEffect(() => {
    chrome.permissions.getAll().then(({ permissions = [] }) => {
      setGranted(
        IN_CONTEXT_ACCESS.map(({ permission }) => permission).filter(
          (permission) => permissions.includes(permission),
        ),
      );
    }, onError);
  }, [onError]);

  const revoke = async (permission: AccessPermission) => {
    try {
      if (await chrome.permissions.remove({ permissions: [permission] }))
        setGranted((current) => current.filter((item) => item !== permission));
    } catch (permissionError) {
      onError(permissionError);
    }
  };

  return IN_CONTEXT_ACCESS.filter(({ permission }) =>
    granted.includes(permission),
  ).map(({ permission, name, reason }) => (
    <div key={permission} data-deck="granted-access">
      <p>
        <strong>{name}</strong> {reason}
      </p>
      <button type="button" onClick={() => void revoke(permission)}>
        {strings.revokeAccess}
      </button>
    </div>
  ));
}
