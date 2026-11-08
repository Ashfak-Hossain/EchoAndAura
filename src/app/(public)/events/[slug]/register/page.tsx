import type { Metadata } from 'next';
import Link from '@/i18n/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { cache } from 'react';
import { eventsService } from '@/server/container';
import { EventNotFoundError } from '@/server/lib/errors';
import { eventPhase, ticketAvailability } from '@/server/lib/event-phase';
import { MAX_TICKETS_PER_ORDER } from '@/server/lib/order-rules';
import { publicVenueLine } from '@/server/lib/venue';
import { ButtonLink } from '@/components/button-link';
import { getPublicSession } from '@/lib/session';
import { formatDhakaLong } from '@/lib/time';
import { readTurnstileConfig } from '@/lib/turnstile-config';
import { PhaseNotice } from '@/components/public/phase-notice';
import { checkPromoCodeAction, registerAction } from './actions';
import { RegistrationForm, type TicketOption } from './registration-form';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [{ event }, t] = await Promise.all([load(slug), getTranslations('register')]);
  return { title: t('metaTitle', { title: event.title }), robots: { index: false } };
}

// generateMetadata and the page both need it; one set of queries per request.
const load = cache(async (slug: string) => {
  try {
    return await eventsService.getPublicEvent(slug);
  } catch (err: unknown) {
    if (err instanceof EventNotFoundError) notFound();
    throw err;
  }
});

// A3. The service re-checks everything on submit; this page only decides
// whether to show the form at all and what each ticket row may offer.
export default async function RegisterPage({ params }: Props) {
  const { slug } = await params;
  const [{ event, ticketTypes }, session, locale, t, tc] = await Promise.all([
    load(slug),
    getPublicSession(),
    getLocale(),
    getTranslations('register'),
    getTranslations('common'),
  ]);
  const now = new Date();
  const when = (d: Date) => formatDhakaLong(d, locale);

  const availableTotal = ticketTypes.reduce(
    (sum, type) =>
      sum + Math.max(0, type.quantityTotal - type.quantitySold - type.quantityReserved),
    0,
  );
  const phase = eventPhase({ event, availableTotal, now });
  const open = phase === 'open' || phase === 'closing_soon';

  const options: TicketOption[] = ticketTypes.map((type) => {
    const a = ticketAvailability(type, now);
    return {
      id: type.id,
      name: type.name,
      pricePaisa: type.pricePaisa,
      // ADR-055: a hidden count never leaves the server — not even in the
      // page payload. The stepper then allows the usual 10 and the order's
      // atomic hold answers "sold out" if there are not that many.
      available: event.hideAvailability ? null : a.kind === 'left' ? a.count : 0,
      maxPerOrder:
        a.kind !== 'left'
          ? 0
          : event.hideAvailability
            ? MAX_TICKETS_PER_ORDER
            : Math.min(MAX_TICKETS_PER_ORDER, a.count),
      reason:
        a.kind === 'sold_out'
          ? t('soldOut')
          : a.kind === 'closed'
            ? type.salesEndsAt
              ? t('salesEnded', { when: when(type.salesEndsAt) })
              : t('salesClosed')
            : a.kind === 'not_started'
              ? type.salesStartsAt
                ? t('onSaleFrom', { when: when(type.salesStartsAt) })
                : t('notOnSaleYet')
              : null,
    };
  });

  return (
    <div className="mx-auto flex w-full max-w-160 flex-1 flex-col gap-6 px-4 py-6 lg:py-10">
      <header className="flex flex-col gap-1.5">
        <Link
          href={`/events/${event.slug}`}
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          ‹ {event.title}
        </Link>
        <h1 className="font-heading text-[26px] leading-tight font-bold tracking-[-0.02em] lg:text-[32px]">
          {open ? t('headingOpen') : t('heading')}
        </h1>
        <p className="text-[15px] text-[#4a4640] tabular">
          {tc('dhaka', { when: when(event.startsAt) })}
          {publicVenueLine(event) ? ` · ${publicVenueLine(event)}` : ''}
        </p>
      </header>

      {open ? (
        <RegistrationForm
          action={registerAction.bind(null, event.slug)}
          checkPromo={checkPromoCodeAction.bind(null, event.slug)}
          options={options}
          registrationClosesAt={
            event.registrationClosesAt ? when(event.registrationClosesAt) : null
          }
          prefill={session?.role === 'buyer' ? { name: session.name, email: session.email } : null}
          siteKey={readTurnstileConfig().siteKey}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {phase === 'past' ? (
            <p
              role="status"
              className="rounded-xl border border-border bg-secondary px-4 py-3.5 text-[15px]"
            >
              {t('past')}
            </p>
          ) : (
            <PhaseNotice
              phase={phase}
              registrationOpensAt={event.registrationOpensAt}
              registrationClosesAt={event.registrationClosesAt}
              now={now}
            />
          )}
          <ButtonLink href={`/events/${event.slug}`} variant="secondary" className="self-start">
            {t('backToEvent')}
          </ButtonLink>
        </div>
      )}
    </div>
  );
}
