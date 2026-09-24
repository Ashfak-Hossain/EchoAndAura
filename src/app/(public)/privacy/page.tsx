import type { Metadata } from 'next';
import { PolicyPage } from '@/components/public/help/policy-page';
import { HELP_PAGES } from '@/content/policies';
import { privacy } from '@/content/policies/privacy';
import { LAST_UPDATED } from '@/content/site';
import { siteUrl } from '@/lib/env.public';
import { getSiteSettings } from '@/lib/settings';

export const metadata: Metadata = {
  title: 'Privacy',
  description: HELP_PAGES.privacy.description,
  alternates: { canonical: `${siteUrl()}/privacy` },
};

/** A7.2 (Canvas 5) — the content lives in src/content/policies/privacy.tsx. */
export default async function PrivacyPage() {
  return (
    <PolicyPage
      doc={privacy}
      lastUpdated={LAST_UPDATED.privacy}
      host={new URL(siteUrl()).host}
      settings={await getSiteSettings()}
    />
  );
}
