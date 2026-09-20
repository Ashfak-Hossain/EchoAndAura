import { defineConfig, devices } from '@playwright/test';
import { e2eDatabaseUrl } from './tests/e2e/prepare-db';

/**
 * E2E runs against a PRODUCTION build on its own port, not the dev server.
 * `next dev` degrades under parallel server-action load after HMR churn
 * (sign-in requests stall), which made the suite flaky; a built server is
 * deterministic and is what CI runs. Next 16 keeps dev output in `.next/dev`,
 * so `pnpm dev` can keep running alongside.
 *
 * Needs `.env` (`pnpm test:e2e` loads it), Postgres + MinIO from docker
 * compose. The suite runs against its own database (see prepare-db.ts):
 * created, migrated, wiped and seeded with the admin on every run.
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
    command: `pnpm exec tsx tests/e2e/prepare-db.ts && pnpm build && pnpm start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    // The suite never sends real email, and the sign-in spec needs to follow
    // the magic link. The exposure flag is gated on APP_ENV (never
    // 'production' here), because `next start` forces NODE_ENV=production.
    // BETTER_AUTH_URL is the origin auth redirects to (magic-link verify →
    // callbackURL); the suite's server lives on this port. SITE_URL (canonical
    // and OG URLs) is deliberately left as configured — the specs assert it.
    env: {
      ...process.env,
      DATABASE_URL: e2eDatabaseUrl(),
      MAILER: 'log',
      E2E_EXPOSE_MAGIC_LINK: '1',
      APP_ENV: 'test',
      BETTER_AUTH_URL: baseURL,
    },
  },
});
