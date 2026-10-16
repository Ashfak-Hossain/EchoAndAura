import type { Metadata } from 'next';
import { PolicyPage } from '@/components/public/help/policy-page';
import { HELP_PAGES } from '@/content/policies';
import { refund } from '@/content/policies/refund';
import { LAST_UPDATED } from '@/content/site';
import { siteUrl } from '@/lib/env.public';
import { getSiteSettings } from '@/lib/settings';

export const metadata: Metadata = {
  title: 'Refund policy',
  description: HELP_PAGES.refund.description,
  alternates: { canonical: `${siteUrl()}/refund` },
};

/** A7.3 (Canvas 5) — the content lives in src/content/policies/refund.tsx. */
export default async function RefundPolicyPage() {
  return (
    <PolicyPage
      doc={refund}
      lastUpdated={LAST_UPDATED.refund}
      host={new URL(siteUrl()).host}
      settings={await getSiteSettings()}
    />
  );
}
