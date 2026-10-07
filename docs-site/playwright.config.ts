import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  use: { baseURL: 'http://127.0.0.1:4181' },
  webServer: {
    command:
      process.env.DOCS_PREVIEW_MODE === 'pages'
        ? 'node ../node_modules/wrangler/bin/wrangler.js pages dev out --ip 127.0.0.1 --port 4181 --compatibility-date=2026-10-01'
        : 'pnpm preview',
    url: 'http://127.0.0.1:4181',
    reuseExistingServer: false,
  },
  reporter: 'list',
});
