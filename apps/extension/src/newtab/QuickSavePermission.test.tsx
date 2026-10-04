// @vitest-environment happy-dom
import { CAPTURE_PERMISSIONS } from 'deck-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { panelStrings as strings } from '../i18n/panelStrings';
import { click, render, type RenderResult } from '../testing/render';
import { QuickSavePermission } from './QuickSavePermission';

const PERMISSIONS = { permissions: [...CAPTURE_PERMISSIONS] };

function stubPermissions(isGranted: boolean) {
  const permissions = {
    contains: vi.fn(() => Promise.resolve(isGranted)),
    request: vi.fn(() => Promise.resolve(true)),
    remove: vi.fn(() => Promise.resolve(true)),
  };
  vi.stubGlobal('chrome', { permissions });
  return permissions;
}

async function settle(view: RenderResult): Promise<void> {
  await view.act(async () => {});
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('QuickSavePermission', () => {
  it('renders nothing until Chrome answers whether access is granted', async () => {
    vi.stubGlobal('chrome', {
      permissions: { contains: () => new Promise<boolean>(() => undefined) },
    });
    const view = await render(<QuickSavePermission onError={vi.fn()} />);
    expect(view.query('[data-deck="quick-save-permission"]')).toBeNull();
    view.unmount();
  });

  it('asks for the capture permissions with its reason on screen', async () => {
    const permissions = stubPermissions(false);
    const view = await render(<QuickSavePermission onError={vi.fn()} />);
    await settle(view);

    expect(permissions.contains).toHaveBeenCalledWith(PERMISSIONS);
    expect(view.container.textContent).toContain(strings.quickSaveReason);
    await view.act(() => click(view.getByText(strings.allowAccess)));

    expect(permissions.request).toHaveBeenCalledWith(PERMISSIONS);
    expect(view.getByText(strings.revokeAccess)).toBeTruthy();
    view.unmount();
  });

  it('stays on Allow when the user declines the prompt', async () => {
    const permissions = stubPermissions(false);
    permissions.request.mockResolvedValue(false);
    const view = await render(<QuickSavePermission onError={vi.fn()} />);
    await settle(view);
    await view.act(() => click(view.getByText(strings.allowAccess)));
    expect(view.getByText(strings.allowAccess)).toBeTruthy();
    view.unmount();
  });

  it('gives access back from the same row', async () => {
    const permissions = stubPermissions(true);
    const view = await render(<QuickSavePermission onError={vi.fn()} />);
    await settle(view);

    await view.act(() => click(view.getByText(strings.revokeAccess)));
    expect(permissions.remove).toHaveBeenCalledWith(PERMISSIONS);
    expect(view.getByText(strings.allowAccess)).toBeTruthy();
    view.unmount();
  });

  it('keeps showing Revoke when Chrome refuses to remove the permission', async () => {
    const permissions = stubPermissions(true);
    permissions.remove.mockResolvedValue(false);
    const view = await render(<QuickSavePermission onError={vi.fn()} />);
    await settle(view);
    await view.act(() => click(view.getByText(strings.revokeAccess)));
    expect(view.getByText(strings.revokeAccess)).toBeTruthy();
    view.unmount();
  });

  it('reports a failed check and a failed change to its caller', async () => {
    const checkError = new Error('check failed');
    const changeError = new Error('request failed');
    const permissions = stubPermissions(false);
    const onError = vi.fn();
    permissions.contains.mockRejectedValueOnce(checkError);
    const failed = await render(<QuickSavePermission onError={onError} />);
    await settle(failed);
    expect(onError).toHaveBeenCalledWith(checkError);
    expect(failed.query('[data-deck="quick-save-permission"]')).toBeNull();
    failed.unmount();

    permissions.request.mockRejectedValueOnce(changeError);
    const view = await render(<QuickSavePermission onError={onError} />);
    await settle(view);
    await view.act(() => click(view.getByText(strings.allowAccess)));
    expect(onError).toHaveBeenLastCalledWith(changeError);
    expect(view.getByText(strings.allowAccess)).toBeTruthy();
    view.unmount();
  });
});
