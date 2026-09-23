import { Link, Text } from '@react-email/components';
import { formatBDT } from '@/server/lib/money';
import { formatDhakaLong } from '@/lib/time';
import { EmailLayout, Hr, Row, styles } from './layout';
import { type EmailView, firstName } from './view';

/** C1 — sent on order creation. The amount and the deadline must survive a 2-second read. */
export function subject(v: EmailView): string {
  return `Finish your payment for ${v.event.title} — ${v.order.reference}`;
}

export function PaymentInstructionsEmail({ v }: { v: EmailView }) {
  const amount = formatBDT(v.order.totalPaisa);
  const deadline = v.order.holdExpiresAt
    ? `${formatDhakaLong(v.order.holdExpiresAt)} (Dhaka)`
    : null;
  const orderUrl = `${v.siteUrl}/orders/${v.order.id}`;
  return (
    <EmailLayout
      preview={`Send ${amount} by bKash and paste the transaction ID. Held 24 hours.`}
      sender={v}
      footerNote="You are getting this because you registered for an event. No refunds in the app."
    >
      <Text style={styles.h1}>Your tickets are held for 24 hours</Text>
      <Text style={styles.p}>
        Hello {firstName(v.order.buyerName)}, thanks for registering. Nothing is confirmed until you
        send the money and paste the transaction ID back to us.
      </Text>

      <Row label="Order">
        <span style={styles.mono}>{v.order.reference}</span>
      </Row>
      <Row label="Event">
        {v.event.title} · {formatDhakaLong(v.event.startsAt)} (Dhaka)
      </Row>
      <Row label="Tickets">
        {v.ticketType.name} × {v.order.quantity}
      </Row>
      <Text style={styles.label}>Amount to send</Text>
      <Text style={styles.big}>{amount}</Text>
      {v.order.discountPaisa > 0 && v.promoCode ? (
        <Text style={styles.p}>
          Includes {formatBDT(v.order.discountPaisa)} off with {v.promoCode}.
        </Text>
      ) : null}
      {deadline ? (
        <Text style={styles.p}>
          Send by <strong>{deadline}</strong>. After that the seats go back on sale automatically.
        </Text>
      ) : null}

      <Hr style={styles.hr} />
      <Text style={{ ...styles.p, fontWeight: 700 }}>How to pay with bKash</Text>
      <Text style={styles.p}>
        1. Open bKash and choose{' '}
        <strong>{v.bkashAccountType === 'merchant' ? 'Payment' : 'Send Money'}</strong>.
      </Text>
      <Text style={styles.p}>
        2. Send <strong>{amount}</strong> to{' '}
        <strong>{v.bkashNumber ?? 'the number on your order page'}</strong>
        {v.bkashAccountName
          ? ` (${v.bkashAccountName})`
          : v.bkashAccountType === 'merchant'
            ? ' — a merchant account'
            : ' — a personal account'}
        .
      </Text>
      <Text style={styles.p}>
        3. Put <span style={styles.mono}>{v.order.reference}</span> in the reference field.
      </Text>
      <Text style={styles.p}>4. Come back to your order page and paste the TrxID.</Text>
      <Text style={{ margin: '16px 0' }}>
        <Link href={orderUrl} style={styles.buttonAccent}>
          Open my order page
        </Link>
      </Text>
      <Text style={styles.small}>
        Find the TrxID in the bKash app: History → tap the transaction → TrxID. It is ten letters
        and numbers. A person checks every payment, {v.verificationPromise}. Stuck? Reply to this
        email{v.contactPhone ? ` or message ${v.organizerName} on ${v.contactPhone}` : ''}.
      </Text>
    </EmailLayout>
  );
}
