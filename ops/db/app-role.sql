-- ADR-044: the least-privilege role the web app and the worker connect as.
--
-- Run it as the database OWNER (the role that runs migrations: `echoandaura`
-- in production), against the app's database. Safe to re-run: after a new
-- append-only table, or to repair grants after a restore.
--
--   psql -v ON_ERROR_STOP=1 -U echoandaura -d echoandaura -f ops/db/app-role.sql
--
-- It holds no password. The role is created without one (so it can't log
-- in yet); set it afterwards with psql's `\password echoandaura_app`, which
-- keeps it out of shell history and server logs (docs/infra/SERVER.md).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'echoandaura_app') THEN
    CREATE ROLE echoandaura_app LOGIN;
  END IF;
END
$$;

-- No superuser, no role or database creation, no replication, no RLS bypass.
-- Explicit, so a re-run also undoes any drift.
ALTER ROLE echoandaura_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO echoandaura_app', current_database());
END
$$;

-- Read and write rows; never change the schema. Postgres 15+ already denies
-- CREATE on `public` to everyone but its owner. The `drizzle` schema (the
-- migration journal) gets nothing.
GRANT USAGE ON SCHEMA public TO echoandaura_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO echoandaura_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO echoandaura_app;

-- Tables a later migration creates get the same rights. This applies to
-- objects created by the role running this script, which must therefore be
-- the role that runs migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO echoandaura_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO echoandaura_app;

-- Append-only audit trails, enforced by the database and not only by code:
-- the answer to "why was this order rejected" (invariant 6) and "who let
-- this person in" can't be rewritten by the app, even by a bug or an
-- injection. A new append-only table goes in this list.
REVOKE UPDATE, DELETE, TRUNCATE ON order_events, door_scans FROM echoandaura_app;
