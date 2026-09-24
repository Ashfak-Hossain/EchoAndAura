import Link from 'next/link';
import { Callout } from '@/components/public/help/layout';
import { HOLD_HOURS, REFUND_WORKING_DAYS, REGISTRATION_CLOSES_DAYS_BEFORE } from '@/content/site';
import type { PolicyDoc } from './types';

/**
 * The policy every other page points at when it says "refunds are handled
 * outside the app". The promises in it (turnaround, cancellation) are the
 * organizer's to confirm.
 */
export const refund: PolicyDoc = {
  key: 'refund',
  contactTitle: 'Need a refund?',
  shortVersion: [
    'Once your payment is verified and tickets are issued, they are non-refundable.',
    'Event cancelled: every verified order is refunded in full. You do not need to ask.',
    'Event postponed: your tickets stay valid. If you cannot make the new date, message the organizer before the original date for a full refund.',
    `Payment rejected but the money left your account: it is returned within ${REFUND_WORKING_DAYS} working days.`,
    'Refunds are sent by a person, by bKash, to the number the payment came from. No fee is deducted.',
  ],
  intro: (
    <p>
      Tickets are non-refundable once your payment has been verified and tickets issued. This is a
      small operation and the money goes straight into putting the show on.
    </p>
  ),
  sections: [
    {
      id: 'payment-rejected',
      title: 'If your payment was rejected',
      body: (
        <p>
          Nothing was taken by us. If the money did leave your bKash account, send the receipt to
          the organizer and it will be returned by bKash transfer, by hand, within{' '}
          {REFUND_WORKING_DAYS} working days.
        </p>
      ),
    },
    {
      id: 'hold-expired',
      title: 'If your hold expired',
      body: (
        <>
          <Callout label="Holds" title={`An unpaid order is held for ${HOLD_HOURS} hours`}>
            After that its tickets are released if no transaction ID was submitted — even if the
            money was sent.
          </Callout>
          <p>
            An unpaid order holds its tickets for {HOLD_HOURS} hours and then releases them. If you
            sent money for an order that has since expired, message the organizer with the order
            reference and the transaction ID: the payment is matched to a new order while tickets
            remain, and returned the same way as above if the event has sold out.
          </p>
        </>
      ),
    },
    {
      id: 'ticket-cancelled',
      title: 'If the organizer cancels your ticket',
      body: (
        <p>
          The organizer may cancel a ticket — for example a duplicate order. A cancelled ticket will
          not be admitted, and its price is returned in full to the sending bKash number, as
          described under How refunds are made. You do not need to ask.
        </p>
      ),
    },
    {
      id: 'event-cancelled',
      title: 'If the event is cancelled',
      body: (
        <p>
          Every verified order is refunded in full to the sending bKash number. You do not need to
          ask.
        </p>
      ),
    },
    {
      id: 'event-postponed',
      title: 'If the event is postponed',
      body: (
        <p>
          Your tickets stay valid for the new date. If you cannot make it, message the organizer
          before the original date and the order is refunded in full to the sending bKash number.
        </p>
      ),
    },
    {
      id: 'cannot-attend',
      title: 'If you cannot attend',
      body: (
        <>
          <p>
            Tickets are transferable: change the name on the ticket page until registration closes
            and give the ticket to someone else. See{' '}
            <Link href="/faq#someone-else">Can someone else use my ticket?</Link>
          </p>
          <Callout
            label="Names"
            title={`Names lock ${REGISTRATION_CLOSES_DAYS_BEFORE} days before the event`}
          >
            Registration closes then, and so does renaming. Pass your ticket on before that date.
          </Callout>
        </>
      ),
    },
    {
      id: 'how-refunds-are-made',
      title: 'How refunds are made',
      body: (
        <>
          <Callout label="Refunds" title="Refunds are not processed in the app">
            There is no refund button. A person sends the money back by bKash.
          </Callout>
          <p>
            Refunds are not processed in the app. They are sent as a bKash transfer to the number
            the payment came from, by a person, and you get a message when it is done. There is no
            fee deducted from a refund.
          </p>
        </>
      ),
    },
  ],
};
