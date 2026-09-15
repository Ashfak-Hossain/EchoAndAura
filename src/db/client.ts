import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Single shared Postgres connection pool + Drizzle instance. In dev, Next's
// HMR re-imports modules repeatedly; caching the client on globalThis avoids
// exhausting Postgres connections. postgres-js connects lazily, so importing
// this module does not open a connection until the first query runs.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set — see .env.example');
}

const globalForDb = globalThis as unknown as {
  __queryClient?: ReturnType<typeof postgres>;
};

export const queryClient = globalForDb.__queryClient ?? postgres(connectionString, { max: 10 });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__queryClient = queryClient;
}

export const db = drizzle(queryClient, { schema });
