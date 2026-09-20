import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { eventsService } from '@/server/container';
import { EventNotFoundError } from '@/server/lib/errors';
import { eventPhase, ticketAvailability } from '@/server/lib/event-phase';
import { MAX_TICKETS_PER_ORDER } from '@/server/lib/order-rules';
import { ButtonLink } from '@/components/button-link';
import { getPublicSession } from '@/lib/session';
import { formatDhakaLong } from '@/lib/time';
import { PhaseNotice } from '../phase-notice';
import { registerAction } from './actions';
import { RegistrationForm, type TicketOption } from './registration-form';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { event } = await load(slug);
  return { title: `Register — ${event.title}`, robots: { index: false } };
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
  const { event, ticketTypes } = await load(slug);
  const now = new Date();
  const session = await getPublicSession();

  const availableTotal = ticketTypes.reduce(
    (n, t) => n + Math.max(0, t.quantityTotal - t.quantitySold - t.quantityReserved),
    0,
  );
  const phase = eventPhase({ event, availableTotal, now });
  const open = phase === 'open' || phase === 'closing_soon';

  const options: TicketOption[] = ticketTypes.map((t) => {
    const a = ticketAvailability(t, now);
    return {
      id: t.id,
      name: t.name,
      pricePaisa: t.pricePaisa,
      available: a.kind === 'left' ? a.count : 0,
      maxPerOrder: a.kind === 'left' ? Math.min(MAX_TICKETS_PER_ORDER, a.count) : 0,
      reason:
        a.kind === 'sold_out'
          ? 'Sold out'
          : a.kind === 'closed'
            ? t.salesEndsAt
              ? `Sales ended ${formatDhakaLong(t.salesEndsAt)} (Dhaka)`
              : 'Sales window closed'
            : a.kind === 'not_started'
              ? t.salesStartsAt
                ? `On sale from ${formatDhakaLong(t.salesStartsAt)} (Dhaka)`
                : 'Not on sale yet'
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
          {open ? 'Choose your ticket' : 'Registration'}
        </h1>
        <p className="text-[15px] text-[#4a4640] tabular">
          {formatDhakaLong(event.startsAt)} (Dhaka)
          {event.venue ? ` · ${event.venue}` : ''}
        </p>
      </header>

      {open ? (
        <RegistrationForm
          action={registerAction.bind(null, event.slug)}
          options={options}
          registrationClosesAt={
            event.registrationClosesAt ? formatDhakaLong(event.registrationClosesAt) : null
          }
          prefill={session?.role === 'buyer' ? { name: session.name, email: session.email } : null}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {phase === 'past' ? (
            <p
              role="status"
              className="rounded-xl border border-border bg-secondary px-4 py-3.5 text-[15px]"
            >
              This event has already happened.
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
            Back to the event
          </ButtonLink>
        </div>
      )}
    </div>
  );
}
