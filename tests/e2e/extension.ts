import { chromium, type BrowserContext } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Shared launcher for the extension E2E specs. */
const EXTENSION_PATH = resolve('apps/extension/dist');

function chromeExecutable(): string {
  const playwrightRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const playwrightChromium = existsSync(playwrightRoot)
    ? readdirSync(playwrightRoot)
        .filter((name) => name.startsWith('chromium-'))
        .toSorted()
        .reverse()
        .map((name) => join(playwrightRoot, name, 'chrome-win64/chrome.exe'))
        .find(existsSync)
    : undefined;
  const candidates = [
    playwrightChromium,
    join(
      process.env.PROGRAMFILES ?? '',
      'Google/Chrome/Application/chrome.exe',
    ),
    join(
      process.env['PROGRAMFILES(X86)'] ?? '',
      'Google/Chrome/Application/chrome.exe',
    ),
  ];
  const executable = candidates.find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate)),
  );
  if (!executable)
    throw new Error('Google Chrome is required for extension E2E tests.');
  return executable;
}

export async function launchExtension(): Promise<BrowserContext> {
  return chromium.launchPersistentContext('', {
    executablePath: chromeExecutable(),
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
}
