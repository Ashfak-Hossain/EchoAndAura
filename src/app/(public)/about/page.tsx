import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactCard, Prose, StaticPage } from '@/components/public/static-page';
import { LAST_UPDATED } from '@/content/site';
import { siteUrl } from '@/lib/env.public';
import { getSiteSettings } from '@/lib/settings';

export const metadata: Metadata = {
  title: 'About',
  description: 'Who puts on echoandaura shows, and how the tickets work.',
  alternates: { canonical: `${siteUrl()}/about` },
};

/** A7 — same voice as the home page's dormant state: small rooms, real sound. */
export default async function AboutPage() {
  const settings = await getSiteSettings();
  return (
    <StaticPage
      eyebrow="About"
      title="Small rooms, real sound."
      lead="echoandaura puts on a handful of live shows a year in Dhaka and Chattogram."
      lastUpdated={LAST_UPDATED.about}
    >
      <Prose>
        <p>
          The shows are small on purpose: rooms where the sound is right and the act is close, four
          acts a night, one night at a time. Everything is run by one person —{' '}
          {settings.organizerName} books the room, picks the line-up, checks every payment and is at
          the door when you arrive.
        </p>

        <h2>How tickets work here</h2>
        <ul>
          <li>
            <strong>Named tickets.</strong> Every ticket carries a name and a code. The door works
            from a printed list — no app, no scanner, nothing to install.
          </li>
          <li>
            <strong>Paid by bKash.</strong> You send the money from your own bKash and paste the
            transaction ID. No card, no fees on top of the ticket price.
          </li>
          <li>
            <strong>Checked by a person.</strong> Each payment is matched against the bKash
            statement — {settings.verificationPromise} — and only then are tickets emailed. It is
            slower than a card gateway and a great deal cheaper, which is what keeps the rooms small
            and the prices where they are.
          </li>
        </ul>

        <h2>Where to follow</h2>
        <p>
          New events go up on Facebook first and on the <Link href="/">home page</Link> at the same
          time. Tickets go on sale twenty days before a show and close five days before it, so the
          door list can be printed.
        </p>

        <h2>The fine print</h2>
        <p>
          The <Link href="/terms">terms of sale</Link>, the{' '}
          <Link href="/refund">refund policy</Link> and the{' '}
          <Link href="/privacy">privacy policy</Link> are each a page long. The{' '}
          <Link href="/faq">FAQ</Link> answers the questions people actually ask.
        </p>
      </Prose>
      <ContactCard title="Say hello" settings={settings} />
    </StaticPage>
  );
}
