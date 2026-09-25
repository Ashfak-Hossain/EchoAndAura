import Link from 'next/link';
import { HERO_EYEBROW, heroCopy } from '@/server/lib/hero-copy';
import { VENUE_PRIVATE_NOTE, publicVenue } from '@/server/lib/venue';
import type { HomeEvent } from '@/server/services/events.service';
import { PhaseChip } from '@/components/public/phase-chip';
import { formatDhakaLong } from '@/lib/time';
import { Countdown } from './countdown';
import { CoverPlaceholder, bandCover } from './cover-placeholder';
import { LockIcon } from './icons';

/** Buttons on the charcoal band: 52px; on phones the first one stretches (N7 btnFlex). */
const bandButton =
  'inline-flex h-13 items-center justify-center rounded-[8px] text-base font-semibold';

/**
 * N7 featured-event hero (Canvas 6): a charcoal band, text 5fr / cover 6fr
 * (cover first on phones). Chip + a "When / Where" list, then the phase
 * panel — the phase repeated as the sentence's first word, and a countdown
 * when there is something to count down to — price and tickets left, and
 * the actions. Every word comes from `heroCopy`, so the copy is tested
 * once, without rendering.
 *
 * "Get tickets" only while registration is open; otherwise "Event details"
 * is the one action, never a disabled button.
 */
export function Hero({ featured, now }: { featured: HomeEvent; now: Date }) {
  const { event, phase, offer, availableTotal, coverUrl } = featured;
  const copy = heroCopy({ phase, event, offer, availableTotal, now });
  // The event came through forPublic: a private venue is already gone.
  const venue = publicVenue(event);
  const href = `/events/${event.slug}`;

  return (
    <section
      aria-labelledby="hero-title"
      data-testid="home-hero"
      data-phase={phase}
      className="bg-foreground text-[#e6e1d6]"
    >
      <div className="mx-auto grid max-w-360 grid-cols-1 items-center gap-6 px-4 pt-4 pb-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16 lg:px-16 lg:pt-16 lg:pb-24">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-mono text-xs font-medium tracking-[0.14em] text-[#a8a29a] uppercase">
                {HERO_EYEBROW}
              </p>
              <PhaseChip
                phase={phase}
                registrationOpensAt={event.registrationOpensAt}
                earlyBirdOnSale={offer.earlyBirdOnSale}
                variant="hero"
                className="gap-2 text-sm"
              />
            </div>
            <h1
              id="hero-title"
              className="text-[30px] leading-[1.05] font-bold tracking-tight text-balance text-[#fbfaf8] lg:text-[48px]"
            >
              {event.title}
            </h1>
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-base leading-[1.45] lg:text-lg">
              <dt className="text-[#a8a29a]">When</dt>
              <dd className="text-[#fbfaf8] tabular">{formatDhakaLong(event.startsAt)} (Dhaka)</dd>
              {venue.text || venue.isPrivate ? (
                <>
                  <dt className="text-[#a8a29a]">Where</dt>
                  <dd className="flex flex-col gap-1 text-[#fbfaf8]">
                    {venue.text ? <span>{venue.text}</span> : null}
                    {venue.isPrivate ? (
                      <span className="inline-flex items-center gap-2 text-sm text-[#e6e1d6]">
                        <LockIcon className="shrink-0" />
                        {VENUE_PRIVATE_NOTE}
                      </span>
                    ) : null}
                  </dd>
                </>
              ) : null}
            </dl>
          </div>

          <div className="flex flex-col gap-4 rounded-lg border border-[#33302a] bg-[#14120f] p-5">
            <p className="text-base leading-normal text-pretty text-[#fbfaf8] tabular">
              <strong className="font-semibold">{copy.phaseWord}</strong> {copy.sentence}
            </p>
            {copy.countdown ? (
              <Countdown
                // A new target (sales just opened, now counting to the
                // close) is a new countdown with its own refresh-once.
                key={copy.countdown.target.toISOString()}
                label={copy.countdown.label}
                target={copy.countdown.target.toISOString()}
              />
            ) : null}
          </div>

          {copy.priceLabel ? (
            <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 tabular">
              <span className="font-heading text-2xl font-semibold text-[#fbfaf8]">
                {copy.priceLabel}
              </span>
              {copy.leftLabel ? <span className="text-base">{copy.leftLabel}</span> : null}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {copy.canBuy ? (
              <>
                <Link
                  href={`${href}/register`}
                  className={`${bandButton} flex-auto border border-foreground bg-marigold px-7 text-foreground hover:bg-[#e2962c] lg:flex-none`}
                >
                  Get tickets
                </Link>
                <Link href={href} className={`${bandButton} px-4 text-[#fbfaf8] hover:bg-wash`}>
                  Event details →
                </Link>
              </>
            ) : (
              <Link
                href={href}
                className={`${bandButton} flex-auto border border-[#6b6558] px-7 text-[#fbfaf8] hover:border-[#e6e1d6] lg:flex-none`}
              >
                Event details
              </Link>
            )}
          </div>
        </div>

        {/* Cover first on phones, right column from lg. */}
        <div className="order-first min-w-0 lg:order-0">
          {coverUrl ? (
            // The page's largest paint: fetched first, never lazy.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt=""
              width={1200}
              height={630}
              fetchPriority="high"
              data-testid="hero-cover"
              className={`${bandCover} object-cover`}
            />
          ) : (
            <CoverPlaceholder />
          )}
        </div>
      </div>
    </section>
  );
}
