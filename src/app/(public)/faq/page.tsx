import type { Metadata } from 'next';
import { FaqAccordion } from '@/components/public/faq-accordion';
import { ContactCard, StaticPage } from '@/components/public/static-page';
import { faqItems } from '@/content/faq';
import { siteUrl } from '@/lib/env.public';
import { getSiteSettings } from '@/lib/settings';

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'How tickets, bKash payment and verification work at echoandaura.',
  alternates: { canonical: `${siteUrl()}/faq` },
};

export default async function FaqPage() {
  const settings = await getSiteSettings();
  return (
    <StaticPage eyebrow="FAQ" title="Questions people ask" wide>
      <FaqAccordion items={faqItems(settings.verificationPromise)} />
      <ContactCard settings={settings} />
    </StaticPage>
  );
}
