import Link from 'next/link';
import { Callout } from '@/components/public/help/layout';
import { MAX_TICKETS_PER_ORDER } from '@/server/lib/order-rules';
import { HOLD_HOURS, REGISTRATION_CLOSES_DAYS_BEFORE } from '@/content/site';
import type { PolicyDoc } from './types';

/**
 * Terms of sale — what "I agree to the terms" on the registration form
 * points at. Plain-language terms for a single-organizer site; not a
 * lawyer's document, and the organizer should have it read before launch.
 */
export const terms: PolicyDoc = {
  key: 'terms',
  contactTitle: 'Questions about these terms?',
  shortVersion: [
    'A ticket admits one named person to one event. The price you see is the price you pay — no added fees.',
    `Registering holds your tickets for ${HOLD_HOURS} hours while you pay by bKash. A person checks every payment before tickets are issued.`,
    `You can change the name on a ticket until registration closes, ${REGISTRATION_CLOSES_DAYS_BEFORE} days before the event.`,
    'Issued tickets are non-refundable, except as the refund policy sets out. Refunds are made by bKash, outside the app.',
    'Our responsibility is limited to the price of the tickets you bought.',
  ],
  intro: (
    <p>
      These are the terms between you and echoandaura (&ldquo;we&rdquo;, &ldquo;the
      organizer&rdquo;) when you register for an event on this site. They are short on purpose. If
      anything here is unclear, ask before you pay.
    </p>
  ),
  sections: [
    {
      id: 'what-you-are-buying',
      title: 'What you are buying',
      body: (
        <p>
          A ticket is a named admission to one event for one person. Each order is for one ticket
          type in any quantity up to {MAX_TICKETS_PER_ORDER}. The price shown on the event page at
          the moment you register is the price you pay; there are no added fees.
        </p>
      ),
    },
    {
      id: 'names-and-transfers',
      title: 'Names and transfers',
      body: (
        <>
          <p>
            Registration asks for one name — yours. Every ticket in the order starts with it.
            Tickets are transferable: the name on each ticket can be changed on its ticket page
            until registration closes, {REGISTRATION_CLOSES_DAYS_BEFORE} days before the event.
            After that the names are final.
          </p>
          <Callout
            label="Names"
            title={`Names lock ${REGISTRATION_CLOSES_DAYS_BEFORE} days before the event`}
          >
            Change a name any time until registration closes. After that the names are final.
          </Callout>
          <p>
            At the door the QR on your ticket is scanned (staff can also type the ticket code or
            find your name). Each ticket admits one person, once: the first scan wins, and a copy of
            a ticket that has already been scanned is turned away. A printed list is kept as the
            backup.
          </p>
          <Callout label="At the door" title="The first scan wins">
            Each ticket admits one person, once. Keep your ticket to yourself, or change the name on
            it before you hand it over.
          </Callout>
        </>
      ),
    },
    {
      id: 'paying-by-bkash',
      title: 'Paying by bKash',
      body: (
        <p>
          Payment is a bKash transfer to the number shown on your order page, followed by entering
          the transaction ID (TrxID) and the number you sent from. A person checks each payment
          against the bKash statement before tickets are issued. Tickets are issued once that check
          has passed; they appear on your order page and are emailed to you.
        </p>
      ),
    },
    {
      id: 'holds-and-expiry',
      title: 'Holds and expiry',
      body: (
        <>
          <Callout label="Holds" title={`Your tickets are held for ${HOLD_HOURS} hours`}>
            Submit the transaction ID inside that time, or the order expires and the tickets go back
            on sale.
          </Callout>
          <p>
            Registering holds your tickets for {HOLD_HOURS} hours. If no transaction ID is submitted
            within that time the order expires and the tickets go back on sale. A submitted payment
            that cannot be matched is rejected with a reason, and the tickets are released the same
            way. See the <Link href="/refund">refund policy</Link> for what happens to money that
            was sent.
          </p>
        </>
      ),
    },
    {
      id: 'refunds-and-cancellations',
      title: 'Refunds and cancellations',
      body: (
        <>
          <p>
            Once tickets are issued they are non-refundable, except as set out in the{' '}
            <Link href="/refund">refund policy</Link> (a cancelled or postponed event, or money sent
            for an order that could not be completed). Refunds are made by bKash transfer outside
            the app. The organizer may cancel a ticket — for example a duplicate order — in which
            case the ticket is marked cancelled, will not be admitted, and its price is returned as
            the <Link href="/refund#ticket-cancelled">refund policy</Link> describes.
          </p>
          <Callout label="Refunds" title="No refunds through the site">
            When money is due back, a person sends it by bKash transfer, outside the app.
          </Callout>
        </>
      ),
    },
    {
      id: 'the-event-itself',
      title: 'The event itself',
      body: (
        <p>
          Dates, times, venues and line-ups can change. We will email every ticket holder about a
          material change and post it on the event page. The organizer may refuse admission or
          remove anyone whose behaviour endangers others, without refund. Venue rules apply.
        </p>
      ),
    },
    {
      id: 'your-details',
      title: 'Your details',
      body: (
        <p>
          We use your name, email, mobile number and bKash sender number only to run the event and
          your order. How that works is in the <Link href="/privacy">privacy policy</Link>.
        </p>
      ),
    },
    {
      id: 'accounts',
      title: 'Accounts',
      body: (
        <p>
          An account is optional. If you sign in with your email, you see the orders placed with
          that email. Keep the sign-in links we email you to yourself: anyone with the link can see
          those orders.
        </p>
      ),
    },
    {
      id: 'liability',
      title: 'Liability',
      body: (
        <p>
          Our responsibility to you is limited to the price of the tickets you bought. We are not
          responsible for travel, accommodation or other costs if an event changes or is cancelled.
          Nothing here limits any right you have under the law of Bangladesh that cannot be limited.
        </p>
      ),
    },
    {
      id: 'changes-to-these-terms',
      title: 'Changes to these terms',
      body: (
        <p>
          The terms that apply to an order are the ones published when you registered. The date at
          the top of this page changes when the wording does.
        </p>
      ),
    },
  ],
};
