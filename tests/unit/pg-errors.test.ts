import { DrizzleQueryError } from 'drizzle-orm/errors';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import {
  findPostgresError,
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
} from '@/server/lib/pg-errors';

// Mirrors what postgres-js raises: PostgresError carries the SQLSTATE `code`
// and `constraint_name` as own properties. (The type declaration only admits
// a string constructor argument; the runtime assigns any object's fields.)
function pgError(code: string, constraint_name: string): postgres.PostgresError {
  return Object.assign(new postgres.PostgresError('violation'), {
    code,
    constraint_name,
    severity: 'ERROR',
  });
}

/** What the production bundle actually throws: minified class name, same fields. */
function minifiedPgError(code: string, constraint_name: string): Error {
  const err = new Error('violation');
  err.name = 'ds';
  return Object.assign(err, { code, constraint_name, severity: 'ERROR' });
}

// Drizzle wraps the driver error and exposes it as `cause`.
function wrapped(cause: Error): DrizzleQueryError {
  return new DrizzleQueryError('select 1', [], cause);
}

describe('pg-errors', () => {
  it('finds a PostgresError directly or through a DrizzleQueryError cause', () => {
    const inner = pgError('23505', 'events_slug_unique');
    expect(findPostgresError(inner)).toBe(inner);
    expect(findPostgresError(wrapped(inner))).toBe(inner);
  });

  it('recognises a minified PostgresError by its SQLSTATE shape (production bundle)', () => {
    const err = minifiedPgError('23505', 'events_slug_unique');
    expect(findPostgresError(wrapped(err))).toBe(err);
    expect(isUniqueViolation(wrapped(err), 'events_slug_unique')).toBe(true);
  });

  it('does not mistake other errors with a code for Postgres errors', () => {
    const node = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(findPostgresError(node)).toBeNull();
  });

  it('returns null for non-database errors', () => {
    expect(findPostgresError(new Error('boom'))).toBeNull();
    expect(findPostgresError('not an error')).toBeNull();
    expect(findPostgresError(wrapped(new Error('boom')))).toBeNull();
  });

  it('matches only the named constraint for each violation class', () => {
    expect(
      isUniqueViolation(wrapped(pgError('23505', 'events_slug_unique')), 'events_slug_unique'),
    ).toBe(true);
    expect(isUniqueViolation(wrapped(pgError('23505', 'other_unique')), 'events_slug_unique')).toBe(
      false,
    );
    expect(
      isCheckViolation(
        pgError('23514', 'ticket_types_availability_nonneg'),
        'ticket_types_availability_nonneg',
      ),
    ).toBe(true);
    expect(
      isForeignKeyViolation(
        pgError('23503', 'orders_ticket_type_id_ticket_types_id_fk'),
        'orders_ticket_type_id_ticket_types_id_fk',
      ),
    ).toBe(true);
  });

  it('does not confuse violation classes', () => {
    const check = pgError('23514', 'x');
    expect(isUniqueViolation(check, 'x')).toBe(false);
    expect(isForeignKeyViolation(check, 'x')).toBe(false);
    expect(isCheckViolation(check, 'x')).toBe(true);
  });
});
