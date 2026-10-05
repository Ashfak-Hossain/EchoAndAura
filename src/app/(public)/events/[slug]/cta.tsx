import { differenceInCalendarDays } from 'date-fns';
import { useLocale, useTranslations } from 'next-intl';
import { localisedPath } from '@/i18n/locales';
import { plainDigits } from '@/server/lib/digits';
import type { EventPhase } from '@/server/lib/event-phase';
import { ButtonLink } from '@/components/button-link';
import { formatDhakaLong } from '@/lib/time';

interface Props {
  phase: EventPhase;
  slug: string;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  availableTotal: number;
  /** ADR-055: never say how many are left; "closing soon" instead. */
  hideAvailability?: boolean;
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
  hideAvailability = false,
  facebookUrl,
  now,
}: Props) {
  const t = useTranslations('cta');
  const hero = useTranslations('hero');
  const locale = useLocale();
  const inDhaka = (date: Date) => hero('inDhaka', { when: formatDhakaLong(date, locale) });
  const note = (text: string) => (
    <p className="text-center text-[13px] leading-snug text-muted-foreground tabular lg:text-left">
      {text}
    </p>
  );
  const secondary = (href: string, label: string, external = false) => (
    <ButtonLink
      href={external ? href : localisedPath(href, locale)}
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
          <ButtonLink
            href={localisedPath(`/events/${slug}/register`, locale)}
            variant="cta"
            size="lg"
            className="w-full"
          >
            {phase !== 'closing_soon'
              ? t('register')
              : hideAvailability
                ? t('registerClosingSoon')
                : t('registerLeft', {
                    count: availableTotal,
                    n: plainDigits(availableTotal, locale),
                  })}
          </ButtonLink>
          {registrationClosesAt
            ? note(
                phase === 'closing_soon'
                  ? t('closesShort', { when: inDhaka(registrationClosesAt) })
                  : t('closesLong', { when: inDhaka(registrationClosesAt) }),
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
              ? t('dateTba')
              : days <= 0
                ? t('opensToday')
                : t('opensIn', { count: days, n: plainDigits(days, locale) })}
          </div>
          {facebookUrl ? secondary(facebookUrl, t('remindFacebook'), true) : null}
        </>
      );
    }
    case 'sold_out':
      return (
        <>
          <div className={disabled} aria-disabled="true">
            {t('soldOut')}
          </div>
          {facebookUrl ? secondary(facebookUrl, t('nextShow'), true) : null}
        </>
      );
    case 'closed':
      return (
        <div className={disabled} aria-disabled="true">
          {t('closed')}
        </div>
      );
    case 'past':
      return secondary('/', t('seeUpcoming'));
  }
}
