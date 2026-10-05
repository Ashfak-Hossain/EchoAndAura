import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SiteShell } from '@/components/public/site-shell';
import { LocaleProvider } from '@/i18n/locale-context';
import { publicLocales } from '@/i18n/locales';
import { FooterSponsors } from '@/components/public/sponsors/footer-sponsors';
import { getPublicSession } from '@/lib/session';
import { getSiteSettings } from '@/lib/settings';
import { SITE_NAME, ogLocale, siteUrl } from '@/lib/seo';
import { getPublicSponsors } from '@/lib/sponsors';
import { featuredCta, hasUpcomingShows } from './home/load';

/**
 * Defaults every public page inherits (ADR-042). Built per request, like
 * the pages: `metadataBase` turns the generated share image into an
 * absolute URL, and SITE_URL is a placeholder at build time. A page that
 * sets its own `openGraph` replaces this one whole, so pages without one
 * (About, FAQ, policies) share with these defaults and the generated image.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    metadataBase: new URL(siteUrl()),
    openGraph: { type: 'website', siteName: SITE_NAME, locale: ogLocale(locale) },
    twitter: { card: 'summary_large_image' },
  };
}

// Reading the session here makes every public page dynamic — they already
// are (events, orders and tickets are all live data). The featured event
// and the sponsors are the same cached reads the home page makes.
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const [locale, session, cta, hasUpcoming, settings, sponsors] = await Promise.all([
    getLocale(),
    getPublicSession(),
    featuredCta(),
    hasUpcomingShows(),
    getSiteSettings(),
    getPublicSponsors(),
  ]);
  // ADR-061: the page's language for links, and the text for client components.
  return (
    <NextIntlClientProvider>
      <LocaleProvider locale={locale}>
        <SiteShell
          session={session?.role === 'buyer' ? session : null}
          cta={cta}
          hasUpcoming={hasUpcoming}
          settings={settings}
          sponsorRow={<FooterSponsors sponsors={sponsors} />}
          bangla={publicLocales(process.env.PUBLIC_LOCALES).includes('bn')}
        >
          {children}
        </SiteShell>
      </LocaleProvider>
    </NextIntlClientProvider>
  );
}
