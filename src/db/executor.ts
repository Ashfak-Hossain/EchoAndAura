import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase, PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type * as schema from './schema';

type Schema = typeof schema;

/** The shared Drizzle instance's type, without importing the client (which needs DATABASE_URL). */
export type Db = PostgresJsDatabase<Schema>;

export type Transaction = PgTransaction<
  PostgresJsQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
>;

/**
 * What a repository method runs its statement on: the pool, or a transaction
 * a service opened so several writes commit or roll back together (hold
 * inventory + insert order + audit row). Repositories never open
 * transactions themselves — that is the service's decision.
 */
export type DbExecutor = Db | Transaction;
