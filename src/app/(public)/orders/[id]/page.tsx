import type { Metadata } from 'next';
import Link from '@/i18n/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { cache } from 'react';
import { z } from 'zod';
import { ordersService } from '@/server/container';
import { OrderNotFoundError } from '@/server/lib/errors';
import { holdCutoff, holdLapsed } from '@/server/lib/hold';
import { plainDigits } from '@/server/lib/digits';
import { isRejectionReason } from '@/server/lib/rejection-reasons';
import type { OrderView } from '@/server/services/orders.service';
import { Money } from '@/components/money';
import { StatusChip } from '@/components/status-chip';
import { getSiteSettings } from '@/lib/settings';
import { formatDhakaLong } from '@/lib/time';
import { submitPaymentAction } from './actions';
import { CheckingPayment } from './checking-payment';
import { CopyField } from './copy-field';
import { Countdown } from './countdown';
import { PaymentForm } from './payment-form';

interface Props {
  params: Promise<{ id: string }>;
}

// The order page carries the buyer's email and phone: never indexed, never
// cached, and only reachable by the uuid the buyer was redirected to.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [{ order }, t] = await Promise.all([load(id), getTranslations('order')]);
  return {
    title: t('metaTitle', { reference: order.reference }),
    robots: { index: false, follow: false },
  };
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

/**
 * Which A4 frame to draw. A hold past its cutoff is shown as expired before
 * the job runs — the same rule submitPayment enforces (ADR-054).
 */
function frameOf({ order }: OrderView, now: Date): Frame {
  if (order.status === 'pending_payment') return holdLapsed(order, now) ? 'expired' : 'awaiting';
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
  const [view, settings, locale, t, tc, ts, tst] = await Promise.all([
    load(id),
    getSiteSettings(),
    getLocale(),
    getTranslations('order'),
    getTranslations('common'),
    getTranslations('status.order'),
    getTranslations('status.ticket'),
  ]);
  // L3: the order reference, the bKash number, the TrxID and ticket codes
  // stay in Latin digits; everything people only read follows the page.
  const when = (d: Date) => formatDhakaLong(d, locale);
  const dhaka = (d: Date) => tc('dhaka', { when: when(d) });
  const n = (count: number) => plainDigits(count, locale);
  const money = (paisa: number, className?: string) => (
    <Money paisa={paisa} locale={locale} className={className} />
  );
  const { order, event, ticketType, events, tickets, promoCode } = view;
  const renderedAt = new Date();
  const frame = frameOf(view, renderedAt);
  const receiveNumber = settings.bkashReceiveNumber;
  const contactEmail = settings.supportEmail;
  // The bKash menu item differs by account type (B14): personal accounts
  // receive by "Send Money", merchant accounts by "Payment".
  const merchant = settings.bkashAccountType === 'merchant';
  // For sentences that name the organizer's address when there is one.
  const contact = {
    contact: contactEmail ? 'email' : 'none',
    address: contactEmail ?? '',
    email: (chunks: React.ReactNode) => (
      <a href={`mailto:${contactEmail}`} className="underline">
        {chunks}
      </a>
    ),
  };
  const newestFirst = [...events].reverse();
  const lastSubmission = newestFirst.find(
    (e) => e.action === 'payment.submitted' || e.action === 'payment.updated',
  );
  const lastApproval = newestFirst.find((e) => e.action === 'payment.approved');
  // B13: a comp was never paid for. Its reason is internal and never shown here.
  const comp = order.complimentaryReason !== null;
  const compIssued = newestFirst.find((e) => e.action === 'order.comp_issued');
  const lastRejection = newestFirst.find((e) => e.action === 'payment.rejected');

  return (
    <div className="mx-auto flex w-full max-w-160 flex-1 flex-col gap-6 px-4 py-6 lg:py-10">
      <header className="flex flex-col gap-2">
        <p className="font-sans text-xs font-medium tracking-widest text-muted-foreground uppercase">
          {t('eyebrow')}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1
            className="font-heading text-[28px] leading-none font-bold tracking-tight"
            data-testid="order-reference"
          >
            {order.reference}
          </h1>
          <StatusChip
            kind="order"
            status={frame === 'expired' ? 'expired' : order.status}
            label={ts(frame === 'expired' ? 'expired' : order.status)}
          />
        </div>
        <p className="text-[15px] text-[#4a4640]">
          <Link href={`/events/${event.slug}`} className="font-medium hover:underline">
            {event.title}
          </Link>
          {' · '}
          <span className="tabular">{dhaka(event.startsAt)}</span>
        </p>
      </header>

      {frame === 'awaiting' ? (
        <>
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 lg:p-5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-[15px] text-muted-foreground">{t('amountDue')}</span>
              {money(order.totalPaisa, 'text-[26px] font-semibold')}
            </div>
            <p className="text-sm text-muted-foreground tabular">
              {t.rich('line', {
                qty: n(order.quantity),
                name: ticketType.name,
                price: () => money(order.unitPricePaisa),
              })}
              {order.discountPaisa > 0 ? (
                <span className="text-[#17603b]" data-testid="order-discount">
                  {' · '}
                  {t.rich(promoCode ? 'discountWith' : 'discountPlain', {
                    code: promoCode ?? '',
                    subtotal: () => money(order.subtotalPaisa),
                    discount: () => money(order.discountPaisa),
                  })}
                </span>
              ) : null}
            </p>
            {order.holdExpiresAt ? (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <p className="text-sm leading-relaxed">{t('held')}</p>
                <Countdown
                  until={order.holdExpiresAt.toISOString()}
                  cutoff={holdCutoff(order.holdExpiresAt).toISOString()}
                  serverNow={renderedAt.toISOString()}
                />
                <p className="text-xs text-muted-foreground">
                  {t.rich('holdEnds', {
                    date: when(order.holdExpiresAt),
                    when: (chunks) => <span className="tabular">{chunks}</span>,
                  })}
                </p>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="pay-heading" className="flex flex-col gap-4">
            <h2 id="pay-heading" className="font-heading text-xl font-semibold">
              {t('howToPay')}
            </h2>
            <ol className="flex flex-col gap-4">
              <Step n={n(1)}>
                {t.rich('step1', {
                  menu: () => (
                    <strong data-testid="bkash-menu">
                      {merchant ? t('menuPayment') : t('menuSendMoney')}
                    </strong>
                  ),
                })}
              </Step>
              <Step n={n(2)}>
                {t.rich(
                  settings.bkashAccountName
                    ? 'step2Named'
                    : merchant
                      ? 'step2Merchant'
                      : 'step2Personal',
                  {
                    name: settings.bkashAccountName ?? '',
                    amount: () => money(order.totalPaisa, 'font-semibold'),
                  },
                )}
                <div className="mt-2">
                  {receiveNumber ? (
                    <CopyField label={t('bkashNumber')} value={receiveNumber} />
                  ) : (
                    <p className="rounded-lg border border-dashed border-border-strong px-3.5 py-2.5 text-sm text-muted-foreground">
                      {t.rich('numberTba', {
                        email: () => (
                          <span className="font-medium text-foreground">{order.buyerEmail}</span>
                        ),
                      })}
                    </p>
                  )}
                </div>
              </Step>
              <Step n={n(3)}>
                {t('step3')}
                <div className="mt-2">
                  <CopyField label={t('orderReference')} value={order.reference} />
                </div>
              </Step>
              <Step n={n(4)}>{t('step4')}</Step>
            </ol>
          </section>

          <section
            aria-labelledby="trx-heading"
            className="flex flex-col gap-4 rounded-xl border border-border-strong bg-card p-4 lg:p-5"
          >
            <h2 id="trx-heading" className="font-heading text-lg font-semibold">
              {t('pasteTrx')}
            </h2>
            <PaymentForm
              action={submitPaymentAction.bind(null, order.id)}
              submitLabel={t('sentMoney')}
            />
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <h2 className="text-[15px] font-semibold">{t('nextTitle')}</h2>
            <p className="text-sm leading-relaxed text-[#4a4640]">
              {t.rich('nextBody', {
                promise: settings.verificationPromise,
                email: () => (
                  <span className="font-medium text-foreground">{order.buyerEmail}</span>
                ),
              })}
            </p>
            {contactEmail ? (
              <p className="text-sm text-muted-foreground">{t.rich('stuck', contact)}</p>
            ) : null}
          </section>
        </>
      ) : null}

      {frame === 'checking' ? (
        <CheckingPayment
          firstName={order.buyerName.split(/\s+/)[0] ?? order.buyerName}
          slaText={settings.verificationPromise}
          totalPaisa={order.totalPaisa}
          trxId={order.bkashTrxId ?? ''}
          senderMsisdn={order.bkashSenderMsisdn ?? ''}
          submittedAt={lastSubmission ? dhaka(lastSubmission.createdAt) : null}
          contactEmail={contactEmail}
          action={submitPaymentAction.bind(null, order.id)}
        />
      ) : null}

      {frame === 'expired' ? (
        <>
          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 lg:p-5">
            <h2 className="font-heading text-xl font-semibold">{t('expiredTitle')}</h2>
            <p className="text-sm leading-relaxed text-[#4a4640]">
              {t.rich('expiredBody', {
                qty: n(order.quantity),
                name: ticketType.name,
                date: order.holdExpiresAt ? when(order.holdExpiresAt) : '',
                when: (chunks) => <span className="tabular">{chunks}</span>,
              })}
            </p>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t('heldLabel')}</dt>
              <dd className="tabular">
                {t('qtyName', { qty: n(order.quantity), name: ticketType.name })}
              </dd>
              <dt className="text-muted-foreground">{t('amount')}</dt>
              <dd className="tabular">
                {t.rich('unpaid', { amount: () => money(order.totalPaisa) })}
              </dd>
            </dl>
          </section>
          <section className="flex flex-col gap-2 rounded-xl border border-[#e8c48a] bg-warning-tint p-4 text-[#7a4600]">
            <p className="text-[15px] font-semibold">{t('alreadySent')}</p>
            <p className="text-sm leading-relaxed">{t.rich('alreadySentBody', contact)}</p>
          </section>
          <Link
            href={`/events/${event.slug}`}
            className="inline-flex h-13 w-full items-center justify-center rounded-lg border border-foreground bg-foreground px-7 text-[17px] font-semibold text-background hover:bg-[#33302a]"
          >
            {t('registerAgain')}
          </Link>
        </>
      ) : null}

      {frame === 'issued' ? (
        <>
          <section className="flex flex-col gap-2 rounded-xl border border-[#bfe0cd] bg-success-tint p-4 text-[#17603b] lg:p-5">
            <h2 className="font-heading text-xl font-semibold">{t('youreIn')}</h2>
            <p className="text-sm leading-relaxed" data-testid="issued-line">
              {comp
                ? compIssued
                  ? t('compLineOn', {
                      count: tickets.length,
                      organizer: settings.organizerName,
                      when: when(compIssued.createdAt),
                    })
                  : t('compLine', { count: tickets.length, organizer: settings.organizerName })
                : lastApproval
                  ? t('paidLineOn', { when: when(lastApproval.createdAt) })
                  : t('paidLine')}{' '}
              {t.rich('inbox', {
                count: tickets.length,
                n: n(tickets.length),
                email: () => <strong>{order.buyerEmail}</strong>,
              })}
            </p>
          </section>
          <ul className="flex flex-col gap-2.5" data-testid="ticket-list">
            {tickets.map((ticket, i) => (
              <li
                key={ticket.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3.5"
              >
                <div className="min-w-0">
                  <div className="text-[13px] text-muted-foreground">
                    {t('ticketN', { n: n(i + 1), name: ticketType.name })}
                  </div>
                  <div className="font-mono text-[15px] font-medium">{ticket.code}</div>
                  <div className="text-[15px]">{ticket.attendeeName}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <StatusChip kind="ticket" status={ticket.status} label={tst(ticket.status)} />
                  <Link
                    href={`/tickets/${ticket.code}`}
                    className="text-sm font-semibold underline"
                  >
                    {t('openTicket')}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          {comp ? null : (
            <p className="text-sm text-muted-foreground tabular">
              {t.rich('paidTrx', {
                trxId: order.bkashTrxId ?? '',
                amount: () => money(order.totalPaisa),
              })}
            </p>
          )}
        </>
      ) : null}

      {frame === 'paid' ? (
        // Never expected to persist (ADR-014): approve moves straight to
        // issued. If it does, say the truth — no ticket rows exist yet.
        <section className="flex flex-col gap-2 rounded-xl border border-[#bfe0cd] bg-success-tint p-4 text-[#17603b] lg:p-5">
          <h2 className="font-heading text-xl font-semibold">{t('paidTitle')}</h2>
          <p className="text-sm leading-relaxed">
            {t.rich('paidBody', { email: () => <strong>{order.buyerEmail}</strong> })}
          </p>
        </section>
      ) : null}

      {frame === 'rejected' ? (
        <>
          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 lg:p-5">
            <h2 className="font-heading text-xl font-semibold">{t('rejectedTitle')}</h2>
            <p className="text-sm leading-relaxed text-[#4a4640]">
              {lastRejection
                ? t('rejectedBodyOn', { when: when(lastRejection.createdAt) })
                : t('rejectedBody')}
            </p>
            <div className="mt-1 rounded-lg border border-[#efc4c0] bg-destructive-tint px-3.5 py-3 text-[#8e1e17]">
              <p className="text-xs font-medium tracking-widest uppercase">{t('reasonLabel')}</p>
              <p className="mt-1 text-[15px] font-semibold" data-testid="rejection-reason">
                {isRejectionReason(order.rejectionReason)
                  ? t(`rejection.${order.rejectionReason}`)
                  : (order.rejectionReason ?? t('noReason'))}
              </p>
              {/* The organizer's own words, shown as typed. */}
              {order.rejectionNote ? (
                <p className="mt-1 text-sm" data-testid="rejection-note">
                  {order.rejectionNote}
                </p>
              ) : null}
            </div>
          </section>
          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <h2 className="text-[15px] font-semibold">{t('todo')}</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-[#4a4640]">
              <li>{t('todo1')}</li>
              <li>{t.rich('todo2', contact)}</li>
              <li>{t('todo3')}</li>
            </ol>
          </section>
          {order.rejectionReason !== 'buyer_cancelled' &&
          order.rejectionReason !== 'duplicate_order' ? (
            <Link
              href={`/events/${event.slug}`}
              className="inline-flex h-13 w-full items-center justify-center rounded-lg border border-foreground bg-card px-7 text-[17px] font-semibold hover:bg-secondary"
            >
              {t('registerAgain')}
            </Link>
          ) : null}
        </>
      ) : null}

      {frame === 'other' ? (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <p className="text-[15px] text-[#4a4640]">{t('cancelled')}</p>
          {contactEmail ? (
            <p className="text-sm text-muted-foreground">{t.rich('questions', contact)}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Step({ n, children }: { n: string; children: React.ReactNode }) {
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
