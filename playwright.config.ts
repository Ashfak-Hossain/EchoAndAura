import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against a PRODUCTION build on its own port, not the dev server.
 * `next dev` degrades under parallel server-action load after HMR churn
 * (sign-in requests stall), which made the suite flaky; a built server is
 * deterministic and is what CI runs. Next 16 keeps dev output in `.next/dev`,
 * so `pnpm dev` can keep running alongside.
 *
 * Needs `.env` (Next loads it for `next start`), Postgres + MinIO from
 * docker compose, and a seeded admin (`pnpm admin:create`).
 */
const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
