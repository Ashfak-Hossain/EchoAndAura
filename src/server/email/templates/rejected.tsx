import { Link, Text } from '@react-email/components';
import { REJECTION_REASONS, isRejectionReason } from '@/server/lib/rejection-reasons';
import { formatDhakaLong } from '@/lib/time';
import { EmailLayout, Hr, styles } from './layout';
import { type EmailView, firstName } from './view';

/** C3 — sent on rejection. The organizer's reason and note, verbatim; money reassurance first. */
export function subject(v: EmailView): string {
  return `We couldn’t match your payment — ${v.order.reference}`;
}

export function RejectedEmail({ v }: { v: EmailView }) {
  const reason = isRejectionReason(v.order.rejectionReason)
    ? REJECTION_REASONS[v.order.rejectionReason]
    : (v.order.rejectionReason ?? 'No reason recorded');
  const registerUrl = `${v.siteUrl}/events/${v.event.slug}`;
  return (
    <EmailLayout
      preview="No tickets were issued and nothing was charged by us."
      contactEmail={v.contactEmail}
      contactPhone={v.contactPhone}
      siteUrl={v.siteUrl}
    >
      <Text style={styles.h1}>We couldn&apos;t match your payment</Text>
      <Text style={styles.p}>
        Hello {firstName(v.order.buyerName)}. We checked order{' '}
        <span style={styles.mono}>{v.order.reference}</span> on {formatDhakaLong(v.at)} (Dhaka) and
        could not find the payment. No tickets were issued and the seats have gone back on sale.
      </Text>
      <div style={styles.callout}>
        <Text style={styles.label}>Reason</Text>
        <Text style={{ ...styles.p, fontWeight: 700, margin: 0 }}>{reason}</Text>
        {v.order.rejectionNote ? (
          <Text style={{ ...styles.p, margin: '6px 0 0' }}>{v.order.rejectionNote}</Text>
        ) : null}
      </div>

      <Hr style={styles.hr} />
      <Text style={{ ...styles.p, fontWeight: 700 }}>What to do now</Text>
      <Text style={styles.p}>
        1. Check the TrxID in your bKash history — it is ten letters and numbers and easy to
        mistype.
      </Text>
      <Text style={styles.p}>
        2. If the money did leave your account, reply with a screenshot of the bKash receipt and we
        will sort it out by hand.
      </Text>
      <Text style={styles.p}>
        3. If it never left, register again
        {v.availableNow > 0
          ? ` — ${v.availableNow} ${v.ticketType.name} tickets are still available`
          : ''}
        .
      </Text>
      <Text style={{ margin: '16px 0' }}>
        <Link href={registerUrl} style={styles.button}>
          Register again
        </Link>
      </Text>
      <Text style={styles.small}>
        Talk to a person: reply to this email
        {v.contactPhone ? ` or message Raj on ${v.contactPhone} (bKash, WhatsApp)` : ''} and you
        will hear back within a day.
      </Text>
    </EmailLayout>
  );
}
