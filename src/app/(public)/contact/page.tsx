import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactChannels } from '@/components/public/help/contact';
import { CodeRef, HelpHeader, HelpMain } from '@/components/public/help/layout';
import { REPLY_PROMISE } from '@/content/site';
import { siteUrl } from '@/lib/env.public';
import { getSiteSettings } from '@/lib/settings';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach the organizer about an order, a ticket or an event.',
  alternates: { canonical: `${siteUrl()}/contact` },
};

const h2 = 'font-heading text-xl leading-[1.3] font-semibold tracking-[-0.01em] lg:text-2xl';

/**
 * A7.6 (Canvas 5) — the channels are the page: one card per channel set in
 * the site settings (B14), a dashed "being set up" box when none is. Then
 * the answers that save a message, and what to put in one.
 */
export default async function ContactPage() {
  const settings = await getSiteSettings();
  const checkFirst = [
    {
      q: 'Waiting for tickets?',
      a: (
        <>
          Payments are checked {settings.verificationPromise}. Your order page updates itself — no
          need to ask.
        </>
      ),
    },
    {
      q: 'Lost the order page?',
      a: (
        <>
          <Link href="/orders/find">Find my order</Link> with your reference and mobile number, or{' '}
          <Link href="/account/sign-in">sign in with your email</Link>.
        </>
      ),
    },
    {
      q: 'Mistyped the TrxID?',
      a: (
        <>
          Correct it on the order page while it still says Checking payment — see{' '}
          <Link href="/faq#wrong-trxid">the FAQ</Link>.
        </>
      ),
    },
    {
      q: 'Want a refund?',
      a: (
        <>
          Read the <Link href="/refund">refund policy</Link> first; it says when money comes back
          and how.
        </>
      ),
    },
  ];
  return (
    <HelpMain>
      <HelpHeader
        eyebrow="Contact"
        title="Message the organizer"
        lead={`${settings.organizerName} runs everything and ${REPLY_PROMISE}.`}
      />
      <section aria-labelledby="ways" className="flex flex-col gap-4 pt-10">
        <h2 id="ways" className={h2}>
          Ways to reach us
        </h2>
        <ContactChannels settings={settings} />
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] items-start gap-x-8 gap-y-10 pt-12">
        <section aria-labelledby="check-first" className="flex flex-col gap-4">
          <h2 id="check-first" className={h2}>
            Check these first
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card [&_a]:text-accent-ink [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-foreground">
            {checkFirst.map((c) => (
              <li key={c.q} className="flex flex-col gap-1 px-5 py-4">
                <span className="text-base font-semibold">{c.q}</span>
                <span className="text-base leading-[1.6]">{c.a}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="include" className="flex flex-col gap-4">
          <h2 id="include" className={h2}>
            What to include
          </h2>
          <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
              <span className="text-base leading-normal">Your order reference</span>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                e.g. <CodeRef>EA-7K2Q9M</CodeRef>
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
              <span className="text-base leading-normal">
                The ticket code, for a question about one ticket
              </span>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                e.g. <CodeRef>TKT-4H8ZP2XQ</CodeRef>
              </span>
            </div>
            <p className="px-5 py-4 text-base leading-[1.6]">
              For payment questions, the bKash transaction ID and a screenshot of the receipt.
            </p>
          </div>
          <p className="text-base leading-[1.6] text-muted-foreground">
            That is enough to sort out almost everything in one reply.
          </p>
        </section>
      </div>
    </HelpMain>
  );
}
