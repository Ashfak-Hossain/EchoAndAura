import { Link, Text } from '@react-email/components';
import { formatBDT } from '@/server/lib/money';
import { formatDhakaLong } from '@/lib/time';
import { EmailLayout, Hr, styles } from './layout';
import type { EmailView } from './view';

/** C2 — sent on approval, and to the guest of a comp (B13). One card per ticket with the code large: this is the email people screenshot. */
/** Live tickets only: a re-send after an admin cancel must not count a dead one. */
function liveTickets(v: EmailView) {
  return v.tickets.filter((t) => t.status === 'issued');
}

export function subject(v: EmailView): string {
  const n = liveTickets(v).length;
  return `Your ${n === 1 ? 'ticket' : `${n} tickets`} for ${v.event.title}`;
}

export function attachmentName(v: EmailView): string {
  return `tickets-${v.order.reference}.pdf`;
}

export function TicketsIssuedEmail({ v }: { v: EmailView }) {
  const live = liveTickets(v);
  // "2 of 3" is the ticket's fixed place in the order (ADR-015), the same
  // on the PDF and the ticket page — it does not renumber after a cancel.
  const n = v.tickets.length;
  const closes = v.event.registrationClosesAt
    ? `${formatDhakaLong(v.event.registrationClosesAt)} (Dhaka)`
    : null;
  // B13: a comp was never paid for. Its reason is internal and never rendered here.
  const comp = v.order.complimentaryReason !== null;
  return (
    <EmailLayout
      preview={
        comp
          ? `Complimentary ${live.length === 1 ? 'ticket' : 'tickets'}. Show the ticket QR at the door.`
          : 'Payment confirmed. Show the ticket QR at the door.'
      }
      sender={v}
    >
      <Text style={styles.h1}>You&apos;re in — here are your tickets</Text>
      <Text style={styles.p}>
        {comp
          ? `Complimentary ${live.length === 1 ? 'ticket' : 'tickets'} from ${v.organizerName}, issued on`
          : 'Payment confirmed on'}{' '}
        {formatDhakaLong(v.at)} (Dhaka) for order{' '}
        <span style={styles.mono}>{v.order.reference}</span>. At the door, open your ticket and show
        its QR to be scanned — or just give the code below. Each ticket admits one person, once.
      </Text>
      <Text style={{ ...styles.p, fontWeight: 700, margin: '0 0 4px' }}>{v.event.title}</Text>
      <Text style={styles.small}>
        {formatDhakaLong(v.event.startsAt)} (Dhaka)
        {v.event.venue ? ` · ${v.event.venue}` : ''}
      </Text>
      {v.event.venueHidden ? (
        <Text style={styles.small}>
          The venue isn&apos;t public — please don&apos;t share it widely.
        </Text>
      ) : null}

      <Hr style={styles.hr} />
      {live.map((t) => (
        <div
          key={t.code}
          style={{
            border: '1px solid #e3dfd7',
            borderRadius: '10px',
            padding: '14px 16px',
            marginBottom: '10px',
          }}
        >
          <Text style={styles.label}>
            Ticket {t.position} of {n} · {v.ticketType.name}
          </Text>
          <Text style={{ ...styles.p, fontWeight: 700, margin: '0 0 2px' }}>{t.attendeeName}</Text>
          <Text style={{ ...styles.mono, fontSize: '24px', margin: '0 0 10px', display: 'block' }}>
            {t.code}
          </Text>
          <Link href={`${v.siteUrl}/tickets/${t.code}`} style={styles.button}>
            Open ticket
          </Link>
        </div>
      ))}

      <Text style={styles.small}>
        📎 {attachmentName(v)} is attached — one page per ticket, prints in black and white.
      </Text>
      <Text style={styles.small}>
        Wrong name on a ticket? Open it and edit the name yourself
        {closes ? ` until registration closes on ${closes}` : ''}.
        {comp ? null : (
          <>
            {' '}
            Paid {formatBDT(v.order.totalPaisa)}
            {v.order.bkashTrxId ? ` · trxID ${v.order.bkashTrxId}` : ''}.
          </>
        )}
      </Text>
    </EmailLayout>
  );
}
