import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SiteSettings } from '@/server/services/settings.service';
import { BrandMark } from './brand-mark';
import { MobileNav, type NavLink } from './mobile-nav';

/**
 * Public site chrome (canvas 2, redesign 2026-09-21). Header: 72px on
 * desktop with the wordmark, the four site links, Sign in / My orders and
 * a marigold "Get tickets" that points at the live event when one is on
 * sale (omitted otherwise — the hero explains why). Under `lg` the links
 * move into a sheet. Footer: charcoal, four columns, one line of trust.
 */
const NAV: NavLink[] = [
  { href: '/', label: 'Events' },
  { href: '/archive', label: 'Past events' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact' },
];

const FOOTER = {
  tickets: [
    { href: '/', label: 'Upcoming events' },
    { href: '/archive', label: 'Past events' },
    { href: '/orders/find', label: 'Find my order' },
    { href: '/account/sign-in', label: 'Sign in' },
  ],
  about: [
    { href: '/about', label: 'About' },
    { href: '/faq', label: 'FAQ' },
    { href: '/contact', label: 'Contact' },
  ],
  help: [
    { href: '/terms', label: 'Terms of sale' },
    { href: '/refund', label: 'Refund policy' },
    { href: '/privacy', label: 'Privacy' },
  ],
} as const;

export function SiteShell({
  children,
  session,
  cta,
  settings,
}: {
  children: ReactNode;
  /** Buyer session, when signed in; the admin never uses the public chrome. */
  session?: { email: string } | null;
  /** The live event's slug when registration is open; drives the header button. */
  cta?: { slug: string } | null;
  /** Footer links: Facebook page and support email (B14 settings). */
  settings: Pick<SiteSettings, 'facebookPageUrl' | 'supportEmail'>;
}) {
  const facebook = settings.facebookPageUrl;
  const contactEmail = settings.supportEmail;
  const accountLink = session
    ? { href: '/account', label: 'My orders' }
    : { href: '/account/sign-in', label: 'Sign in' };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur print:hidden">
        <div className="mx-auto flex h-15 max-w-360 items-center justify-between px-4 lg:h-18 lg:px-16">
          <Link
            href="/"
            className="flex items-center gap-2.5 font-heading text-[19px] font-bold tracking-[-0.02em] lg:text-[22px]"
          >
            <BrandMark />
            echoandaura
          </Link>

          <nav aria-label="Site" className="hidden items-center gap-8 text-[15px] lg:flex">
            {NAV.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-accent-ink">
                {l.label}
              </Link>
            ))}
            <Link href={accountLink.href} className="text-muted-foreground hover:text-accent-ink">
              {accountLink.label}
            </Link>
            {cta ? (
              <Link
                href={`/events/${cta.slug}/register`}
                className="inline-flex h-11 items-center rounded-[10px] border border-foreground bg-marigold px-5 font-semibold hover:bg-[#e2962c]"
              >
                Get tickets
              </Link>
            ) : null}
          </nav>

          <div className="flex items-center gap-2 lg:hidden">
            {cta ? (
              <Link
                href={`/events/${cta.slug}/register`}
                className="inline-flex h-10 items-center rounded-[9px] border border-foreground bg-marigold px-3.5 text-sm font-semibold"
              >
                Get tickets
              </Link>
            ) : null}
            <MobileNav links={[...NAV, accountLink]} facebook={facebook} />
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col">{children}</div>

      <footer className="bg-foreground text-[#c9c3b7] print:hidden">
        <div className="mx-auto flex max-w-360 flex-col gap-8 px-4 pt-10 pb-6 lg:gap-10 lg:px-16 lg:pt-14 lg:pb-7">
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-[5fr_2fr_2fr_3fr] lg:gap-10">
            <div className="col-span-2 flex flex-col gap-4 lg:col-span-1">
              <span className="flex items-center gap-2.5 font-heading text-[20px] font-bold tracking-[-0.02em] text-background lg:text-[22px]">
                <BrandMark inverted />
                echoandaura
              </span>
              <p className="max-w-90 text-[15px] leading-relaxed">
                Small rooms, real sound. A handful of live shows a year in Dhaka and Chattogram, run
                by one person who is also at the door.
              </p>
              {facebook ? (
                <a
                  href={facebook}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-[15px] font-semibold text-background hover:underline"
                >
                  <svg
                    aria-hidden="true"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.4c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.3v2.2H7.4V14h2.8v8h3.3z" />
                  </svg>
                  Follow on Facebook
                </a>
              ) : null}
            </div>

            <nav aria-label="Site pages" className="contents">
              <FooterColumn title="Tickets" links={FOOTER.tickets} />
              <FooterColumn title="About" links={FOOTER.about} />
              <div className="flex flex-col gap-3 text-[15px]">
                <FooterTitle>Help</FooterTitle>
                {FOOTER.help.map((l) => (
                  <Link key={l.href} href={l.href} className="text-[#e6e1d6] hover:text-background">
                    {l.label}
                  </Link>
                ))}
                {contactEmail ? (
                  <a
                    href={`mailto:${contactEmail}`}
                    className="text-[#e6e1d6] hover:text-background"
                  >
                    {contactEmail}
                  </a>
                ) : null}
              </div>
            </nav>
          </div>

          <div className="flex flex-col gap-2 border-t border-[#33302a] pt-5 text-[13px] text-[#a8a29a] sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} echoandaura · Dhaka, Bangladesh</span>
            <span>Payments by bKash · verified by a person · no refunds through the app</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterTitle({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-medium tracking-[0.14em] text-[#a8a29a] uppercase">
      {children}
    </span>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: readonly { href: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-3 text-[15px]">
      <FooterTitle>{title}</FooterTitle>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="text-[#e6e1d6] hover:text-background">
          {l.label}
        </Link>
      ))}
    </div>
  );
}
