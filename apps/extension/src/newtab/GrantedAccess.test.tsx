// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { panelStrings as strings } from '../i18n/panelStrings';
import { click, render, type RenderResult } from '../testing/render';
import { GrantedAccess } from './GrantedAccess';

function stubPermissions(granted: chrome.permissions.Permissions) {
  const permissions = {
    getAll: vi.fn(() => Promise.resolve(granted)),
    remove: vi.fn((_change: chrome.permissions.Permissions) =>
      Promise.resolve(true),
    ),
  };
  vi.stubGlobal('chrome', { permissions });
  return permissions;
}

async function settle(view: RenderResult): Promise<void> {
  await view.act(async () => {});
}

function rows(view: RenderResult): string[] {
  return view
    .getAll('[data-deck="granted-access"] strong')
    .map((row) => row.textContent ?? '');
}

/** The item at `index`, failing the test loudly when it is missing. */
function nth<T>(items: readonly T[], index = 0): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Expected an item at ${index}`);
  return item;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('GrantedAccess', () => {
  it('lists only the in-context permissions that are granted', async () => {
    stubPermissions({ permissions: ['storage', 'search'] });
    const view = await render(<GrantedAccess onError={vi.fn()} />);
    await settle(view);
    expect(rows(view)).toEqual([strings.accessSearch]);
    expect(view.container.textContent).toContain(strings.accessSearchReason);
    view.unmount();
  });

  it('shows nothing when Chrome reports no permission list', async () => {
    stubPermissions({});
    const view = await render(<GrantedAccess onError={vi.fn()} />);
    await settle(view);
    expect(rows(view)).toEqual([]);
    view.unmount();
  });

  it('removes a revoked permission from the list', async () => {
    const permissions = stubPermissions({ permissions: ['tabs', 'search'] });
    const view = await render(<GrantedAccess onError={vi.fn()} />);
    await settle(view);
    expect(rows(view)).toEqual([strings.accessTabs, strings.accessSearch]);

    const tabsRevoke = nth(view.getAll('[data-deck="granted-access"] button'));
    await view.act(() => click(tabsRevoke));
    expect(permissions.remove).toHaveBeenCalledWith({ permissions: ['tabs'] });
    expect(rows(view)).toEqual([strings.accessSearch]);
    view.unmount();
  });

  it('keeps the row when Chrome does not remove the permission', async () => {
    const permissions = stubPermissions({ permissions: ['tabs'] });
    permissions.remove.mockResolvedValue(false);
    const view = await render(<GrantedAccess onError={vi.fn()} />);
    await settle(view);
    await view.act(() => click(view.getByText(strings.revokeAccess)));
    expect(rows(view)).toEqual([strings.accessTabs]);
    view.unmount();
  });

  it('reports failures to list or remove permissions', async () => {
    const listError = new Error('list failed');
    const removeError = new Error('remove failed');
    const permissions = stubPermissions({ permissions: ['tabs'] });
    const onError = vi.fn();
    permissions.getAll.mockRejectedValueOnce(listError);
    const failed = await render(<GrantedAccess onError={onError} />);
    await settle(failed);
    expect(onError).toHaveBeenCalledWith(listError);
    expect(rows(failed)).toEqual([]);
    failed.unmount();

    permissions.remove.mockRejectedValueOnce(removeError);
    const view = await render(<GrantedAccess onError={onError} />);
    await settle(view);
    await view.act(() => click(view.getByText(strings.revokeAccess)));
    expect(onError).toHaveBeenLastCalledWith(removeError);
    expect(rows(view)).toEqual([strings.accessTabs]);
    view.unmount();
  });
});
