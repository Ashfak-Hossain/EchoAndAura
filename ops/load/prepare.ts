/**
 * Phase 7.5 (docs/LOAD-TEST.md): migrates the load-test database and adds
 * the event the registration race runs against — published, registration
 * open, one ticket type with exactly SEATS seats. Safe to re-run.
 *
 *   DATABASE_URL=postgresql://load:load@localhost:55432/echoandaura_load \
 *     pnpm exec dotenv -e .env -- tsx ops/load/prepare.ts
 *
 * Refuses anything but the load stack's database.
 */
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, queryClient } from '@/db/client';
import { events, ticketTypes } from '@/db/schema';

export const LOAD_EVENT_SLUG = 'load-test-night';
const SEATS = 100;
const DAY = 24 * 60 * 60_000;

async function main(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.port !== '55432' || url.pathname !== '/echoandaura_load') {
    throw new Error(`refusing ${url.host}${url.pathname}: not the load stack's database`);
  }
  await migrate(db, { migrationsFolder: './drizzle' });

  const [existing] = await db.select().from(events).where(eq(events.slug, LOAD_EVENT_SLUG));
  if (existing) {
    console.log(`${LOAD_EVENT_SLUG} already there`);
    return;
  }
  // In ten days: inside the 20-days-before / 5-days-before registration window.
  const startsAt = new Date(Date.now() + 10 * DAY);
  const [event] = await db
    .insert(events)
    .values({
      slug: LOAD_EVENT_SLUG,
      title: 'Load Test Night',
      startsAt,
      registrationOpensAt: new Date(startsAt.getTime() - 20 * DAY),
      registrationClosesAt: new Date(startsAt.getTime() - 5 * DAY),
      status: 'published',
    })
    .returning();
  await db.insert(ticketTypes).values({
    eventId: event!.id,
    name: 'General',
    pricePaisa: 80_000,
    quantityTotal: SEATS,
  });
  console.log(`${LOAD_EVENT_SLUG}: published, ${SEATS} seats`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => queryClient.end());
