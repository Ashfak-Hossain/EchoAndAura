import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactCard, Prose, StaticPage } from '@/components/public/static-page';
import { REPLY_PROMISE } from '@/content/site';
import { siteUrl } from '@/lib/env.public';
import { getSiteSettings } from '@/lib/settings';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach the organizer about an order, a ticket or an event.',
  alternates: { canonical: `${siteUrl()}/contact` },
};

/**
 * A7 — the contact card is the page. Channels come from the environment;
 * when none is configured yet the page says so instead of showing a blank.
 */
export default async function ContactPage() {
  const settings = await getSiteSettings();
  const configured = Boolean(
    settings.supportEmail || settings.supportPhone || settings.facebookPageUrl,
  );
  return (
    <StaticPage
      eyebrow="Contact"
      title="Message the organizer"
      lead={`${settings.organizerName} runs everything and ${REPLY_PROMISE}.`}
    >
      {configured ? (
        <ContactCard title="Ways to reach us" settings={settings} />
      ) : (
        <p className="rounded-xl border border-dashed border-border-strong p-5 text-sm text-muted-foreground">
          Contact details are being set up. For now, reply to any email you have received from us.
        </p>
      )}
      <Prose>
        <h2>Before you write</h2>
        <ul>
          <li>
            <strong>Waiting for tickets?</strong> Payments are checked{' '}
            {settings.verificationPromise}. Your order page updates itself — no need to ask.
          </li>
          <li>
            <strong>Lost the order page?</strong> <Link href="/orders/find">Find my order</Link>{' '}
            with your reference and mobile number, or{' '}
            <Link href="/account/sign-in">sign in with your email</Link>.
          </li>
          <li>
            <strong>Mistyped the TrxID?</strong> Correct it on the order page while it still says
            Checking payment — see <Link href="/faq#wrong-trxid">the FAQ</Link>.
          </li>
          <li>
            <strong>Want a refund?</strong> Read the <Link href="/refund">refund policy</Link>{' '}
            first; it says when money comes back and how.
          </li>
        </ul>
        <h2>What to include</h2>
        <p>
          Your order reference (it looks like <strong>EA-7K3M9Q</strong>), and for payment questions
          the bKash transaction ID and a screenshot of the receipt. That is enough to sort out
          almost everything in one reply.
        </p>
      </Prose>
    </StaticPage>
  );
}
