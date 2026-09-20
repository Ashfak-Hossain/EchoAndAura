import { Link, Text } from '@react-email/components';
import { formatBDT } from '@/server/lib/money';
import { formatDhakaLong } from '@/lib/time';
import { EmailLayout, Hr, Row, styles } from './layout';
import type { EmailView } from './view';

/** C4 — sent by the expiry job. Remaining stock stated so registering again feels worth doing. */
export function subject(v: EmailView): string {
  return `Your ticket hold has expired — ${v.order.reference}`;
}

export function ExpiredEmail({ v }: { v: EmailView }) {
  const registerUrl = `${v.siteUrl}/events/${v.event.slug}`;
  const closes = v.event.registrationClosesAt
    ? `${formatDhakaLong(v.event.registrationClosesAt)} (Dhaka)`
    : null;
  return (
    <EmailLayout
      preview="Nothing was charged. Tickets are still available."
      contactEmail={v.contactEmail}
      contactPhone={v.contactPhone}
      siteUrl={v.siteUrl}
    >
      <Text style={styles.h1}>Your ticket hold has expired</Text>
      <Text style={styles.p}>
        We held {v.order.quantity} {v.ticketType.name}{' '}
        {v.order.quantity === 1 ? 'ticket' : 'tickets'} for {v.event.title}
        {v.order.holdExpiresAt ? ` until ${formatDhakaLong(v.order.holdExpiresAt)} (Dhaka)` : ''}.
        No transaction ID arrived, so the seats are back on sale. Nothing was charged.
      </Text>
      <Row label="Order">
        <span style={styles.mono}>{v.order.reference}</span>
      </Row>
      <Row label="Was holding">
        {v.ticketType.name} × {v.order.quantity} · {formatBDT(v.order.totalPaisa)} unpaid
      </Row>
      {v.availableNow > 0 ? (
        <Row label="Still available">
          {v.availableNow} {v.ticketType.name} tickets
        </Row>
      ) : null}

      <div style={styles.callout}>
        <Text style={{ ...styles.p, margin: 0 }}>
          <strong>Already sent the money? Do not send it again.</strong> Reply with your TrxID and
          {v.contactPhone ? ' Raj' : ' the organizer'} will match it by hand.
        </Text>
      </div>

      <Text style={{ margin: '16px 0' }}>
        <Link href={registerUrl} style={styles.button}>
          Register again
        </Link>
      </Text>
      {closes ? (
        <>
          <Hr style={styles.hr} />
          <Text style={styles.small}>
            Registration closes {closes} — five days before the show, so the door list can be
            printed.
          </Text>
        </>
      ) : null}
    </EmailLayout>
  );
}
