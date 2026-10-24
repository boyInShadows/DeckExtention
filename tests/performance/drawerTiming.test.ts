import type { Page } from '@playwright/test';
import { expect, it, vi } from 'vitest';

import { measureDrawerOpen } from '../e2e/drawerTiming';

function timerPage() {
  const measurement = Promise.withResolvers<number>();
  const probe = {
    evaluate: vi.fn(() => measurement.promise),
    dispose: vi.fn(async () => undefined),
  };
  const installed = Promise.withResolvers<typeof probe>();
  const keyboard = { press: vi.fn(async () => undefined) };
  const page = {
    evaluate: vi.fn(() => measurement.promise),
    evaluateHandle: vi.fn(() => installed.promise),
    keyboard,
  } as unknown as Page;
  return { page, keyboard, installed, measurement, probe };
}

it('arms the browser timer before sending the drawer shortcut', async () => {
  const timer = timerPage();
  const measured = measureDrawerOpen(timer.page);
  try {
    await Promise.resolve();
    expect(timer.keyboard.press).not.toHaveBeenCalled();
    timer.installed.resolve(timer.probe);
    await vi.waitFor(() => expect(timer.keyboard.press).toHaveBeenCalledOnce());
    expect(timer.keyboard.press).toHaveBeenCalledWith('Control+J');
    timer.measurement.resolve(24);
    expect(await measured).toBe(24);
    expect(timer.probe.dispose).toHaveBeenCalledOnce();
  } finally {
    timer.installed.resolve(timer.probe);
    timer.measurement.resolve(24);
  }
});

it('propagates an invalid browser measurement and releases its handle', async () => {
  const timer = timerPage();
  const measured = measureDrawerOpen(timer.page);
  timer.installed.resolve(timer.probe);
  const rejected = expect(measured).rejects.toThrow('Missing drawer keydown');
  await vi.waitFor(() => expect(timer.keyboard.press).toHaveBeenCalledOnce());
  timer.measurement.reject(new Error('Missing drawer keydown'));
  await rejected;
  expect(timer.probe.dispose).toHaveBeenCalledOnce();
});
