/**
 * ADR-036: applies the committed migrations in ./drizzle — what production
 * runs before every deploy (the `migrate` service in docker-compose.prod.yml,
 * from the worker image). drizzle-orm's own migrator, so production needs no
 * drizzle-kit (a dev dependency); it keeps the same journal table as
 * `pnpm db:migrate`, so both see the same history.
 *
 * Each migration runs in one transaction with the rest: a failure applies
 * nothing, exits 1, and the new web and worker never start.
 *
 *   node dist/ops/migrate.mjs            (in the image)
 *   MIGRATIONS_DIR defaults to ./drizzle
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — see docs/ENVIRONMENT.md');
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    const started = Date.now();
    await migrate(drizzle(client), {
      migrationsFolder: process.env.MIGRATIONS_DIR ?? './drizzle',
    });
    console.log(`Migrations up to date (${Date.now() - started} ms)`);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
