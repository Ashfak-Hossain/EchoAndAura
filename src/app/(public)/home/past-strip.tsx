import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import type { HomeEvent } from '@/server/services/events.service';
import { DHAKA_TZ } from '@/lib/time';
import { SectionHeading } from './section-heading';

/**
 * A1 "Past events": proof the shows are real, even on the dormant page.
 * Each row links to the event's page, which stays live after archiving
 * (ADR-009). Attendance counts arrive with the Phase 6 reports; the
 * "See all past events" link joins with the A6 archive slice.
 */
export function PastStrip({ events }: { events: HomeEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section aria-labelledby="past-heading" className="flex flex-col gap-3.5">
      <SectionHeading id="past-heading">Past events</SectionHeading>
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card lg:grid lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        {events.map(({ event }) => (
          <li key={event.id}>
            <Link
              href={`/events/${event.slug}`}
              className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-foreground focus-visible:outline-none lg:flex-col lg:items-start lg:gap-1 lg:p-5"
            >
              <span className="font-heading text-[16px] leading-tight font-semibold text-pretty">
                {event.title}
              </span>
              <span className="shrink-0 text-sm text-muted-foreground tabular">
                {formatInTimeZone(event.startsAt, DHAKA_TZ, 'MMM yyyy')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
