---
id: ADR-044
title: A least-privilege database role for the app
date: 2026-09-29
status: accepted
area: Security and auth
supersedes: []
extends: []
---

# ADR-044 — A least-privilege database role for the app

**Date:** 2026-09-29 · **Status:** Accepted

**Context:** The web app, the worker and the migrations all connected as
`echoandaura`, the Postgres image's `POSTGRES_USER`, which is a
superuser. A SQL injection or a bad bug would have had every right in
the cluster: drop tables, read other databases, rewrite the audit trail
that invariant 6 depends on, even run programs on the server
(`COPY … TO PROGRAM`).

**Decision:**

- **Two roles on the same database.**
  - `echoandaura` stays the owner. Only the `migrate` service
    (`MIGRATE_DATABASE_URL`) and Dokploy's backups use it.
  - `echoandaura_app` is what web and worker use (`DATABASE_URL`). It
    can `SELECT, INSERT, UPDATE, DELETE` every table in `public`, and use
    their sequences. No `TRUNCATE`, no DDL, nothing in the `drizzle`
    schema, no superuser, role or database creation.
- **The audit trails are append-only in the database.** `order_events`
  and `door_scans` get no `UPDATE` or `DELETE`. The code never did
  either (only the local seed script does, as the owner); now a bug or
  an injection can't either.
- **The grants are code.** `ops/db/app-role.sql` is committed, holds no
  password and is safe to re-run. `ALTER DEFAULT PRIVILEGES` gives the
  app role the same rights on tables a later migration creates, because
  the script and the migrations run as the same owner.
- **Tested in CI.** `tests/integration/db-role.test.ts` applies the
  script twice to the CI database, then checks **every** table in
  `public` (not a list, so a new table can't slip through), the
  append-only pair, the refusals (update/delete of the audit trail,
  truncate, create, drop, the migration journal), everyday row work as
  the role, and a freshly created table.
- **The e2e suite runs as the app role.** `prepare-db` migrates and wipes
  as the owner, then applies the script; the server under test (and the
  `create-admin` runs) connect as `echoandaura_app`, like production. So
  every page and action the suite covers proves the grants are enough.
  The role's password there is a fixed, local-only one.
- **Restores apply the grants from the repo.** Backups are restored with
  `--no-acl`, then `app-role.sql` runs. A backup's grants name a role that
  a rebuilt server doesn't have yet, which would stop the restore.
- **The password never passes through a shell.** The script creates the
  role without one; the operator sets it with psql's `\password`.

**Consequences:**

- Production has two connection strings (SERVER.md § 19,
  SECRETS.md). Local dev keeps one owner URL; only the e2e server
  switches to the role.
- A new append-only table must be added to `app-role.sql` and to
  `APPEND_ONLY` in the test; the test fails until it is.
- The app role can still read and change every row, including buyer
  details and admin password hashes. This limits the blast radius; it
  does not replace the app's own checks.
- `SELECT … FOR UPDATE` needs `UPDATE`: fine on `orders`, `tickets` and
  `door_passes`, which keep it. A future row lock on an append-only table
  would fail and show up in the tests.

**Revisit when:** a second app shares the database (its own role), or
buyer PII should be readable only through views (column-level grants).
