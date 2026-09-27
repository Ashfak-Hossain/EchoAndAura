import type { Metadata } from 'next';
import { ticketQrSvg } from '@/server/lib/qr';
import { StatusChip } from '@/components/status-chip';
import { getSiteSettings } from '@/lib/settings';
import { formatDhakaLong } from '@/lib/time';
import { cn } from '@/lib/utils';
import { CopyField } from '../../orders/[id]/copy-field';
import { renameAttendeeAction } from './actions';
import { loadTicket } from './load';
import { RenameForm } from './rename-form';

interface Props {
  params: Promise<{ code: string }>;
}

// The code is the access key; nothing here is for search engines.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const view = await loadTicket(code);
  return {
    title: `Ticket ${view.ticket.code} — ${view.event.title}`,
    robots: { index: false, follow: false },
  };
}

// A5: "Admit one". The QR is the code and nothing else — the gate scanner
// looks it up (ADR-030); the code and the name stay readable beside it
// because a dead phone, a typed code or the printed backup list must work too.
export default async function TicketPage({ params }: Props) {
  const { code } = await params;
  const view = await loadTicket(code);
  const { ticket, event, ticketType, order, position, canRename, renameLockedAt } = view;
  const cancelled = ticket.status === 'cancelled';
  const qr = await ticketQrSvg(ticket.code);
  const contact = (await getSiteSettings()).supportEmail;
  const lockedAtText = renameLockedAt ? `${formatDhakaLong(renameLockedAt)} (Dhaka)` : null;

  return (
    <div className="mx-auto flex w-full max-w-120 flex-1 flex-col gap-5 px-4 py-6 lg:py-10">
      <article
        className={cn(
          'relative flex flex-col gap-5 overflow-hidden rounded-2xl border bg-card p-5 lg:p-6',
          cancelled ? 'border-border grayscale' : 'border-border-strong',
        )}
        data-testid="ticket"
        data-status={ticket.status}
      >
        {cancelled ? (
          <span
            aria-hidden="true"
            className="absolute top-8 -right-10 rotate-[30deg] bg-foreground px-14 py-1.5 font-mono text-sm font-medium tracking-[0.3em] text-background"
          >
            CANCELLED
          </span>
        ) : null}

        <header className="flex flex-col gap-1">
          <p className="font-sans text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Admit one
          </p>
          <h1 className="font-heading text-2xl leading-tight font-bold tracking-[-0.02em] text-pretty">
            {event.title}
          </h1>
          <p className="text-[15px] text-[#4a4640] tabular">
            {formatDhakaLong(event.startsAt)} (Dhaka)
            {event.venue ? ` · ${event.venue}` : ''}
          </p>
        </header>

        <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4">
          <div>
            <dt className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Attendee
            </dt>
            <dd className="mt-1 text-lg font-semibold" data-testid="attendee-name">
              {ticket.attendeeName}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Type
            </dt>
            <dd className="mt-1 text-lg font-semibold">{ticketType.name}</dd>
          </div>
        </dl>

        <div className="flex flex-col items-center gap-3 border-t border-border pt-4">
          <div
            className={cn(
              'size-44 rounded-lg bg-white p-2 [&_svg]:size-full',
              cancelled && 'opacity-40',
            )}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          <div className="w-full">
            <p className="mb-1.5 text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Ticket code
            </p>
            <div className={cn(cancelled && 'line-through opacity-60')}>
              <CopyField label="ticket code" value={ticket.code} />
            </div>
          </div>
          <p className="text-center text-[13px] leading-snug text-muted-foreground">
            {cancelled
              ? 'This ticket will not be admitted.'
              : 'Show this QR at the door — it is scanned and admits one person, once. No signal or a flat battery? Your name and code work too.'}
          </p>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border pt-4 text-[13px] text-muted-foreground">
          <span className="tabular">
            Order {order.reference} · ticket {position} of {order.quantity}
          </span>
          <StatusChip kind="ticket" status={ticket.status} />
        </footer>
      </article>

      {cancelled ? (
        <p className="text-sm leading-relaxed text-[#4a4640]">
          Cancelled by the organizer. Refunds are handled outside the app
          {contact ? (
            <>
              {' '}
              — contact{' '}
              <a href={`mailto:${contact}`} className="underline">
                {contact}
              </a>
            </>
          ) : null}
          .
        </p>
      ) : canRename ? (
        <RenameForm
          action={renameAttendeeAction.bind(null, ticket.code)}
          currentName={ticket.attendeeName}
          lockedAtText={lockedAtText}
        />
      ) : (
        <p className="text-sm leading-relaxed text-[#4a4640]" data-testid="rename-locked">
          Names locked{lockedAtText ? ` when registration closed on ${lockedAtText}` : ''}. The door
          list is already printed — if you need a change, message the organizer
          {contact ? (
            <>
              {' '}
              at{' '}
              <a href={`mailto:${contact}`} className="underline">
                {contact}
              </a>
            </>
          ) : null}
          .
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <a
          href={`/tickets/${ticket.code}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="flex h-11 items-center rounded-lg border border-foreground bg-foreground px-4 text-sm font-semibold text-background hover:bg-[#33302a]"
        >
          Download PDF
        </a>
        {!cancelled ? (
          <a
            href={`/tickets/${ticket.code}/calendar.ics`}
            className="flex h-11 items-center rounded-lg border border-border-strong bg-card px-4 text-sm font-semibold hover:bg-secondary"
          >
            Add to calendar
          </a>
        ) : null}
      </div>

      {!cancelled && canRename && lockedAtText ? (
        <p className="text-[13px] text-muted-foreground">
          You can change the name until registration closes on {lockedAtText}.
        </p>
      ) : null}
      {contact && !cancelled ? (
        <p className="text-[13px] text-muted-foreground">
          Questions at the door?{' '}
          <a href={`mailto:${contact}`} className="underline">
            {contact}
          </a>
        </p>
      ) : null}
    </div>
  );
}
