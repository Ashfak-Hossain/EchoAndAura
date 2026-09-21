import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactCard, Prose, StaticPage } from '@/components/public/static-page';
import { HOLD_HOURS, LAST_UPDATED, REFUND_WORKING_DAYS } from '@/content/site';
import { siteUrl } from '@/lib/env.public';
import { getSiteSettings } from '@/lib/settings';

export const metadata: Metadata = {
  title: 'Refund policy',
  description: 'When money is returned, how, and how long it takes.',
  alternates: { canonical: `${siteUrl()}/refund` },
};

/**
 * A7 — the policy every other page points at when it says "refunds are
 * handled outside the app". Draft copy from the design frame; the promises
 * in it (turnaround, cancellation) are the organizer's to confirm.
 */
export default async function RefundPolicyPage() {
  const settings = await getSiteSettings();
  return (
    <StaticPage eyebrow="Refunds" title="Refund policy" lastUpdated={LAST_UPDATED.refund}>
      <Prose>
        <p>
          Tickets are non-refundable once your payment has been verified and tickets issued. This is
          a small operation and the money goes straight into putting the show on.
        </p>

        <h2>If your payment was rejected</h2>
        <p>
          Nothing was taken by us. If the money did leave your bKash account, send the receipt to
          the organizer and it will be returned by bKash transfer, by hand, within{' '}
          {REFUND_WORKING_DAYS} working days.
        </p>

        <h2>If your hold expired</h2>
        <p>
          An unpaid order holds its tickets for {HOLD_HOURS} hours and then releases them. If you
          sent money for an order that has since expired, message the organizer with the order
          reference and the transaction ID: the payment is matched to a new order while tickets
          remain, and returned the same way as above if the event has sold out.
        </p>

        <h2>If the event is cancelled</h2>
        <p>
          Every verified order is refunded in full to the sending bKash number. You do not need to
          ask.
        </p>

        <h2>If the event is postponed</h2>
        <p>
          Your tickets stay valid for the new date. If you cannot make it, message the organizer
          before the original date and the order is refunded in full to the sending bKash number.
        </p>

        <h2>If you cannot attend</h2>
        <p>
          Tickets are transferable: change the name on the ticket page until registration closes and
          give the ticket to someone else. See{' '}
          <Link href="/faq#someone-else">Can someone else use my ticket?</Link>
        </p>

        <h2>How refunds are made</h2>
        <p>
          Refunds are not processed in the app. They are sent as a bKash transfer to the number the
          payment came from, by a person, and you get a message when it is done. There is no fee
          deducted from a refund.
        </p>
      </Prose>
      <ContactCard title="Need a refund?" settings={settings} />
    </StaticPage>
  );
}
