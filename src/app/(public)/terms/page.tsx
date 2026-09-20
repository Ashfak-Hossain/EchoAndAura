import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactCard, Prose, StaticPage } from '@/components/public/static-page';
import { HOLD_HOURS, LAST_UPDATED, REGISTRATION_CLOSES_DAYS_BEFORE } from '@/content/site';
import { siteUrl } from '@/lib/env.public';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The terms you agree to when you register for an event.',
  alternates: { canonical: `${siteUrl()}/terms` },
};

/**
 * A7 — what "I agree to the terms" on the registration form points at.
 * Plain-language terms for a single-organizer site; not a lawyer's
 * document, and the organizer should have it read before launch.
 */
export default function TermsPage() {
  return (
    <StaticPage eyebrow="Terms" title="Terms of sale" lastUpdated={LAST_UPDATED.terms}>
      <Prose>
        <p>
          These are the terms between you and echoandaura (&ldquo;we&rdquo;, &ldquo;the
          organizer&rdquo;) when you register for an event on this site. They are short on purpose.
          If anything here is unclear, ask before you pay.
        </p>

        <h2>1. What you are buying</h2>
        <p>
          A ticket is a named admission to one event for one person. Each order is for one ticket
          type in any quantity up to ten. The price shown on the event page at the moment you
          register is the price you pay; there are no added fees.
        </p>

        <h2>2. Names and transfers</h2>
        <p>
          Registration asks for one name — yours. Every ticket in the order starts with it. Tickets
          are transferable: the name on each ticket can be changed on its ticket page until
          registration closes, {REGISTRATION_CLOSES_DAYS_BEFORE} days before the event. After that
          the door list is printed and the names are final. Admission at the door is by name and
          ticket code against that list; there is no scanning.
        </p>

        <h2>3. Paying by bKash</h2>
        <p>
          Payment is a bKash transfer to the number shown on your order page, followed by entering
          the transaction ID (TrxID) and the number you sent from. A person checks each payment
          against the bKash statement before tickets are issued. Tickets exist only once that check
          has passed and the tickets email has been sent.
        </p>

        <h2>4. Holds and expiry</h2>
        <p>
          Registering holds your tickets for {HOLD_HOURS} hours. If no transaction ID is submitted
          within that time the order expires and the tickets go back on sale. A submitted payment
          that cannot be matched is rejected with a reason, and the tickets are released the same
          way. See the <Link href="/refund">refund policy</Link> for what happens to money that was
          sent.
        </p>

        <h2>5. Refunds and cancellations</h2>
        <p>
          Once tickets are issued they are non-refundable, except as set out in the{' '}
          <Link href="/refund">refund policy</Link> (a cancelled or postponed event, or money sent
          for an order that could not be completed). Refunds are made by bKash transfer outside the
          app. The organizer may cancel a ticket — for example a duplicate order — in which case the
          ticket is marked cancelled, will not be admitted, and is refunded as the policy describes.
        </p>

        <h2>6. The event itself</h2>
        <p>
          Dates, times, venues and line-ups can change. We will email every ticket holder about a
          material change and post it on the event page. The organizer may refuse admission or
          remove anyone whose behaviour endangers others, without refund. Venue rules apply.
        </p>

        <h2>7. Your details</h2>
        <p>
          We use your name, email, mobile number and bKash sender number only to run the event and
          your order. How that works is in the <Link href="/privacy">privacy policy</Link>.
        </p>

        <h2>8. Accounts</h2>
        <p>
          An account is optional. If you sign in with your email, you see the orders placed with
          that email. Keep the sign-in links we email you to yourself: anyone with the link can see
          those orders.
        </p>

        <h2>9. Liability</h2>
        <p>
          Our responsibility to you is limited to the price of the tickets you bought. We are not
          responsible for travel, accommodation or other costs if an event changes or is cancelled.
          Nothing here limits any right you have under the law of Bangladesh that cannot be limited.
        </p>

        <h2>10. Changes to these terms</h2>
        <p>
          The terms that apply to an order are the ones published when you registered. The date at
          the top of this page changes when the wording does.
        </p>
      </Prose>
      <ContactCard title="Questions about these terms?" />
    </StaticPage>
  );
}
