import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

// Two projects:
//  - unit:        no external services. Part of `pnpm test` and `pnpm verify`.
//  - integration: requires a real Postgres and MinIO (`docker compose up`).
//                 Run with `pnpm test:integration`; CI runs the Postgres-only
//                 subset (`test:integration:db`). Kept out of `pnpm verify`
//                 because verify also runs where MinIO is absent.
//
// The integration suite seeds rows through its own client on
// TEST_DATABASE_URL, while the code under test uses the shared `db` client
// on DATABASE_URL. Pointing DATABASE_URL at the test database for this
// project makes both sides talk to the same Postgres — and keeps the suite
// from ever writing to the dev database.
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          env: testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {},
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
});
