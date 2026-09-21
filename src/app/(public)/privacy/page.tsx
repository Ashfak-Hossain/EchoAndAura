import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactCard, Prose, StaticPage } from '@/components/public/static-page';
import { LAST_UPDATED } from '@/content/site';
import { siteUrl } from '@/lib/env.public';
import { getSiteSettings } from '@/lib/settings';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What we collect when you buy a ticket, why, and who sees it.',
  alternates: { canonical: `${siteUrl()}/privacy` },
};

/** A7 — written to be true of this codebase; update it when the data model changes. */
export default async function PrivacyPage() {
  const settings = await getSiteSettings();
  return (
    <StaticPage eyebrow="Privacy" title="Privacy policy" lastUpdated={LAST_UPDATED.privacy}>
      <Prose>
        <p>
          This site is run by a single organizer to sell tickets to their own events. It collects
          the minimum needed to do that and nothing for advertising.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>When you register:</strong> your name, email address and mobile number, the
            tickets you chose, and the order reference.
          </li>
          <li>
            <strong>When you pay:</strong> the bKash transaction ID and the mobile number you sent
            the money from. We never see your bKash PIN or balance.
          </li>
          <li>
            <strong>On tickets:</strong> the attendee name on each ticket, and any name changes,
            with the time they were made.
          </li>
          <li>
            <strong>If you sign in:</strong> your email address and a session cookie. There is no
            password.
          </li>
        </ul>

        <h2>Why</h2>
        <p>
          To hold and issue your tickets, to match your payment against the bKash statement, to
          email you your order page and tickets, to print the door list, and to reach you if the
          event changes. Your mobile number is also how{' '}
          <Link href="/orders/find">Find my order</Link> proves an order is yours.
        </p>

        <h2>Who sees it</h2>
        <p>
          The organizer, when checking payments, answering your messages and running the door. Door
          staff see the printed list: names and ticket codes only. Nobody else, and nothing is sold
          or shared for marketing.
        </p>

        <h2>Where it lives</h2>
        <p>
          Order and ticket data is stored in our own database. Emails are sent through Amazon Web
          Services, which handles your email address for that purpose only. Event cover images are
          stored on Cloudflare. Nothing about you is sent to analytics or advertising services.
        </p>

        <h2>Cookies</h2>
        <p>
          One cookie, and only if you sign in: it keeps you signed in. There are no tracking or
          advertising cookies.
        </p>

        <h2>Emails</h2>
        <p>
          You receive emails about your order only: payment instructions, your tickets, a rejection
          if a payment could not be matched, and sign-in links you asked for. There is no
          newsletter.
        </p>

        <h2>How long we keep it</h2>
        <p>
          Order records are kept after the event so that questions about payments can be answered
          and the accounts reconciled. Ask, and we will delete the personal details on an order once
          the event has passed and no payment question is open.
        </p>

        <h2>Your rights</h2>
        <p>
          Ask us what we hold about you, to correct it, or to delete it, using the contact details
          below. Quote your order reference if you have one.
        </p>
      </Prose>
      <ContactCard title="Questions about your data?" settings={settings} />
    </StaticPage>
  );
}
