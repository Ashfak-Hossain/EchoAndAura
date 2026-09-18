import { differenceInCalendarDays } from 'date-fns';
import { formatBDT } from '@/server/lib/money';
import type { HomeEvent } from '@/server/services/events.service';
import { ButtonLink } from '@/components/button-link';
import { formatDhakaLong } from '@/lib/time';
import { PhaseChip } from './phase-chip';

const disabledCta =
  'flex h-13 w-full items-center justify-center rounded-lg border border-border bg-secondary text-[17px] font-semibold text-[#a8a29a] sm:w-auto sm:px-7';

/**
 * A1 hero: the soonest published event carries chip, date, venue, price and
 * both CTAs, so the page is complete with one event and never reads as a
 * half-empty directory. Mobile stacks; desktop splits cover | copy so the
 * CTA sits above the fold.
 */
export function Hero({ featured }: { featured: HomeEvent }) {
  const { event, phase, fromPricePaisa, coverUrl } = featured;
  const canRegister = phase === 'open' || phase === 'closing_soon';
  const href = `/events/${event.slug}`;

  const registrationLine = (() => {
    if (phase === 'closing_soon' || phase === 'open') {
      return event.registrationClosesAt
        ? `Registration closes ${formatDhakaLong(event.registrationClosesAt)} (Dhaka)`
        : null;
    }
    if (phase === 'not_open' && event.registrationOpensAt) {
      const days = differenceInCalendarDays(event.startsAt, event.registrationOpensAt);
      return `Registration opens ${formatDhakaLong(event.registrationOpensAt)} (Dhaka) — ${days} days before the show.`;
    }
    if (phase === 'sold_out') return 'Every ticket has gone. If a hold expires, tickets come back on sale here.';
    if (phase === 'closed') return 'Registration has closed for this event.';
    return null;
  })();

  return (
    <section aria-labelledby="hero-title" data-testid="home-hero" data-phase={phase}>
      <div className="mx-auto w-full max-w-290 lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center lg:gap-12 lg:px-12 lg:py-12">
        <div className="aspect-video w-full bg-secondary lg:overflow-hidden lg:rounded-2xl">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverUrl} alt="" className="size-full object-cover" data-testid="hero-cover" />
          ) : null}
        </div>

        <div className="flex flex-col gap-4 px-4 py-5 lg:gap-5 lg:px-0 lg:py-0">
          <div>
            <PhaseChip phase={phase} registrationOpensAt={event.registrationOpensAt} />
          </div>
          <h1
            id="hero-title"
            className="font-heading text-[30px] leading-[1.1] font-bold tracking-[-0.02em] text-pretty lg:text-[44px] lg:leading-[1.04] lg:tracking-tight"
          >
            {event.title}
          </h1>
          <div className="flex flex-col gap-1 text-[15px] leading-normal text-[#4a4640] lg:text-[17px]">
            <p className="tabular">{formatDhakaLong(event.startsAt)} (Dhaka)</p>
            {event.venue ? <p>{event.venue}</p> : null}
          </div>
          {fromPricePaisa !== null ? (
            <p className="text-[17px] font-semibold tabular lg:text-xl">
              from {formatBDT(fromPricePaisa)}
            </p>
          ) : null}

          <div className="flex flex-col gap-2.5 pt-1 sm:flex-row sm:items-center">
            {canRegister ? (
              <ButtonLink href={`${href}/register`} variant="cta" size="lg" className="w-full sm:w-auto">
                Get tickets
              </ButtonLink>
            ) : (
              <div className={disabledCta} aria-disabled="true">
                Get tickets
              </div>
            )}
            <ButtonLink href={href} variant="secondary" size="lg" className="w-full border-foreground sm:w-auto">
              Details
            </ButtonLink>
          </div>
          {registrationLine ? (
            <p className="text-[13px] leading-snug text-muted-foreground tabular">{registrationLine}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
