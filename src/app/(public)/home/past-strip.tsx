import Image from 'next/image';
import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import { venueCity } from '@/server/lib/venue';
import type { HomeEvent } from '@/server/services/events.service';
import { DHAKA_TZ } from '@/lib/time';
import { cn } from '@/lib/utils';
import { SectionHeading, sectionLink } from './section-heading';

/** A past show's meta, "Aug 2026 · Chattogram"; just the month when the venue names no city. */
export function monthAndCity(event: HomeEvent['event']): string {
  const month = formatInTimeZone(event.startsAt, DHAKA_TZ, 'MMM yyyy');
  const city = venueCity(event);
  return city ? `${month} · ${city}` : month;
}

/** Desktop shows one row of four; phones get the whole read (six) in the strip. */
const DESKTOP_PAST_ITEMS = 4;

/**
 * N9 "Past events": proof the shows are real, even between shows. In full
 * colour; each links to the event's page, which stays live after archiving
 * (ADR-009). Four columns from lg; on phones a sideways scroll-snap strip
 * of 240px items that runs to the screen's edges, snapping to the gutter.
 */
export function PastStrip({ events }: { events: HomeEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section aria-labelledby="past-heading" className="pt-16 lg:pt-24">
      {/* The strip scrolls under the gutters, so the gutters live inside. */}
      <div className="mx-auto flex w-full max-w-360 flex-col gap-6">
        <div className="px-4 lg:px-16">
          <SectionHeading
            id="past-heading"
            aside={
              <Link href="/archive" className={sectionLink}>
                See all past events →
              </Link>
            }
          >
            Past events
          </SectionHeading>
        </div>
        {/* The vertical padding keeps the focus ring inside the scroller's clip. */}
        <ul className="-my-2 grid snap-x snap-mandatory scroll-px-4 auto-cols-60 grid-flow-col gap-4 overflow-x-auto px-4 py-2 lg:grid-flow-row lg:grid-cols-4 lg:overflow-visible lg:px-16">
          {events.map(({ event, coverUrl }, i) => (
            <li
              key={event.id}
              className={cn('min-w-0 snap-start', i >= DESKTOP_PAST_ITEMS && 'lg:hidden')}
            >
              <Link
                href={`/events/${event.slug}`}
                className="flex flex-col gap-2 rounded-[8px] text-foreground hover:text-accent-ink"
              >
                {coverUrl ? (
                  // 240px items on phones; four columns of the 1440 wrap from lg.
                  <Image
                    src={coverUrl}
                    alt=""
                    width={1200}
                    height={630}
                    sizes="(min-width: 1440px) 316px, (min-width: 1024px) 22vw, 240px"
                    className="aspect-1200/630 w-full rounded-[8px] border border-border bg-[#e3ddd1] object-cover"
                  />
                ) : (
                  <div className="aspect-1200/630 w-full rounded-[8px] border border-border bg-[#e3ddd1]" />
                )}
                <span className="text-base leading-[1.3] font-semibold text-pretty">
                  {event.title}
                </span>
                <span className="text-sm text-muted-foreground tabular">{monthAndCity(event)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
