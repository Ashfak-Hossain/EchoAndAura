import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { type AccountLink, type FeaturedCta, accountLink } from '@/lib/public-nav';
import { DHAKA_TZ } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { SiteSettings } from '@/server/services/settings.service';
import { BrandMark } from './brand-mark';
import { PersonIcon } from './chrome-icons';
import { MobileMenu } from './mobile-menu';
import { HeaderFrame, SiteNavLinks } from './site-nav';

type FooterSettings = Pick<SiteSettings, 'facebookPageUrl' | 'supportEmail'>;

/**
 * Public site chrome (Canvas 6: N1–N4, N12). The header is charcoal on the
 * home page and light everywhere else; `HeaderFrame` sets the tone from the
 * path and the server-rendered parts follow it with `group-data-[tone=dark]:`.
 * `.site-chrome` scopes the ADR-031 focus ring (globals.css).
 */
export function SiteShell({
  children,
  session,
  cta,
  hasUpcoming = false,
  settings,
  sponsorRow,
}: {
  children: ReactNode;
  /** Buyer session, when signed in; the admin never uses the public chrome. */
  session?: { email: string } | null;
  /** The featured event while it is buyable; drives every "Get tickets". */
  cta?: FeaturedCta | null;
  /** Any upcoming show exists — the phone menu must not say "nothing is on sale" past it. */
  hasUpcoming?: boolean;
  /** Footer links and the phone menu's fallback: Facebook page and support email (B14). */
  settings: FooterSettings;
  /** The footer's "Supported by" row, rendered between the columns and the legal line. */
  sponsorRow?: ReactNode;
}) {
  const account = accountLink(Boolean(session));
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        cta={cta ?? null}
        hasUpcoming={hasUpcoming}
        account={account}
        facebook={settings.facebookPageUrl}
      />
      <div className="flex flex-1 flex-col">{children}</div>
      <SiteFooter account={account} settings={settings} sponsorRow={sponsorRow} />
    </div>
  );
}

/** N3: the one marigold action. Rendered only when the featured event is buyable, never disabled. */
const getTickets =
  'inline-flex h-11 items-center rounded-[8px] border border-foreground bg-marigold font-semibold text-foreground hover:bg-[#e2962c]';

/** N1: 72px (60 on phones), sticky, one row: brand · links · account · Get tickets. */
export function SiteHeader({
  cta,
  hasUpcoming = false,
  account,
  facebook,
}: {
  cta: FeaturedCta | null;
  hasUpcoming?: boolean;
  account: AccountLink;
  facebook: string | null;
}) {
  const register = cta ? `/events/${cta.slug}/register` : null;
  return (
    <HeaderFrame className="site-chrome group sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur data-[tone=dark]:border-[#33302a] data-[tone=dark]:bg-[#1c1a17] print:hidden">
      <div className="mx-auto flex h-15 max-w-360 items-center justify-between gap-4 px-4 lg:h-18 lg:px-16">
        <Link
          href="/"
          aria-label="echoandaura, home"
          className="flex min-h-11 items-center gap-2.5 font-heading text-[19px] font-bold tracking-[-0.02em] text-foreground group-data-[tone=dark]:text-[#fbfaf8] lg:text-[22px]"
        >
          {/* On charcoal the tile turns marigold with a charcoal glyph, as in the footer.
              CSS `stroke` beats the glyph's presentation attribute. */}
          <BrandMark className="group-data-[tone=dark]:bg-marigold group-data-[tone=dark]:[&_svg]:stroke-foreground" />
          echoandaura
        </Link>

        <nav aria-label="Site" className="hidden items-center gap-1 lg:flex">
          <SiteNavLinks />
          <span
            aria-hidden="true"
            className="mx-3 h-6 w-px bg-border group-data-[tone=dark]:bg-[#33302a]"
          />
          <Link
            href={account.href}
            className="inline-flex h-11 items-center gap-2 rounded-[8px] px-3 text-base text-muted-foreground group-data-[tone=dark]:text-[#c9c3b7] hover:bg-wash"
          >
            {account.signedIn ? <PersonIcon /> : null}
            {account.label}
          </Link>
          {register ? (
            <Link href={register} className={cn(getTickets, 'ml-2 px-5')}>
              Get tickets
            </Link>
          ) : null}
        </nav>

        <div className="flex items-center gap-1 lg:hidden">
          {register ? (
            <Link href={register} className={cn(getTickets, 'px-4 text-sm')}>
              Get tickets
            </Link>
          ) : null}
          <MobileMenu cta={cta} hasUpcoming={hasUpcoming} account={account} facebook={facebook} />
        </div>
      </div>
    </HeaderFrame>
  );
}

const footerLink =
  'flex min-h-11 items-center text-base text-[#e6e1d6] hover:text-[#fbfaf8] hover:underline';

/**
 * N12: charcoal band — brand, blurb and the trust line; three named link
 * groups; the sponsor row (when there is one); then © and the legal links.
 * Phones: the brand takes a full row above two columns.
 */
export function SiteFooter({
  account,
  settings,
  sponsorRow,
}: {
  account: AccountLink;
  settings: FooterSettings;
  sponsorRow?: ReactNode;
}) {
  const facebook = settings.facebookPageUrl;
  const supportEmail = settings.supportEmail;
  return (
    <footer className="site-chrome bg-foreground text-[#c9c3b7] print:hidden">
      <div className="mx-auto flex max-w-360 flex-col gap-8 px-4 pt-12 pb-6 lg:gap-10 lg:px-16 lg:pt-16">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,3fr)] lg:gap-x-10">
          <div className="col-span-2 flex flex-col gap-4 lg:col-span-1">
            <span className="flex items-center gap-2.5 font-heading text-[19px] font-bold tracking-[-0.02em] text-[#fbfaf8] lg:text-[22px]">
              <BrandMark inverted />
              echoandaura
            </span>
            <p className="max-w-90 text-base leading-[1.6]">
              Small rooms, real sound. A handful of live shows a year in Dhaka and Chattogram, run
              by one person who is also at the door.
            </p>
            <p className="text-sm text-[#a8a29a]">
              Payments by bKash · verified by a person · no refunds through the app
            </p>
          </div>

          <FooterNav title="Tickets">
            <Link href="/events" className={footerLink}>
              Upcoming events
            </Link>
            <Link href="/archive" className={footerLink}>
              Past events
            </Link>
            <Link href="/orders/find" className={footerLink}>
              Find my order
            </Link>
            <Link href={account.href} className={footerLink}>
              {account.label}
            </Link>
          </FooterNav>

          <FooterNav title="About">
            <Link href="/about" className={footerLink}>
              About
            </Link>
            <Link href="/contact" className={footerLink}>
              Contact
            </Link>
            {facebook ? (
              <a href={facebook} target="_blank" rel="noreferrer" className={footerLink}>
                Facebook<span aria-hidden="true">&nbsp;↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
          </FooterNav>

          {/* Alone on its row on phones: the full width keeps an email address unbroken. */}
          <FooterNav title="Help" className="col-span-2 lg:col-span-1">
            <Link href="/faq" className={footerLink}>
              FAQ
            </Link>
            <Link href="/refund" className={footerLink}>
              Refund policy
            </Link>
            {supportEmail ? (
              <a href={`mailto:${supportEmail}`} className={cn(footerLink, 'wrap-anywhere')}>
                {supportEmail}
              </a>
            ) : null}
          </FooterNav>
        </div>

        {sponsorRow}

        <div className="flex flex-col items-start justify-between gap-x-6 gap-y-2 border-t border-[#33302a] pt-5 text-sm text-[#a8a29a] lg:flex-row lg:items-center">
          <span>
            © {formatInTimeZone(new Date(), DHAKA_TZ, 'yyyy')} echoandaura · Dhaka, Bangladesh
          </span>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-1">
            <LegalLink href="/terms">Terms of sale</LegalLink>
            <LegalLink href="/privacy">Privacy policy</LegalLink>
            <LegalLink href="/refund">Refund policy</LegalLink>
          </nav>
        </div>
      </div>
    </footer>
  );
}

/**
 * One column: an `<h2>` overline that also names the landmark (so it is
 * announced once, not as both label and heading), then 44px link rows.
 */
function FooterNav({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  const id = `footer-${title.toLowerCase()}`;
  return (
    <nav aria-labelledby={id} className={cn('flex flex-col', className)}>
      {/* font-sans: the base layer sets every h2 in Archivo; this is an overline. */}
      <h2
        id={id}
        className="mb-2 font-sans text-xs font-medium tracking-[0.14em] text-[#a8a29a] uppercase"
      >
        {title}
      </h2>
      {children}
    </nav>
  );
}

function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center text-[#c9c3b7] hover:text-[#fbfaf8] hover:underline"
    >
      {children}
    </Link>
  );
}
