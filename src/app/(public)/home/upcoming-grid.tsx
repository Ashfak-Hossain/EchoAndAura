import Link from 'next/link';
import type { HomeEvent } from '@/server/services/events.service';
import { EventCard } from '@/components/public/event-card';
import { cn } from '@/lib/utils';
import { SectionHeading, homeColumn, homeSection, sectionLink } from './section-heading';

/** The home page is a front door, not a directory: three cards at most; /events has the rest. */
const HOME_UPCOMING_CARDS = 3;

/**
 * N8 "Also upcoming": the upcoming shows after the hero's, as event cards.
 * One card lies on its side from lg; two or three share a row; phones stack
 * them. Past three, the heading row links to /events with the full count.
 */
export function UpcomingGrid({
  events,
  upcomingTotal,
}: {
  /** `alsoUpcoming`: every upcoming show except the hero's, soonest first. */
  events: HomeEvent[];
  /** Every upcoming show, the hero's included — what /events will list. */
  upcomingTotal: number;
}) {
  const shown = events.slice(0, HOME_UPCOMING_CARDS);
  if (shown.length === 0) return null;
  // The hero's show plus these cards; anything beyond is only on /events.
  const more = upcomingTotal > shown.length + 1;

  return (
    <section aria-labelledby="upcoming-heading" className={homeSection}>
      <div className={cn(homeColumn, 'flex flex-col gap-6')}>
        <SectionHeading
          id="upcoming-heading"
          aside={
            more ? (
              <Link href="/events" className={sectionLink}>
                All upcoming events ({upcomingTotal}) →
              </Link>
            ) : null
          }
        >
          Also upcoming
        </SectionHeading>
        <ul
          data-testid="also-upcoming"
          className={cn(
            'grid grid-cols-1 gap-6',
            shown.length === 2 && 'lg:grid-cols-2',
            shown.length === 3 && 'lg:grid-cols-3',
          )}
        >
          {shown.map((item) => (
            <li key={item.event.id} className="min-w-0">
              <EventCard item={item} variant={shown.length === 1 ? 'wide' : 'default'} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
