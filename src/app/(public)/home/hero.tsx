import { differenceInCalendarDays } from 'date-fns';
import { formatBDT } from '@/server/lib/money';
import type { HomeEvent } from '@/server/services/events.service';
import { ButtonLink } from '@/components/button-link';
import { HOME_TAGLINE } from '@/lib/seo';
import { formatDhakaLong } from '@/lib/time';
import { DateBlock } from './date-block';
import { CalendarIcon, PinIcon } from './icons';
import { PhaseChip } from './phase-chip';

const disabledCta =
  'flex h-13 w-full items-center justify-center rounded-[10px] border border-[#5a554b] bg-[#26231f] text-[17px] font-semibold text-[#a8a29a] sm:w-auto sm:px-7';

/**
 * A1 hero (redesign 2026-09-21): a full-bleed dark stage, not a card. The
 * soonest published event carries eyebrow + chip, title, date and venue
 * with icons, one line of brand copy, both CTAs and the from-price with
 * what is left. Cover at the right with the date tile on its corner;
 * mobile stacks cover-first.
 */
export function Hero({ featured }: { featured: HomeEvent }) {
  const { event, phase, fromPricePaisa, availableTotal, coverUrl } = featured;
  const canRegister = phase === 'open' || phase === 'closing_soon';
  const href = `/events/${event.slug}`;

  const eyebrow = (() => {
    switch (phase) {
      case 'open':
      case 'closing_soon':
        return 'Next show · Tickets on sale';
      case 'not_open':
        return 'Next show · Tickets soon';
      case 'sold_out':
        return 'Next show · Sold out';
      default:
        return 'Next show';
    }
  })();

  const registrationLine = (() => {
    if (canRegister) {
      return event.registrationClosesAt
        ? `Registration closes ${formatDhakaLong(event.registrationClosesAt)} (Dhaka)`
        : null;
    }
    if (phase === 'not_open' && event.registrationOpensAt) {
      const days = differenceInCalendarDays(event.startsAt, event.registrationOpensAt);
      return `Registration opens ${formatDhakaLong(event.registrationOpensAt)} (Dhaka) — ${days} days before the show.`;
    }
    if (phase === 'sold_out')
      return 'Every ticket has gone. If a hold expires, tickets come back on sale here.';
    if (phase === 'closed') return 'Registration has closed for this event.';
    return null;
  })();

  return (
    <section
      aria-labelledby="hero-title"
      data-testid="home-hero"
      data-phase={phase}
      className="relative overflow-hidden bg-[#14120f] text-background"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_40%,#2a3a2e_0%,#14120f_55%,#0e0d0b_100%)]"
      />
      <div className="relative mx-auto flex w-full max-w-360 flex-col gap-5 px-4 pt-5 pb-8 lg:grid lg:grid-cols-12 lg:items-center lg:gap-x-6 lg:px-16 lg:py-16">
        {/* Cover first on mobile, right column on desktop */}
        <div className="relative order-first aspect-4/3 w-full overflow-hidden rounded-2xl bg-[#1a2a20] shadow-[0_24px_60px_rgb(0_0_0/0.45)] lg:order-last lg:col-span-5 lg:col-start-8">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt=""
              className="size-full object-cover"
              data-testid="hero-cover"
            />
          ) : null}
          <DateBlock date={event.startsAt} size="lg" />
        </div>

        <div className="flex flex-col gap-4 lg:col-span-6 lg:gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex items-center gap-2.5 text-[11px] font-medium tracking-[0.14em] text-[#c9c3b7] uppercase lg:text-xs">
              <span
                aria-hidden="true"
                className={`inline-block size-2 rounded-full ${canRegister ? 'bg-[#3ecf7a]' : 'bg-[#a8a29a]'}`}
              />
              {eyebrow}
            </p>
            <PhaseChip phase={phase} registrationOpensAt={event.registrationOpensAt} size="sm" />
          </div>
          <h1
            id="hero-title"
            className="font-heading text-[38px] leading-[1.02] font-extrabold tracking-tight text-pretty lg:text-[64px]"
          >
            {event.title}
          </h1>
          <div className="flex flex-col gap-1.5 text-[15px] text-[#e6e1d6] lg:text-[18px]">
            <p className="flex items-center gap-2.5 tabular">
              <CalendarIcon className="shrink-0" />
              {formatDhakaLong(event.startsAt)} (Dhaka)
            </p>
            {event.venue ? (
              <p className="flex items-center gap-2.5">
                <PinIcon className="shrink-0" />
                {event.venue}
              </p>
            ) : null}
          </div>
          <p className="hidden max-w-130 text-[16px] leading-relaxed text-[#c9c3b7] lg:block">
            {HOME_TAGLINE}
          </p>

          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            {canRegister ? (
              <ButtonLink
                href={`${href}/register`}
                variant="cta"
                size="lg"
                className="w-full rounded-[10px] sm:w-auto"
              >
                Get tickets
              </ButtonLink>
            ) : (
              <div className={disabledCta} aria-disabled="true">
                Get tickets
              </div>
            )}
            <ButtonLink
              href={href}
              size="lg"
              className="w-full rounded-[10px] border-[#5a554b] bg-transparent text-background hover:border-[#c9c3b7] hover:bg-transparent sm:w-auto"
            >
              Details
            </ButtonLink>
            {fromPricePaisa !== null ? (
              <p className="text-[15px] text-[#c9c3b7] tabular">
                from{' '}
                <strong className="font-semibold text-background">
                  {formatBDT(fromPricePaisa)}
                </strong>
                {canRegister ? ` · ${availableTotal} left` : ''}
              </p>
            ) : null}
          </div>
          {registrationLine ? (
            <p className="text-[13px] leading-snug text-[#a8a29a] tabular">{registrationLine}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
