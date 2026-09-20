import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import type { HomeEvent } from '@/server/services/events.service';
import { DHAKA_TZ } from '@/lib/time';
import { SectionHeading } from './section-heading';

/**
 * A1 "Past events": proof the shows are real, even on the dormant page.
 * Four small grey covers (2-up on phones); each links to the event's page,
 * which stays live after archiving (ADR-009). Attendance counts arrive
 * with the Phase 6 reports; "See all past events" goes to the A6 archive.
 */
export function PastStrip({ events }: { events: HomeEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section aria-labelledby="past-heading" className="flex flex-col gap-4 lg:gap-6">
      <SectionHeading
        id="past-heading"
        aside={
          <Link
            href="/archive"
            className="text-sm text-muted-foreground hover:underline lg:text-[15px]"
          >
            See all past events →
          </Link>
        }
      >
        Past events
      </SectionHeading>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
        {events.map(({ event, coverUrl }) => (
          <li key={event.id}>
            <Link
              href={`/events/${event.slug}`}
              className="flex flex-col gap-2.5 rounded-xl focus-visible:ring-2 focus-visible:ring-foreground focus-visible:outline-none"
            >
              <div className="aspect-[16/10] w-full overflow-hidden rounded-xl bg-[#2a2a2a]">
                {coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl} alt="" className="size-full object-cover grayscale" />
                ) : null}
              </div>
              <span className="font-heading text-[14px] leading-tight font-semibold text-pretty lg:text-[16px]">
                {event.title}
              </span>
              <span className="text-[12px] text-muted-foreground tabular lg:text-[13px]">
                {formatInTimeZone(event.startsAt, DHAKA_TZ, 'MMM yyyy')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
