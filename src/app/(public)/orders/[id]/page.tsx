import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { z } from 'zod';
import { ordersService } from '@/server/container';
import { OrderNotFoundError } from '@/server/lib/errors';
import { Money } from '@/components/money';
import { StatusChip } from '@/components/status-chip';
import { bkashReceiveNumber, organizerContactEmail } from '@/lib/env.public';
import { formatDhakaLong } from '@/lib/time';
import { CopyField } from './copy-field';
import { Countdown } from './countdown';

interface Props {
  params: Promise<{ id: string }>;
}

/** The verification SLA agreed with the organizer (PHASES.md risk register). */
const VERIFICATION_SLA_TEXT = 'usually within 4 hours, always within a day';

// The order page carries the buyer's email and phone: never indexed, never
// cached, and only reachable by the uuid the buyer was redirected to.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { order } = await load(id);
  return { title: `Order ${order.reference}`, robots: { index: false, follow: false } };
}

// generateMetadata and the page both need it; one set of queries per request.
const load = cache(async (id: string) => {
  if (!z.uuid().safeParse(id).success) notFound();
  try {
    return await ordersService.getOrder(id);
  } catch (err: unknown) {
    if (err instanceof OrderNotFoundError) notFound();
    throw err;
  }
});

// A4. This slice renders the `pending_payment` state ("Awaiting payment");
// trxID submission and the other states arrive with the next slice.
export default async function OrderPage({ params }: Props) {
  const { id } = await params;
  const { order, event, ticketType } = await load(id);
  const receiveNumber = bkashReceiveNumber();
  const contactEmail = organizerContactEmail();
  // A hold past its time is shown as expired even before the expiry job
  // has run, so nobody pays for tickets about to go back on sale.
  const holdLapsed =
    order.status === 'pending_payment' &&
    order.holdExpiresAt !== null &&
    order.holdExpiresAt.getTime() <= new Date().getTime();
  const awaiting = order.status === 'pending_payment' && !holdLapsed;

  return (
    <div className="mx-auto flex w-full max-w-160 flex-1 flex-col gap-6 px-4 py-6 lg:py-10">
      <header className="flex flex-col gap-2">
        <p className="font-sans text-xs font-medium tracking-widest text-muted-foreground uppercase">
          Order
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1
            className="font-heading text-[28px] leading-none font-bold tracking-tight"
            data-testid="order-reference"
          >
            {order.reference}
          </h1>
          <StatusChip kind="order" status={order.status} />
        </div>
        <p className="text-[15px] text-[#4a4640]">
          <Link href={`/events/${event.slug}`} className="font-medium hover:underline">
            {event.title}
          </Link>
          {' · '}
          <span className="tabular">{formatDhakaLong(event.startsAt)} (Dhaka)</span>
        </p>
      </header>

      {/* Amount + hold */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 lg:p-5">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-[15px] text-muted-foreground">Amount due</span>
          <Money paisa={order.totalPaisa} className="text-[26px] font-semibold" />
        </div>
        <p className="text-sm text-muted-foreground tabular">
          {order.quantity} × {ticketType.name} at <Money paisa={order.unitPricePaisa} />
        </p>
        {awaiting && order.holdExpiresAt ? (
          <p className="border-t border-border pt-3 text-sm leading-relaxed">
            Your tickets are held for you. Hold expires in{' '}
            <Countdown until={order.holdExpiresAt.toISOString()} /> —{' '}
            <span className="tabular">{formatDhakaLong(order.holdExpiresAt)} (Dhaka)</span>.
          </p>
        ) : null}
      </section>

      {awaiting ? (
        <>
          <section aria-labelledby="pay-heading" className="flex flex-col gap-4">
            <h2 id="pay-heading" className="font-heading text-xl font-semibold">
              How to pay with bKash
            </h2>
            <ol className="flex flex-col gap-4">
              <Step n={1}>
                Open the bKash app and choose <strong>Send Money</strong>.
              </Step>
              <Step n={2}>
                Send exactly <Money paisa={order.totalPaisa} className="font-semibold" /> to this
                number — it is a personal account.
                <div className="mt-2">
                  {receiveNumber ? (
                    <CopyField label="bKash number" value={receiveNumber} />
                  ) : (
                    <p className="rounded-lg border border-dashed border-border-strong px-3.5 py-2.5 text-sm text-muted-foreground">
                      bKash number to be announced — the organizer will send it to{' '}
                      <span className="font-medium text-foreground">{order.buyerEmail}</span>.
                    </p>
                  )}
                </div>
              </Step>
              <Step n={3}>
                In the reference field, put your order reference.
                <div className="mt-2">
                  <CopyField label="order reference" value={order.reference} />
                </div>
              </Step>
              <Step n={4}>
                Come back here and paste the transaction ID below.
                <p className="mt-2 rounded-lg bg-secondary px-3.5 py-2.5 text-sm text-muted-foreground">
                  Transaction ID submission opens here shortly — keep this page&apos;s link.
                </p>
              </Step>
            </ol>
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <h2 className="text-[15px] font-semibold">What happens next</h2>
            <p className="text-sm leading-relaxed text-[#4a4640]">
              A person checks your transaction against the bKash statement — {VERIFICATION_SLA_TEXT}
              . When it matches, your tickets arrive by email at{' '}
              <span className="font-medium text-foreground">{order.buyerEmail}</span> straight
              away. Nothing else is needed from you.
            </p>
            {contactEmail ? (
              <p className="text-sm text-muted-foreground">
                Stuck? Message the organizer at{' '}
                <a href={`mailto:${contactEmail}`} className="underline">
                  {contactEmail}
                </a>
                .
              </p>
            ) : null}
          </section>
        </>
      ) : holdLapsed ? (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <h2 className="text-[15px] font-semibold">This hold has expired</h2>
          <p className="text-sm leading-relaxed text-[#4a4640]">
            We held {order.quantity} × {ticketType.name} until{' '}
            <span className="tabular">
              {order.holdExpiresAt ? formatDhakaLong(order.holdExpiresAt) : ''} (Dhaka)
            </span>
            . No transaction ID arrived, so the seats go back on sale and nothing was charged.
            Already sent the money? Do not send it again — message the organizer
            {contactEmail ? (
              <>
                {' '}
                at{' '}
                <a href={`mailto:${contactEmail}`} className="underline">
                  {contactEmail}
                </a>
              </>
            ) : null}{' '}
            with your TrxID.
          </p>
          <Link href={`/events/${event.slug}`} className="text-sm font-medium underline">
            Register again
          </Link>
        </section>
      ) : (
        <p className="text-[15px] text-[#4a4640]">This order is {order.status.replace('_', ' ')}.</p>
      )}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span
        aria-hidden="true"
        className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-[13px] font-semibold text-background"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5 text-[15px] leading-relaxed">{children}</div>
    </li>
  );
}
