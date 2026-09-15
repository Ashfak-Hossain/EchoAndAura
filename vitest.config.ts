import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

// Two projects:
//  - unit:        no external services. Part of `pnpm test` and `pnpm verify`.
//  - integration: requires a real Postgres (`docker compose up`). Run
//                 explicitly with `pnpm test:integration`. Deliberately kept
//                 OUT of the default gate so `pnpm verify` stays green while
//                 the Phase-3 reservation logic is unimplemented and the
//                 concurrency test is intentionally red.
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
