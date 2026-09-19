import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { z } from 'zod';
import { ordersService } from '@/server/container';
import { OrderNotFoundError } from '@/server/lib/errors';
import { REJECTION_REASONS, isRejectionReason } from '@/server/lib/rejection-reasons';
import type { OrderView } from '@/server/services/orders.service';
import { Money } from '@/components/money';
import { StatusChip } from '@/components/status-chip';
import { bkashReceiveNumber, organizerContactEmail } from '@/lib/env.public';
import { formatDhakaLong } from '@/lib/time';
import { submitPaymentAction } from './actions';
import { CheckingPayment } from './checking-payment';
import { CopyField } from './copy-field';
import { Countdown } from './countdown';
import { PaymentForm } from './payment-form';

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

type Frame = 'awaiting' | 'checking' | 'expired' | 'rejected' | 'paid' | 'issued' | 'other';

/** Which A4 frame to draw. A hold past its time is shown as expired before the job runs. */
function frameOf({ order }: OrderView, now: Date): Frame {
  if (order.status === 'pending_payment') {
    const lapsed = order.holdExpiresAt !== null && order.holdExpiresAt.getTime() <= now.getTime();
    return lapsed ? 'expired' : 'awaiting';
  }
  if (order.status === 'pending_verification') return 'checking';
  if (order.status === 'expired') return 'expired';
  if (order.status === 'rejected') return 'rejected';
  if (order.status === 'paid') return 'paid';
  if (order.status === 'issued') return 'issued';
  return 'other';
}

// A4: one page, one frame per status (design canvas 2). Every frame keeps
// the same header so the reference and status are always where the buyer
// left them.
export default async function OrderPage({ params }: Props) {
  const { id } = await params;
  const view = await load(id);
  const { order, event, ticketType, events, tickets } = view;
  const frame = frameOf(view, new Date());
  const receiveNumber = bkashReceiveNumber();
  const contactEmail = organizerContactEmail();
  const contact = contactEmail ? (
    <>
      {' '}
      at{' '}
      <a href={`mailto:${contactEmail}`} className="underline">
        {contactEmail}
      </a>
    </>
  ) : null;
  const newestFirst = [...events].reverse();
  const lastSubmission = newestFirst.find(
    (e) => e.action === 'payment.submitted' || e.action === 'payment.updated',
  );
  const lastApproval = newestFirst.find((e) => e.action === 'payment.approved');
  const lastRejection = newestFirst.find((e) => e.action === 'payment.rejected');

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
          <StatusChip kind="order" status={frame === 'expired' ? 'expired' : order.status} />
        </div>
        <p className="text-[15px] text-[#4a4640]">
          <Link href={`/events/${event.slug}`} className="font-medium hover:underline">
            {event.title}
          </Link>
          {' · '}
          <span className="tabular">{formatDhakaLong(event.startsAt)} (Dhaka)</span>
        </p>
      </header>

      {frame === 'awaiting' ? (
        <>
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 lg:p-5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-[15px] text-muted-foreground">Amount due</span>
              <Money paisa={order.totalPaisa} className="text-[26px] font-semibold" />
            </div>
            <p className="text-sm text-muted-foreground tabular">
              {order.quantity} × {ticketType.name} at <Money paisa={order.unitPricePaisa} />
            </p>
            {order.holdExpiresAt ? (
              <p className="border-t border-border pt-3 text-sm leading-relaxed">
                Your tickets are held for you. Hold expires in{' '}
                <Countdown until={order.holdExpiresAt.toISOString()} /> —{' '}
                <span className="tabular">{formatDhakaLong(order.holdExpiresAt)} (Dhaka)</span>.
              </p>
            ) : null}
          </section>

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
              <Step n={4}>Come back here and paste the transaction ID below.</Step>
            </ol>
          </section>

          <section
            aria-labelledby="trx-heading"
            className="flex flex-col gap-4 rounded-xl border border-border-strong bg-card p-4 lg:p-5"
          >
            <h2 id="trx-heading" className="font-heading text-lg font-semibold">
              Paste your transaction ID
            </h2>
            <PaymentForm
              action={submitPaymentAction.bind(null, order.id)}
              submitLabel="I have sent the money"
            />
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <h2 className="text-[15px] font-semibold">What happens next</h2>
            <p className="text-sm leading-relaxed text-[#4a4640]">
              A person checks your transaction against the bKash statement — {VERIFICATION_SLA_TEXT}
              . When it matches, your tickets arrive by email at{' '}
              <span className="font-medium text-foreground">{order.buyerEmail}</span> straight away.
              Nothing else is needed from you.
            </p>
            {contactEmail ? (
              <p className="text-sm text-muted-foreground">
                Stuck? Message the organizer{contact}.
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      {frame === 'checking' ? (
        <CheckingPayment
          firstName={order.buyerName.split(/\s+/)[0] ?? order.buyerName}
          slaText={VERIFICATION_SLA_TEXT}
          totalPaisa={order.totalPaisa}
          trxId={order.bkashTrxId ?? ''}
          senderMsisdn={order.bkashSenderMsisdn ?? ''}
          submittedAt={
            lastSubmission ? `${formatDhakaLong(lastSubmission.createdAt)} (Dhaka)` : null
          }
          holdExpiresAt={order.holdExpiresAt ? order.holdExpiresAt.toISOString() : null}
          contactEmail={contactEmail}
          action={submitPaymentAction.bind(null, order.id)}
        />
      ) : null}

      {frame === 'expired' ? (
        <>
          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 lg:p-5">
            <h2 className="font-heading text-xl font-semibold">This hold has expired</h2>
            <p className="text-sm leading-relaxed text-[#4a4640]">
              We held {order.quantity} × {ticketType.name} until{' '}
              <span className="tabular">
                {order.holdExpiresAt ? formatDhakaLong(order.holdExpiresAt) : ''} (Dhaka)
              </span>
              . No transaction ID arrived, so the seats go back on sale and nothing was charged.
            </p>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Held</dt>
              <dd className="tabular">
                {order.quantity} × {ticketType.name}
              </dd>
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="tabular">
                <Money paisa={order.totalPaisa} /> · unpaid
              </dd>
            </dl>
          </section>
          <section className="flex flex-col gap-2 rounded-xl border border-[#e8c48a] bg-warning-tint p-4 text-[#7a4600]">
            <p className="text-[15px] font-semibold">
              Already sent the money? Do not send it again.
            </p>
            <p className="text-sm leading-relaxed">
              Message the organizer{contact} with your order reference and TrxID and they will sort
              it out by hand.
            </p>
          </section>
          <Link
            href={`/events/${event.slug}`}
            className="inline-flex h-13 w-full items-center justify-center rounded-lg border border-foreground bg-foreground px-7 text-[17px] font-semibold text-background hover:bg-[#33302a]"
          >
            Register again
          </Link>
        </>
      ) : null}

      {frame === 'issued' ? (
        <>
          <section className="flex flex-col gap-2 rounded-xl border border-[#bfe0cd] bg-success-tint p-4 text-[#17603b] lg:p-5">
            <h2 className="font-heading text-xl font-semibold">You&apos;re in.</h2>
            <p className="text-sm leading-relaxed">
              Payment confirmed
              {lastApproval ? ` on ${formatDhakaLong(lastApproval.createdAt)} (Dhaka)` : ''}.{' '}
              {tickets.length === 1 ? 'Your ticket is' : `${tickets.length} tickets are`} in your
              inbox at <strong>{order.buyerEmail}</strong>.
            </p>
          </section>
          <ul className="flex flex-col gap-2.5" data-testid="ticket-list">
            {tickets.map((t, i) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3.5"
              >
                <div className="min-w-0">
                  <div className="text-[13px] text-muted-foreground">
                    Ticket {i + 1} · {ticketType.name}
                  </div>
                  <div className="font-mono text-[15px] font-medium">{t.code}</div>
                  <div className="text-[15px]">{t.attendeeName}</div>
                </div>
                <StatusChip kind="ticket" status={t.status} />
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground tabular">
            Paid · trxID {order.bkashTrxId} · <Money paisa={order.totalPaisa} />
          </p>
        </>
      ) : null}

      {frame === 'paid' ? (
        // Never expected to persist (ADR-014): approve moves straight to
        // issued. If it does, say the truth — no ticket rows exist yet.
        <section className="flex flex-col gap-2 rounded-xl border border-[#bfe0cd] bg-success-tint p-4 text-[#17603b] lg:p-5">
          <h2 className="font-heading text-xl font-semibold">Payment confirmed</h2>
          <p className="text-sm leading-relaxed">
            Your tickets are being prepared and will be emailed to{' '}
            <strong>{order.buyerEmail}</strong>. This page updates itself.
          </p>
        </section>
      ) : null}

      {frame === 'rejected' ? (
        <>
          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 lg:p-5">
            <h2 className="font-heading text-xl font-semibold">
              We couldn&apos;t match your payment
            </h2>
            <p className="text-sm leading-relaxed text-[#4a4640]">
              Checked
              {lastRejection ? ` on ${formatDhakaLong(lastRejection.createdAt)} (Dhaka)` : ''}. Your
              tickets were not issued and the seats have gone back on sale.
            </p>
            <div className="mt-1 rounded-lg border border-[#efc4c0] bg-destructive-tint px-3.5 py-3 text-[#8e1e17]">
              <p className="text-xs font-medium tracking-widest uppercase">
                Reason given by the organizer
              </p>
              <p className="mt-1 text-[15px] font-semibold" data-testid="rejection-reason">
                {isRejectionReason(order.rejectionReason)
                  ? REJECTION_REASONS[order.rejectionReason]
                  : (order.rejectionReason ?? 'No reason recorded')}
              </p>
              {order.rejectionNote ? (
                <p className="mt-1 text-sm" data-testid="rejection-note">
                  {order.rejectionNote}
                </p>
              ) : null}
            </div>
          </section>
          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <h2 className="text-[15px] font-semibold">What to do now</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-[#4a4640]">
              <li>
                Check the TrxID in your bKash history — it is ten letters and numbers, easy to
                mistype.
              </li>
              <li>
                If the money did leave your account, send a screenshot of the bKash receipt to the
                organizer{contact}.
              </li>
              <li>If it never left, register again and pay with the new reference.</li>
            </ol>
          </section>
          {order.rejectionReason !== 'buyer_cancelled' &&
          order.rejectionReason !== 'duplicate_order' ? (
            <Link
              href={`/events/${event.slug}`}
              className="inline-flex h-13 w-full items-center justify-center rounded-lg border border-foreground bg-card px-7 text-[17px] font-semibold hover:bg-secondary"
            >
              Register again
            </Link>
          ) : null}
        </>
      ) : null}

      {frame === 'other' ? (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <p className="text-[15px] text-[#4a4640]">This order was cancelled.</p>
          {contactEmail ? (
            <p className="text-sm text-muted-foreground">
              Questions? Message the organizer{contact}.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-[13px] font-semibold text-background tabular"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5 text-[15px] leading-relaxed">{children}</div>
    </li>
  );
}
