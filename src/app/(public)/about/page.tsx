import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import { BrandMark } from '@/components/public/brand-mark';
import { ContactCard } from '@/components/public/help/contact';
import { overline } from '@/components/public/help/layout';
import { RelatedPolicies } from '@/components/public/help/policy-page';
import { siteUrl } from '@/lib/env.public';
import { getSiteSettings } from '@/lib/settings';
import { DHAKA_TZ } from '@/lib/time';
import { cn } from '@/lib/utils';
import { loadHome } from '../home/load';

export const metadata: Metadata = {
  title: 'About',
  description: 'Who puts on echoandaura shows, and how the tickets work.',
  alternates: { canonical: `${siteUrl()}/about` },
};

const STEPS = [
  {
    title: 'Register',
    body: 'Choose your tickets and give one name — yours. Every ticket carries a name and a code, and you can change the name until registration closes.',
  },
  {
    title: 'Pay by bKash',
    body: 'You send the money from your own bKash and paste the transaction ID. No card, no fees on top of the ticket price.',
  },
  {
    title: 'Get scanned at the door',
    body: 'The QR on your ticket is scanned at the door — nothing to install. Each ticket admits one person, once.',
  },
];

const wrap = 'mx-auto max-w-328';
const h2Label = cn(overline, 'text-muted-foreground');

/**
 * A7.5 (Canvas 5) — editorial: the statement, a wide band from a recent
 * show's cover, three steps, who runs it. No stats, logos or photos of
 * people. The band falls back to the brand mark when no event has a cover.
 */
export default async function AboutPage() {
  const [settings, home] = await Promise.all([getSiteSettings(), loadHome()]);
  const withCover = [home.featured, ...home.alsoUpcoming, ...home.past].find((e) => e?.coverUrl);
  return (
    <main id="top" className="help-page flex-1 scroll-mt-24 pb-16">
      <section className="px-4 pt-8 pb-12 lg:px-16 lg:pt-16">
        <div className={cn(wrap, 'flex flex-col gap-5')}>
          <p className={h2Label}>About</p>
          <h1 className="max-w-220 font-heading text-4xl leading-[1.05] font-bold tracking-tight text-balance lg:text-5xl">
            Small rooms, real sound.
          </h1>
          <p className="max-w-170 text-xl leading-[1.45] text-pretty lg:text-2xl">
            echoandaura puts on a handful of live shows a year in Dhaka and Chattogram.
          </p>
        </div>
      </section>

      <figure data-testid="about-cover">
        {withCover?.coverUrl ? (
          <Image
            src={withCover.coverUrl}
            alt={`Cover of ${withCover.event.title}`}
            width={1200}
            height={630}
            sizes="100vw"
            className="h-55 w-full border-y border-border object-cover lg:h-120"
          />
        ) : (
          <div
            role="img"
            aria-label="echoandaura"
            className="flex h-55 items-center justify-center border-y border-border bg-foreground lg:h-120"
          >
            <BrandMark inverted className="size-16" />
          </div>
        )}
        {withCover ? (
          <figcaption className="px-4 pt-3 lg:px-16">
            <div className={cn(wrap, 'text-sm text-muted-foreground')}>
              {withCover.event.title} ·{' '}
              {formatInTimeZone(withCover.event.startsAt, DHAKA_TZ, 'MMM yyyy')}
            </div>
          </figcaption>
        ) : null}
      </figure>

      <section aria-labelledby="how-it-works" className="px-4 pt-12 lg:px-16 lg:pt-16">
        <div className={cn(wrap, 'flex flex-col gap-8')}>
          <div className="flex flex-col gap-3">
            <p className={h2Label}>How it works</p>
            <h2
              id="how-it-works"
              className="font-heading text-2xl leading-[1.2] font-semibold tracking-[-0.01em] lg:text-3xl"
            >
              How tickets work here
            </h2>
          </div>
          <ol className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6"
              >
                <span
                  aria-hidden
                  className="flex size-10 items-center justify-center rounded-lg bg-foreground font-heading text-lg font-bold text-marigold"
                >
                  {i + 1}
                </span>
                <h3 className="font-heading text-xl leading-[1.3] font-semibold">{step.title}</h3>
                <p className="text-base leading-[1.6]">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="max-w-220 rounded-xl bg-secondary px-6 py-5">
            <p className="text-base leading-[1.65] text-pretty">
              <strong className="font-semibold">Checked by a person.</strong> Each payment is
              matched against the bKash statement — {settings.verificationPromise} — and only then
              are tickets emailed. It is slower than a card gateway and a great deal cheaper, which
              is what keeps the rooms small and the prices where they are.
            </p>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="who-runs-it"
        className="mt-12 border-y border-border bg-secondary px-4 py-12 lg:mt-16 lg:px-16 lg:py-16"
      >
        <div
          className={cn(wrap, 'grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]')}
        >
          <div className="flex flex-col gap-2">
            <h2 id="who-runs-it" className={h2Label}>
              Who runs it
            </h2>
            <p className="font-heading text-xl font-semibold">
              {settings.organizerName}, organizer
            </p>
          </div>
          <p className="max-w-190 text-xl leading-normal text-pretty lg:text-2xl">
            The shows are small on purpose: rooms where the sound is right and the act is close,
            four acts a night, one night at a time. Everything is run by one person —{' '}
            {settings.organizerName} books the room, picks the line-up, checks every payment and is
            at the door when you arrive.
          </p>
        </div>
      </section>

      <section aria-labelledby="follow" className="px-4 pt-12 lg:px-16 lg:pt-16">
        <div
          className={cn(wrap, 'grid gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]')}
        >
          <h2 id="follow" className={h2Label}>
            Where to follow
          </h2>
          <div className="flex max-w-170 flex-col gap-5">
            <p className="rich-text text-lg leading-[1.6] text-pretty">
              New events go up on Facebook first and on the <Link href="/">home page</Link> at the
              same time. Tickets go on sale twenty days before a show and close five days before it,
              so the door list can be printed.
            </p>
            <div className="flex flex-wrap gap-2">
              {settings.facebookPageUrl ? (
                <a
                  href={settings.facebookPageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center rounded-lg border border-foreground bg-foreground px-5 text-base font-semibold text-background hover:bg-[#33302a]"
                >
                  Follow on Facebook
                </a>
              ) : null}
              <Link
                href="/"
                className="inline-flex min-h-11 items-center rounded-lg border border-border-strong bg-card px-5 text-base font-semibold text-foreground hover:bg-secondary"
              >
                See upcoming events
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="fine-print" className="px-4 pt-12 lg:px-16 lg:pt-16">
        <div
          className={cn(
            wrap,
            'grid gap-x-8 gap-y-4 border-t border-border pt-12 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:pt-16',
          )}
        >
          <h2 id="fine-print" className={h2Label}>
            The fine print
          </h2>
          <div className="flex min-w-0 flex-col gap-5">
            <p className="max-w-170 text-lg leading-[1.6] text-pretty">
              The terms of sale, the refund policy and the privacy policy are each a page long. The
              FAQ answers the questions people actually ask.
            </p>
            <RelatedPolicies keys={['terms', 'refund', 'privacy', 'faq']} title={null} />
            <ContactCard title="Say hello" settings={settings} />
          </div>
        </div>
      </section>
    </main>
  );
}
