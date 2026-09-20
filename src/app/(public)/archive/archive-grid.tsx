import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import type { ArchiveEvent } from '@/server/services/events.service';
import { DHAKA_TZ, formatDhakaLong } from '@/lib/time';

/**
 * A6: two-up grid of past events, newest first, covers desaturated so the
 * archive never competes with what is on sale. Year headings appear once
 * the list spans more than one year. Cards link to the event page, which
 * stays live after archiving (ADR-009).
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
    <div className="flex flex-col gap-8" data-testid="archive">
      {groups.map(([year, items]) => (
        <section key={year} aria-labelledby={showYears ? `year-${year}` : undefined}>
          {showYears ? (
            <h2
              id={`year-${year}`}
              className="mb-3 font-sans text-xs font-medium tracking-widest text-muted-foreground uppercase"
            >
              {year}
            </h2>
          ) : null}
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {items.map(({ event, coverUrl }) => (
              <li key={event.id}>
                <Link
                  href={`/events/${event.slug}`}
                  className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-foreground focus-visible:outline-none"
                >
                  <div className="aspect-video w-full shrink-0 overflow-hidden bg-secondary">
                    {coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={coverUrl} alt="" className="size-full object-cover grayscale" />
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1 p-4">
                    <h3 className="font-heading text-[17px] leading-tight font-semibold text-pretty">
                      {event.title}
                    </h3>
                    <p className="text-sm leading-snug text-[#4a4640] tabular">
                      {formatDhakaLong(event.startsAt)} (Dhaka)
                      {event.venue ? <span className="block">{event.venue}</span> : null}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
