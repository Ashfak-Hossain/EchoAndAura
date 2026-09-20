import Link from 'next/link';
import { formatBDT } from '@/server/lib/money';
import type { HomeEvent } from '@/server/services/events.service';
import { formatDhakaLong } from '@/lib/time';
import { DateBlock } from './date-block';
import { PhaseChip } from './phase-chip';
import { SectionHeading } from './section-heading';

/** The home page is a front door, not a directory: three cards at most. */
const HOME_UPCOMING_CARDS = 3;

/**
 * A1 "Also upcoming": only rendered with two or more published events. It
 * scrolls sideways on mobile so a third event never pushes the trust points
 * off the first screen; desktop shows three across.
 */
export function UpcomingRow({ events: all }: { events: HomeEvent[] }) {
  const events = all.slice(0, HOME_UPCOMING_CARDS);
  if (events.length === 0) return null;
  return (
    <section aria-labelledby="upcoming-heading" className="flex flex-col gap-3.5">
      <SectionHeading id="upcoming-heading">Also upcoming</SectionHeading>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-6 lg:overflow-visible lg:px-0">
        {events.map(({ event, phase, fromPricePaisa, coverUrl }) => (
          <li key={event.id} className="w-[78%] shrink-0 snap-start lg:w-auto">
            <Link
              href={`/events/${event.slug}`}
              className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-foreground focus-visible:outline-none"
            >
              <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden bg-secondary">
                {coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl} alt="" className="size-full object-cover" />
                ) : null}
                <DateBlock date={event.startsAt} />
              </div>
              <div className="flex flex-1 flex-col gap-2 p-5">
                <h3 className="font-heading text-[20px] leading-tight font-semibold text-pretty">
                  {event.title}
                </h3>
                <p className="text-sm leading-snug text-[#4a4640] tabular">
                  {formatDhakaLong(event.startsAt)} (Dhaka)
                  {event.venue ? <span className="block">{event.venue}</span> : null}
                </p>
                <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                  <span className="text-[15px] font-semibold tabular">
                    {fromPricePaisa !== null ? `from ${formatBDT(fromPricePaisa)}` : ''}
                  </span>
                  <PhaseChip
                    phase={phase}
                    registrationOpensAt={event.registrationOpensAt}
                    size="sm"
                  />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
