import { setTimeout as sleep } from 'node:timers/promises';
import { ensureDatabase } from '../tests/e2e/prepare-db';

/**
 * Creates the integration suite's database (TEST_DATABASE_URL) if it is
 * missing. Postgres starts beside the dev container, not before it, so the
 * first tries may find it still starting.
 */
async function main(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log('TEST_DATABASE_URL is not set: no test database created.');
    return;
  }
  for (let attempt = 1; ; attempt++) {
    try {
      await ensureDatabase(url);
      return;
    } catch (err: unknown) {
      if (attempt === 30) throw err;
      await sleep(1000);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
