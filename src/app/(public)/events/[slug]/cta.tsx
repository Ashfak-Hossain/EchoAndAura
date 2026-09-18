import { differenceInCalendarDays } from 'date-fns';
import type { EventPhase } from '@/server/lib/event-phase';
import { ButtonLink } from '@/components/button-link';
import { formatDhakaLong } from '@/lib/time';

interface Props {
  phase: EventPhase;
  slug: string;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  availableTotal: number;
  facebookUrl: string | null;
  now: Date;
}

const disabled =
  'flex h-13 w-full items-center justify-center rounded-lg border border-border bg-secondary text-[17px] font-semibold text-[#a8a29a]';

/**
 * A2 CTA per phase. A disabled CTA always states the reason ("Opens in 4
 * days"), never a dead "Register". Under 48h it carries the remaining count —
 * pressure comes from real numbers, not colour.
 */
export function EventCta({
  phase,
  slug,
  registrationOpensAt,
  registrationClosesAt,
  availableTotal,
  facebookUrl,
  now,
}: Props) {
  const note = (text: string) => (
    <p className="text-center text-[13px] leading-snug text-muted-foreground tabular lg:text-left">
      {text}
    </p>
  );
  const secondary = (href: string, label: string, external = false) => (
    <ButtonLink
      href={href}
      variant="secondary"
      className="w-full border-foreground"
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      {label}
    </ButtonLink>
  );

  switch (phase) {
    case 'open':
    case 'closing_soon':
      return (
        <>
          <ButtonLink href={`/events/${slug}/register`} variant="cta" size="lg" className="w-full">
            {phase === 'closing_soon' ? `Register — ${availableTotal} tickets left` : 'Register'}
          </ButtonLink>
          {registrationClosesAt
            ? note(
                phase === 'closing_soon'
                  ? `Closes ${formatDhakaLong(registrationClosesAt)} (Dhaka)`
                  : `Registration closes ${formatDhakaLong(registrationClosesAt)} (Dhaka). Pay by bKash; a person checks every payment.`,
              )
            : null}
        </>
      );
    case 'not_open': {
      const days = registrationOpensAt ? differenceInCalendarDays(registrationOpensAt, now) : null;
      return (
        <>
          <div className={disabled} aria-disabled="true">
            {days === null
              ? 'Registration date to be announced'
              : days <= 0
                ? 'Opens today'
                : `Opens in ${days} ${days === 1 ? 'day' : 'days'}`}
          </div>
          {facebookUrl ? secondary(facebookUrl, 'Remind me on Facebook', true) : null}
        </>
      );
    }
    case 'sold_out':
      return (
        <>
          <div className={disabled} aria-disabled="true">
            Sold out
          </div>
          {facebookUrl ? secondary(facebookUrl, 'Tell me about the next show', true) : null}
        </>
      );
    case 'closed':
      return (
        <div className={disabled} aria-disabled="true">
          Registration closed
        </div>
      );
    case 'past':
      return secondary('/', 'See upcoming events');
  }
}
