/**
 * Seeds one published sample event with two ticket types, including an Early
 * Bird (a separate ticket type with its own sales window — not a price rule).
 * Idempotent by event slug. Run with: pnpm db:seed
 */
import { db, queryClient } from '@/db/client';
import { events, ticketTypes } from '@/db/schema';
import { takaToPaisa } from '@/server/lib/money';

async function seed(): Promise<void> {
  const slug = 'sample-launch-night';

  const [event] = await db
    .insert(events)
    .values({
      slug,
      title: 'Sample Launch Night',
      description: 'A seeded event for local development.',
      venue: 'Dhaka',
      startsAt: new Date('2030-01-01T14:00:00Z'),
      status: 'published',
    })
    .onConflictDoNothing({ target: events.slug })
    .returning();

  if (!event) {
    console.log(`Seed skipped: event "${slug}" already exists.`);
    return;
  }

  await db.insert(ticketTypes).values([
    {
      eventId: event.id,
      name: 'Early Bird',
      pricePaisa: takaToPaisa(800),
      quantityTotal: 100,
      salesStartsAt: new Date('2029-12-01T00:00:00Z'),
      salesEndsAt: new Date('2029-12-15T00:00:00Z'),
    },
    {
      eventId: event.id,
      name: 'General Admission',
      pricePaisa: takaToPaisa(1200),
      quantityTotal: 400,
    },
  ]);

  console.log(`Seeded event "${event.title}" (${event.id}) with 2 ticket types.`);
}

seed()
  .then(() => queryClient.end())
  .catch(async (err: unknown) => {
    console.error(err);
    await queryClient.end();
    process.exitCode = 1;
  });
