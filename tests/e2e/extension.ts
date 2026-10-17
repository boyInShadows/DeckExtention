import { chromium, type BrowserContext } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { withCoverage } from './coverage';

/** Shared launcher for the extension E2E specs. */
const EXTENSION_PATH = resolve('apps/extension/dist');

function chromeExecutable(): string {
  const configured =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? process.env.CHROME_PATH;
  if (configured) {
    if (!existsSync(configured))
      throw new Error(
        `Configured Chromium executable not found: ${configured}`,
      );
    return configured;
  }
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;
  const cacheRoot =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? homedir(), 'ms-playwright')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library/Caches/ms-playwright')
        : join(homedir(), '.cache/ms-playwright'));
  const binary =
    process.platform === 'win32'
      ? 'chrome-win64/chrome.exe'
      : process.platform === 'darwin'
        ? 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'
        : 'chrome-linux/chrome';
  const cached = existsSync(cacheRoot)
    ? readdirSync(cacheRoot)
        .filter((name) => name.startsWith('chromium-'))
        .toSorted()
        .reverse()
        .map((name) => join(cacheRoot, name, binary))
        .find(existsSync)
    : undefined;
  const candidates = [
    cached,
    join(
      process.env.PROGRAMFILES ?? '',
      'Google/Chrome/Application/chrome.exe',
    ),
    join(
      process.env['PROGRAMFILES(X86)'] ?? '',
      'Google/Chrome/Application/chrome.exe',
    ),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  const executable = candidates.find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate)),
  );
  if (!executable)
    throw new Error('Chromium is required for extension E2E tests.');
  return executable;
}

export async function launchExtension(
  extensionPath = EXTENSION_PATH,
): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    executablePath: chromeExecutable(),
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  return withCoverage(context);
}
