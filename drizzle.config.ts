import { defineConfig } from 'drizzle-kit';

// Run via `pnpm db:generate` / `pnpm db:migrate`, which load .env through
// dotenv-cli so DATABASE_URL is present. Migrations are written to ./drizzle
// and committed — never hand-edited (CLAUDE.md).
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set — see .env.example');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
