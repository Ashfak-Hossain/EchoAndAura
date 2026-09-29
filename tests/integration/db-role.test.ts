import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { APP_ROLE as ROLE, LOCAL_APP_ROLE_PASSWORD } from '../e2e/prepare-db';

/**
 * ADR-044: ops/db/app-role.sql on a real Postgres, as production runs it —
 * by the owner that runs migrations. Then the checks run AS the app role.
 *
 * Every table in `public` is checked, not a list, so a new table can't
 * silently miss its grants; a new append-only table must be added both to
 * app-role.sql and to APPEND_ONLY here.
 */
const APPEND_ONLY = new Set(['order_events', 'door_scans']);
const ROLE_SQL = readFileSync('ops/db/app-role.sql', 'utf8');

const ownerUrl = process.env.DATABASE_URL;
if (!ownerUrl) throw new Error('DATABASE_URL must be set for the integration suite');

const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
let app: postgres.Sql;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  // Twice: the script must be safe to re-run (after a restore, a new table).
  await owner.unsafe(ROLE_SQL);
  await owner.unsafe(ROLE_SQL);
  // The script sets no password (production uses psql's \password). The
  // local one is shared with the e2e suite, so neither run locks out the other.
  await owner.unsafe(`ALTER ROLE ${ROLE} PASSWORD '${LOCAL_APP_ROLE_PASSWORD}'`);
  const url = new URL(ownerUrl);
  url.username = ROLE;
  url.password = LOCAL_APP_ROLE_PASSWORD;
  app = postgres(url.toString(), { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await app?.end();
  await owner.end();
});

async function publicTables(): Promise<string[]> {
  const rows = await owner<{ name: string }[]>`
    select table_name as name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name`;
  return rows.map((r) => r.name);
}

async function can(table: string, privilege: string): Promise<boolean> {
  const [row] = await owner<{ ok: boolean }[]>`
    select has_table_privilege(${ROLE}, ${`public.${table}`}, ${privilege}) as ok`;
  return row?.ok ?? false;
}

describe('the app database role (ADR-044)', () => {
  it('is an ordinary login role: no superuser, no role or database creation', async () => {
    const [role] = await owner<
      { rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolbypassrls: boolean }[]
    >`select rolsuper, rolcreaterole, rolcreatedb, rolbypassrls from pg_roles where rolname = ${ROLE}`;
    expect(role).toEqual({
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolbypassrls: false,
    });
  });

  it('reads and writes every table, except rewriting the append-only ones', async () => {
    const tables = await publicTables();
    expect(tables).toEqual(expect.arrayContaining(['orders', 'order_events', 'door_scans']));
    for (const table of tables) {
      for (const privilege of ['SELECT', 'INSERT']) {
        expect(await can(table, privilege), `${privilege} on ${table}`).toBe(true);
      }
      for (const privilege of ['UPDATE', 'DELETE']) {
        expect(await can(table, privilege), `${privilege} on ${table}`).toBe(
          !APPEND_ONLY.has(table),
        );
      }
      expect(await can(table, 'TRUNCATE'), `TRUNCATE on ${table}`).toBe(false);
    }
  });

  it('is refused when it tries to rewrite the audit trail or change the schema', async () => {
    // Postgres checks privileges before looking for rows: `where false` is enough.
    await expect(app`update order_events set note = 'x' where false`).rejects.toThrow(
      /permission denied/,
    );
    await expect(app`delete from order_events where false`).rejects.toThrow(/permission denied/);
    await expect(app`delete from door_scans where false`).rejects.toThrow(/permission denied/);
    await expect(app`truncate orders`).rejects.toThrow(/permission denied/);
    await expect(app`create table app_role_probe (id int)`).rejects.toThrow(/permission denied/);
    await expect(app`drop table orders`).rejects.toThrow(/must be owner/);
    await expect(app`select * from drizzle.__drizzle_migrations`).rejects.toThrow(
      /permission denied/,
    );
  });

  it('does the everyday work: insert, read back, update, delete', async () => {
    const id = `app-role-${randomBytes(6).toString('hex')}`;
    await app`insert into verifications (id, identifier, value, expires_at)
              values (${id}, 'app-role-test', 'v', now() + interval '1 minute')`;
    await app`update verifications set value = 'w' where id = ${id}`;
    const [row] = await app<{ value: string }[]>`select value from verifications where id = ${id}`;
    expect(row?.value).toBe('w');
    await app`delete from verifications where id = ${id}`;
    expect(await app`select 1 from verifications where id = ${id}`).toHaveLength(0);
  });

  it('gets the same rights on a table a later migration creates', async () => {
    const table = `app_role_future_${randomBytes(4).toString('hex')}`;
    await owner.unsafe(`create table ${table} (id serial primary key, note text)`);
    try {
      await app.unsafe(`insert into ${table} (note) values ('new')`);
      await app.unsafe(`update ${table} set note = 'changed'`);
      await app.unsafe(`delete from ${table}`);
    } finally {
      await owner.unsafe(`drop table ${table}`);
    }
  });
});
