import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ordersService } from '@/server/container';
import { OrderNotFoundError } from '@/server/lib/errors';
import { REJECTION_REASONS, isRejectionReason } from '@/server/lib/rejection-reasons';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page-header';
import { StatusChip } from '@/components/status-chip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDhakaLong, formatDhakaShort, formatRelative } from '@/lib/time';
import { approveOrderAction, rejectOrderAction } from './actions';
import { VerificationActions } from './verification-actions';

export const metadata: Metadata = { title: 'Order' };
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ approved?: string; rejected?: string }>;
}

// B8: three read columns, then the actions bar, then the writeable lists.
// The page shape never changes between statuses — only which actions exist.
export default async function AdminOrderPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { approved, rejected } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();

  let view;
  try {
    view = await ordersService.getOrder(id);
  } catch (err: unknown) {
    if (err instanceof OrderNotFoundError) notFound();
    throw err;
  }
  const { order, event, ticketType, events, tickets } = view;
  const now = new Date();
  const submitted = [...events]
    .reverse()
    .find((e) => e.action === 'payment.submitted' || e.action === 'payment.updated');

  const metaLine = [
    `Created ${formatDhakaLong(order.createdAt)} (Dhaka)`,
    submitted ? `submitted ${formatRelative(submitted.createdAt, now)}` : null,
    order.holdExpiresAt &&
    (order.status === 'pending_payment' || order.status === 'pending_verification')
      ? `hold ends ${formatDhakaShort(order.holdExpiresAt)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={<span className="font-mono">{order.reference}</span>}
        badge={
          <span data-testid="order-status">
            <StatusChip kind="order" status={order.status} />
          </span>
        }
        subtitle={metaLine}
        actions={
          <Link href="/admin/verification" className="text-sm font-medium hover:underline">
            ← Back to queue
          </Link>
        }
      />

      {approved === '1' ? (
        <p role="status" className="rounded-md bg-success-tint px-3 py-2 text-sm text-success">
          Payment approved — {tickets.length} {tickets.length === 1 ? 'ticket' : 'tickets'} issued.
        </p>
      ) : null}
      {rejected === '1' ? (
        <p role="status" className="rounded-md bg-secondary px-3 py-2 text-sm">
          Order rejected — the held seats are back on sale.
        </p>
      ) : null}

      {order.status === 'rejected' && order.rejectionReason ? (
        <div className="rounded-xl border border-[#efc4c0] bg-destructive-tint px-4 py-3.5 text-[#8e1e17]">
          <p className="text-[15px] font-semibold">
            Rejected —{' '}
            {isRejectionReason(order.rejectionReason)
              ? REJECTION_REASONS[order.rejectionReason]
              : order.rejectionReason}
          </p>
          {order.rejectionNote ? <p className="mt-1 text-sm">{order.rejectionNote}</p> : null}
        </div>
      ) : null}

      {/* Three read columns */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Buyer">
          <Row label="Name">{order.buyerName}</Row>
          <Row label="Email">
            <a href={`mailto:${order.buyerEmail}`} className="underline">
              {order.buyerEmail}
            </a>
          </Row>
          <Row label="Phone" mono>
            {order.buyerPhone}
          </Row>
        </Card>
        <Card title="Order">
          <Row label="Event">
            <Link href={`/admin/events/${event.id}/edit`} className="underline">
              {event.title}
            </Link>
          </Row>
          <Row label="Ticket type">
            {ticketType.name} × {order.quantity}
          </Row>
          <Row label="Unit price">
            <Money paisa={order.unitPricePaisa} />
          </Row>
          <Row label="Subtotal">
            <Money paisa={order.subtotalPaisa} />
          </Row>
          {order.discountPaisa > 0 ? (
            <Row label="Discount">
              −<Money paisa={order.discountPaisa} />
            </Row>
          ) : null}
          <Row label="Total" strong>
            <Money paisa={order.totalPaisa} />
          </Row>
        </Card>
        {/* Tinted: the only column Raj compares against another screen. */}
        <Card title="bKash" tinted>
          <Row label="Transaction ID" mono>
            {order.bkashTrxId ?? '—'}
          </Row>
          <Row label="Sender" mono>
            {order.bkashSenderMsisdn ?? '—'}
          </Row>
          <Row label="Submitted">{submitted ? formatDhakaShort(submitted.createdAt) : '—'}</Row>
          <Row label="Hold expires">
            {order.holdExpiresAt ? formatDhakaShort(order.holdExpiresAt) : '—'}
          </Row>
        </Card>
      </div>

      {order.status === 'pending_verification' ? (
        <VerificationActions
          reference={order.reference}
          buyerFirstName={order.buyerName.split(/\s+/)[0] ?? order.buyerName}
          buyerEmail={order.buyerEmail}
          quantity={order.quantity}
          ticketTypeName={ticketType.name}
          totalPaisa={order.totalPaisa}
          trxId={order.bkashTrxId ?? ''}
          senderMsisdn={order.bkashSenderMsisdn ?? ''}
          approve={approveOrderAction.bind(null, order.id, order.bkashTrxId ?? '')}
          reject={rejectOrderAction.bind(null, order.id)}
        />
      ) : order.status === 'pending_payment' ? (
        <p className="text-sm text-muted-foreground">No trxID yet — nothing to verify.</p>
      ) : null}

      {/* Tickets */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg">
          Tickets{' '}
          <span className="text-sm font-normal text-muted-foreground">
            · {tickets.length === 0 ? 'issued on approval' : `${tickets.length} issued`}
          </span>
        </h2>
        {tickets.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Attendee</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((t) => (
                  <TableRow key={t.id} data-testid="ticket-row">
                    <TableCell className="font-mono">
                      <Link
                        href={`/tickets/${t.code}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {t.code}
                      </Link>
                    </TableCell>
                    <TableCell>{t.attendeeName}</TableCell>
                    <TableCell>
                      <StatusChip kind="ticket" status={t.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </section>

      {/* Audit trail */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg">
          Audit trail{' '}
          <span className="font-mono text-xs font-normal text-muted-foreground">
            order_events · append-only, newest first
          </span>
        </h2>
        <ol className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {[...events].reverse().map((e) => (
            <li key={e.id} className="flex flex-col gap-0.5 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{e.action}</span>
                <span className="text-[13px] text-muted-foreground tabular">
                  {e.actor} · {formatDhakaLong(e.createdAt)} (Dhaka)
                </span>
              </div>
              <div className="font-mono text-[13px] text-muted-foreground">
                {e.fromStatus ?? '∅'} → {e.toStatus ?? '∅'}
              </div>
              {e.note ? <div className="text-sm">{e.note}</div> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Card({
  title,
  tinted,
  children,
}: {
  title: string;
  tinted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={
        tinted
          ? 'flex flex-col gap-2.5 rounded-xl border border-[#c3d6ec] bg-info-tint p-[18px]'
          : 'flex flex-col gap-2.5 rounded-xl border border-border bg-card p-[18px]'
      }
    >
      <h2 className="font-sans text-xs font-medium tracking-widest text-muted-foreground uppercase">
        {title}
      </h2>
      <dl className="flex flex-col gap-1.5">{children}</dl>
    </section>
  );
}

function Row({
  label,
  mono,
  strong,
  children,
}: {
  label: string;
  mono?: boolean;
  strong?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`text-right tabular ${mono ? 'font-mono' : ''} ${strong ? 'font-semibold' : ''}`}
      >
        {children}
      </dd>
    </div>
  );
}
