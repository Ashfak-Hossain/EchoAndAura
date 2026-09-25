import type { Metadata } from 'next';
import { eventsService } from '@/server/container';
import { REGISTRATION_OPENS_DAYS_BEFORE } from '@/server/lib/registration-window';
import { ButtonLink } from '@/components/button-link';
import { EmptyState } from '@/components/empty-state';
import { EventCard } from '@/components/public/event-card';
import { siteUrl } from '@/lib/env.public';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Upcoming events',
  description: 'Every echoandaura show on sale or coming up, soonest first.',
  alternates: { canonical: `${siteUrl()}/events` },
};

// Reads the database on every request: a show appears the moment it is
// published and its chip follows the sale phase.
export const dynamic = 'force-dynamic';

/**
 * /events (Canvas 6, adapted): the header's "Events" link lands here. The
 * archive's title band and grid container, with the home page's N8 cards —
 * the full list the home page's "Also upcoming" strip is capped from.
 */
export default async function UpcomingEventsPage() {
  const events = await eventsService.getUpcomingPage();
  // A lone card lies on its side on desktop, as on the home page.
  const wide = events.length === 1;

  return (
    <main className="flex flex-1 flex-col">
      {/* Title band, same family as the archive and the event page */}
      <section className="relative overflow-hidden bg-[#14120f] text-background">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_30%,#2a3a2e_0%,#14120f_60%)]"
        />
        <div className="relative mx-auto flex w-full max-w-360 flex-col gap-3 px-4 py-10 lg:gap-4 lg:px-16 lg:py-16">
          <p className="text-[11px] font-medium tracking-[0.14em] text-[#a8a29a] uppercase lg:text-xs">
            Upcoming
          </p>
          <h1 className="font-heading text-[38px] leading-[1.02] font-extrabold tracking-tight lg:text-[56px]">
            Upcoming events
          </h1>
          <p className="max-w-130 text-[15px] leading-relaxed text-[#c9c3b7] lg:text-[17px]">
            Every show on sale or coming up, soonest first.
          </p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-360 px-4 py-8 lg:px-16 lg:py-16">
        {events.length > 0 ? (
          <ul
            data-testid="upcoming-events"
            className={cn('grid grid-cols-1 gap-6', !wide && 'md:grid-cols-2 lg:grid-cols-3')}
          >
            {events.map((item) => (
              <li key={item.event.id}>
                <EventCard item={item} variant={wide ? 'wide' : 'default'} headingLevel={2} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon="♪"
            title="No shows on sale right now"
            description={`Tickets for a new show go on sale ${REGISTRATION_OPENS_DAYS_BEFORE} days before the date. Until then, see the shows we have already put on.`}
            action={
              <ButtonLink href="/archive" variant="secondary">
                See past events
              </ButtonLink>
            }
          />
        )}
      </div>
    </main>
  );
}
