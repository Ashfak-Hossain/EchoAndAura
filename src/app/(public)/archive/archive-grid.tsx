import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import type { ArchiveEvent } from '@/server/services/events.service';
import { DHAKA_TZ, formatDhakaLong } from '@/lib/time';

/**
 * A6 (redesign 2026-09-21): the same card as the home page's past strip —
 * grey cover, title, date, venue — four across on desktop, two on phones,
 * newest first. Year headings once the list spans more than one year.
 * Cards link to the event page, which stays live after archiving (ADR-009).
 */
export function ArchiveGrid({ events }: { events: ArchiveEvent[] }) {
  const byYear = new Map<string, ArchiveEvent[]>();
  for (const item of events) {
    const year = formatInTimeZone(item.event.startsAt, DHAKA_TZ, 'yyyy');
    byYear.set(year, [...(byYear.get(year) ?? []), item]);
  }
  const groups = [...byYear.entries()];
  const showYears = groups.length > 1;

  return (
    <div className="flex flex-col gap-10 lg:gap-14" data-testid="archive">
      {groups.map(([year, items]) => (
        <section
          key={year}
          aria-labelledby={showYears ? `year-${year}` : undefined}
          className="flex flex-col gap-4 lg:gap-6"
        >
          {showYears ? (
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <h2
                id={`year-${year}`}
                className="font-heading text-[24px] leading-tight font-semibold tracking-[-0.01em] lg:text-[30px]"
              >
                {year}
              </h2>
              <span className="text-sm text-muted-foreground tabular">
                {items.length} {items.length === 1 ? 'show' : 'shows'}
              </span>
            </div>
          ) : null}
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
            {items.map(({ event, coverUrl }) => (
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
                  <span className="text-[12px] leading-snug text-muted-foreground tabular lg:text-[13px]">
                    {formatDhakaLong(event.startsAt)}
                    {event.venue ? <span className="block">{event.venue}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
