import type { Metadata } from 'next';
import { FaqAccordion } from '@/components/public/faq-accordion';
import { ContactCard, StaticPage } from '@/components/public/static-page';
import { FAQ_ITEMS } from '@/content/faq';
import { siteUrl } from '@/lib/env.public';

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'How tickets, bKash payment and verification work at echoandaura.',
  alternates: { canonical: `${siteUrl()}/faq` },
};

export default function FaqPage() {
  return (
    <StaticPage eyebrow="FAQ" title="Questions people ask" wide>
      <FaqAccordion items={FAQ_ITEMS} />
      <ContactCard />
    </StaticPage>
  );
}
