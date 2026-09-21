import { execFileSync } from 'node:child_process';
import postgres from 'postgres';

/**
 * Runs first in the Playwright web-server command, with DATABASE_URL already
 * pointed at the suite's own database (playwright.config.ts derives it:
 * `E2E_DATABASE_URL`, else the `DATABASE_URL` name with an `_e2e` suffix).
 * Every run starts from a clean slate: the database is created if missing,
 * migrated, the event/order tables truncated (users stay), and the admin
 * seeded. The suite used to run against the dev database and grew it by
 * hundreds of events per week, which made every admin page — and so every
 * sign-in — slower run after run.
 *
 * It is a script, not Playwright's `globalSetup`, because the web server
 * (and its readiness probe) starts before globalSetup runs.
 */
export function e2eDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.E2E_DATABASE_URL) return env.E2E_DATABASE_URL;
  const base = env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL (or E2E_DATABASE_URL) must be set for the e2e suite');
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_e2e`;
  return url.toString();
}

async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const name = target.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const sql = postgres(admin.toString(), { max: 1 });
  try {
    const [row] = await sql`select 1 as ok from pg_database where datname = ${name}`;
    if (!row) await sql.unsafe(`create database "${name.replace(/"/g, '""')}"`);
  } finally {
    await sql.end();
  }
}

export async function prepareDatabase(url: string): Promise<void> {
  await ensureDatabase(url);

  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url };
  const adminEmail = env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
  const adminPassword = env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery';
  execFileSync('pnpm', ['exec', 'drizzle-kit', 'migrate'], { env, stdio: 'inherit' });

  const sql = postgres(url, { max: 1 });
  try {
    // Orders reference events and ticket types; CASCADE takes the lot.
    // Settings too, so every run starts from the env fallbacks.
    await sql`truncate table orders, order_events, tickets, ticket_types, events, settings cascade`;
    const [admin] =
      await sql`select 1 as ok from users where email = ${env.E2E_ADMIN_EMAIL ?? 'admin@example.com'}`;
    if (!admin) {
      execFileSync('pnpm', ['exec', 'tsx', 'scripts/create-admin.ts', adminEmail, adminPassword], {
        env,
        stdio: 'inherit',
      });
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith('prepare-db.ts')) {
  const url = process.env.DATABASE_URL;
  if (!url || !/_e2e\b/.test(new URL(url).pathname)) {
    // Never truncate anything that is not the e2e database.
    console.error(
      `prepare-db: refusing to prepare ${url ?? '(unset)'} — the name must end in _e2e`,
    );
    process.exit(1);
  }
  prepareDatabase(url).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
