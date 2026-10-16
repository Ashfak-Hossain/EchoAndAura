import type { Metadata } from 'next';
import { PolicyPage } from '@/components/public/help/policy-page';
import { HELP_PAGES } from '@/content/policies';
import { terms } from '@/content/policies/terms';
import { LAST_UPDATED } from '@/content/site';
import { siteUrl } from '@/lib/env.public';
import { getSiteSettings } from '@/lib/settings';

export const metadata: Metadata = {
  title: 'Terms',
  description: HELP_PAGES.terms.description,
  alternates: { canonical: `${siteUrl()}/terms` },
};

/** A7.1 (Canvas 5) — the content lives in src/content/policies/terms.tsx. */
export default async function TermsPage() {
  return (
    <PolicyPage
      doc={terms}
      lastUpdated={LAST_UPDATED.terms}
      host={new URL(siteUrl()).host}
      settings={await getSiteSettings()}
    />
  );
}
