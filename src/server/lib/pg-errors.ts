import postgres from 'postgres';

/**
 * Recognise database-enforced constraint failures so repositories can map
 * them to typed domain errors. Constraints (UNIQUE, CHECK, FK) are the
 * source of truth — we never pre-check with a read-then-write — so the
 * error path is how the rule surfaces.
 *
 * Drizzle wraps driver failures in `DrizzleQueryError` and exposes the
 * original `PostgresError` as `cause`; walk the chain rather than checking
 * only the top-level error.
 */

// Postgres SQLSTATE codes (Class 23 — integrity constraint violation).
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

export function findPostgresError(err: unknown): postgres.PostgresError | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (current instanceof postgres.PostgresError) return current;
    current = current.cause;
  }
  return null;
}

function violates(err: unknown, code: string, constraint: string): boolean {
  const pgError = findPostgresError(err);
  return pgError !== null && pgError.code === code && pgError.constraint_name === constraint;
}

export function isUniqueViolation(err: unknown, constraint: string): boolean {
  return violates(err, UNIQUE_VIOLATION, constraint);
}

export function isCheckViolation(err: unknown, constraint: string): boolean {
  return violates(err, CHECK_VIOLATION, constraint);
}

export function isForeignKeyViolation(err: unknown, constraint: string): boolean {
  return violates(err, FOREIGN_KEY_VIOLATION, constraint);
}
