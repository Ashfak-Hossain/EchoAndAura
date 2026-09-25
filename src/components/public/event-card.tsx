import Link from 'next/link';
import { formatBDT } from '@/server/lib/money';
import { VENUE_PRIVATE_NOTE, publicVenue } from '@/server/lib/venue';
import type { HomeEvent } from '@/server/services/events.service';
import { PhaseChip } from '@/components/public/phase-chip';
import { formatDhakaLong } from '@/lib/time';
import { cn } from '@/lib/utils';

function LockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/**
 * N8 event card (Canvas 6): the whole card is one link to the event page —
 * cover, phase chip, title, when, where, from-price. Used by the home
 * page's "Also upcoming" grid and by /events. Props only: the caller has
 * already read the event, its phase and its offer (`HomeEvent`).
 *
 * `wide` is the lone card on a desktop row: horizontal, cover 7fr / body
 * 5fr, with a bigger title. Below `lg` it is the ordinary stacked card.
 */
export function EventCard({
  item,
  variant = 'default',
  headingLevel = 3,
}: {
  item: HomeEvent;
  variant?: 'default' | 'wide';
  /** 3 under a section heading (home); 2 when the cards sit right under the page's h1 (/events). */
  headingLevel?: 2 | 3;
}) {
  const { event, phase, offer, coverUrl } = item;
  const wide = variant === 'wide';
  const Title = headingLevel === 2 ? 'h2' : 'h3';
  // The event came through forPublic: a private venue is already gone.
  const venue = publicVenue(event);

  return (
    <Link
      href={`/events/${event.slug}`}
      data-testid="event-card"
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card text-foreground shadow-sm transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-md',
        // ADR-031's ring: marigold, with a charcoal ring filling the offset
        // so it still reads at 3:1 on the light page.
        'focus-visible:shadow-[0_0_0_2px_var(--foreground)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-marigold',
        wide && 'lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-stretch',
      )}
    >
      {/* The card clips the cover, so it has no radius of its own. */}
      <div className="aspect-[1200/630] w-full shrink-0 bg-[#e3ddd1]">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : null}
      </div>
      <div
        className={cn(
          'flex flex-1 flex-col gap-3 px-6 pt-5 pb-6',
          wide && 'lg:justify-center lg:px-10 lg:py-8',
        )}
      >
        <PhaseChip
          phase={phase}
          registrationOpensAt={event.registrationOpensAt}
          earlyBirdOnSale={offer.earlyBirdOnSale}
          variant="card"
          className="self-start text-sm"
        />
        <Title
          className={cn(
            'font-heading text-[20px] leading-[1.2] font-semibold tracking-[-0.01em] text-pretty',
            wide && 'lg:text-[30px]',
          )}
        >
          {event.title}
        </Title>
        <div className="flex flex-col gap-1 text-sm leading-normal text-muted-foreground">
          <span className="tabular">{formatDhakaLong(event.startsAt)} (Dhaka)</span>
          {venue.text ? <span>{venue.text}</span> : null}
          {venue.isPrivate ? (
            <span className="inline-flex items-center gap-1.5">
              <LockIcon />
              {VENUE_PRIVATE_NOTE}
            </span>
          ) : null}
        </div>
        {offer.fromPricePaisa !== null ? (
          <span className="text-base font-semibold tabular">
            From {formatBDT(offer.fromPricePaisa)}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
