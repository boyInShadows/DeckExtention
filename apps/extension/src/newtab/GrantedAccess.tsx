import { useEffect, useState } from 'react';
import {
  BOOKMARKS_PERMISSION_DECLINED_KEY,
  TABS_PERMISSION_DECLINED_KEY,
  TAB_GROUPS_PERMISSION_DECLINED_KEY,
} from '../permissions/keys';

import { panelStrings as strings } from '../i18n/panelStrings';

/**
 * Optional permissions asked for in context elsewhere (AGENTS.md 3.1), listed
 * here once granted so each can be given back from Settings. Quick Save has
 * its own row in Advanced; bookmarks also have a row beside Import.
 */
const IN_CONTEXT_ACCESS = [
  {
    permission: 'tabs',
    name: strings.accessTabs,
    reason: strings.accessTabsReason,
  },
  {
    permission: 'tabGroups',
    name: strings.accessTabGroups,
    reason: strings.accessTabGroupsReason,
  },
  {
    permission: 'search',
    name: strings.accessSearch,
    reason: strings.accessSearchReason,
  },
  {
    permission: 'bookmarks',
    name: strings.bookmarks,
    reason: strings.bookmarksReason,
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
  const [declined, setDeclined] = useState<string[]>([]);

  useEffect(() => {
    chrome.permissions.getAll().then(({ permissions = [] }) => {
      setGranted(
        IN_CONTEXT_ACCESS.map(({ permission }) => permission).filter(
          (permission) => permissions.includes(permission),
        ),
      );
    }, onError);
  }, [onError]);
  useEffect(() => {
    chrome.storage.local
      .get([
        TABS_PERMISSION_DECLINED_KEY,
        TAB_GROUPS_PERMISSION_DECLINED_KEY,
        BOOKMARKS_PERMISSION_DECLINED_KEY,
      ])
      .then((items) => {
        setDeclined(
          [
            TABS_PERMISSION_DECLINED_KEY,
            TAB_GROUPS_PERMISSION_DECLINED_KEY,
            BOOKMARKS_PERMISSION_DECLINED_KEY,
          ].filter((key) => items[key] === true),
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

  const retry = async (key: string) => {
    try {
      await chrome.storage.local.remove(key);
      setDeclined((current) => current.filter((item) => item !== key));
    } catch (error) {
      onError(error);
    }
  };

  return (
    <>
      {IN_CONTEXT_ACCESS.filter(({ permission }) =>
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
      ))}
      {declined.map((key) => (
        <button
          key={key}
          type="button"
          data-deck="permission-retry"
          onClick={() => void retry(key)}
        >
          {key === TABS_PERMISSION_DECLINED_KEY
            ? strings.accessTabs
            : key === TAB_GROUPS_PERMISSION_DECLINED_KEY
              ? strings.accessTabGroups
              : strings.bookmarks}
          : {strings.retryAccess}
        </button>
      ))}
    </>
  );
}
