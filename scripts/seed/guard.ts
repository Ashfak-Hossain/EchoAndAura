/**
 * Where the dev seed may run. The seed writes demo data and, with
 * `--reset`, empties the event and order tables — so it refuses anything
 * that is not a local development database. Pure, so it is unit-tested.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres']);
const FORBIDDEN_ENVS = new Set(['production', 'staging']);

export class SeedTargetError extends Error {}

export interface SeedTarget {
  host: string;
  database: string;
}

/** @throws SeedTargetError with the reason the seed refuses to run. */
export function assertSeedTarget(
  env: { APP_ENV?: string; NODE_ENV?: string },
  databaseUrl: string | undefined,
): SeedTarget {
  for (const name of ['APP_ENV', 'NODE_ENV'] as const) {
    const value = env[name]?.toLowerCase();
    if (value && FORBIDDEN_ENVS.has(value)) {
      throw new SeedTargetError(`${name}=${value}: the seed only runs against a dev database.`);
    }
  }
  if (!databaseUrl) throw new SeedTargetError('DATABASE_URL is not set.');

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new SeedTargetError('DATABASE_URL is not a valid URL.');
  }
  const host = url.hostname;
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!LOCAL_HOSTS.has(host)) {
    throw new SeedTargetError(`Database host "${host}" is not local — refusing to seed it.`);
  }
  if (!database) throw new SeedTargetError('DATABASE_URL names no database.');
  if (database.endsWith('_e2e')) {
    throw new SeedTargetError(
      `"${database}" belongs to the e2e suite, which prepares its own data.`,
    );
  }
  return { host, database };
}
