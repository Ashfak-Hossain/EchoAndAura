import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

/**
 * Runs first in the Playwright web-server command, with DATABASE_URL already
 * pointed at the suite's own database (playwright.config.ts derives it:
 * `E2E_DATABASE_URL`, else the `DATABASE_URL` name with an `_e2e` suffix).
 * Every run starts from a clean slate: the database is created if missing,
 * migrated, the event/order tables truncated (users stay), and the admin
 * seeded, two-factor included. The suite used to run against the dev database and grew it by
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

/**
 * ADR-044: the suite's server runs as the least-privilege app role, as in
 * production, so every page and action in the suite also proves the role's
 * grants are enough. The password only exists on the local and CI
 * Postgres; the integration test uses the same one, so the two suites
 * can't lock each other out.
 */
export const APP_ROLE = 'echoandaura_app';
export const LOCAL_APP_ROLE_PASSWORD = 'echoandaura-app-local-only';

export function e2eAppDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = new URL(e2eDatabaseUrl(env));
  url.username = APP_ROLE;
  url.password = LOCAL_APP_ROLE_PASSWORD;
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
    // Orders reference events and ticket types; CASCADE takes the lot
    // (the door tables are named anyway: their foreign keys are RESTRICT).
    // Settings too, so every run starts from the env fallbacks; sponsors,
    // so the home page and footer start with none.
    await sql`truncate table door_scans, door_passes, orders, order_events, tickets, promo_code_ticket_types, promo_codes, ticket_types, events, settings, sponsors cascade`;
    const [admin] = await sql`select 1 as ok from users where email = ${adminEmail}`;
    if (!admin) {
      execFileSync('pnpm', ['exec', 'tsx', 'scripts/create-admin.ts', adminEmail, adminPassword], {
        env,
        stdio: 'inherit',
      });
    }
    // ADR-049: the shared admin signs in with a code too. Re-seeded every
    // run (fresh codes, lockout cleared); fixtures/admin.ts works the code
    // out from the same test-only secret. Imported here, not at the top:
    // playwright.config.ts imports this file and needs none of it.
    const { enableTwoFactor } = await import('./fixtures/admin-credentials');
    await enableTwoFactor(sql, adminEmail.toLowerCase());
    // Run as the owner, like production (SERVER.md § 19).
    await sql.unsafe(readFileSync('ops/db/app-role.sql', 'utf8'));
    await sql.unsafe(`alter role ${APP_ROLE} password '${LOCAL_APP_ROLE_PASSWORD}'`);
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
