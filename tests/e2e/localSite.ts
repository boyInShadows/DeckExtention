import { test as base, expect } from '@playwright/test';
import { createServer } from 'node:http';

export function localSite(renderPage: (pathname: string) => string) {
  return base.extend<{ siteOrigin: string }>({
    siteOrigin: async ({ browserName }, use) => {
      expect(browserName).toBe('chromium');
      // Native extension tab creation can precede Playwright route interception.
      const server = createServer((request, response) => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1')
          .pathname;
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(renderPage(pathname));
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      try {
        const address = server.address();
        if (!address || typeof address === 'string')
          throw new Error('Local test server has no listening address');
        await use(`http://127.0.0.1:${address.port}`);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
      }
    },
  });
}
