import type { Metadata } from 'next';
import Link from 'next/link';
import { FaqAccordion } from '@/components/public/faq-accordion';
import { TocSpy } from '@/components/public/help/client';
import { ContactCard } from '@/components/public/help/contact';
import { HelpHeader, HelpMain, overline } from '@/components/public/help/layout';
import { FAQ_TOPICS, faqItems } from '@/content/faq';
import { HELP_PAGES } from '@/content/policies';
import { siteUrl } from '@/lib/env.public';
import { getSiteSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'FAQ',
  description: HELP_PAGES.faq.description,
  alternates: { canonical: `${siteUrl()}/faq` },
};

/**
 * A7.4 (Canvas 5) — questions grouped by topic; topics are jump links
 * (a sticky list on desktop, chips on phones), never filters. One answer
 * open at a time across the page; `/faq#<id>` opens its answer.
 */
export default async function FaqPage() {
  const settings = await getSiteSettings();
  const items = faqItems(settings.verificationPromise);
  const topics = FAQ_TOPICS.map((t) => ({
    ...t,
    items: items.filter((i) => i.topic === t.id),
  }));
  return (
    <HelpMain>
      <HelpHeader
        eyebrow="Help & policies"
        title="Questions people ask"
        lead={metadata.description}
      />
      <div className="grid items-start pt-6 lg:grid-cols-[240px_minmax(0,680px)] lg:gap-x-16 lg:pt-10">
        <aside className="top-24 hidden flex-col gap-3 lg:flex [@media(min-height:44rem)]:sticky">
          <p className={cn(overline, 'text-muted-foreground')}>Topics</p>
          <nav aria-label="FAQ topics" data-toc="">
            <ul className="border-l border-border">
              {topics.map((t, i) => (
                <li key={t.id} className="-ml-px">
                  <a
                    href={`#${t.id}`}
                    aria-current={i === 0 ? 'true' : 'false'}
                    className="flex min-h-10 items-center justify-between gap-3 rounded-r-sm border-l-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground aria-current:border-foreground aria-current:font-semibold aria-current:text-foreground"
                  >
                    <span>{t.label}</span>
                    <span className="font-normal text-muted-foreground tabular">
                      {t.items.length}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col gap-10">
          <nav aria-label="FAQ topics" className="flex flex-wrap gap-2 lg:hidden">
            {topics.map((t) => (
              <a
                key={t.id}
                href={`#${t.id}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-border-strong bg-card px-3 text-sm font-medium text-foreground hover:bg-secondary"
              >
                {t.label}
                <span className="text-muted-foreground tabular">{t.items.length}</span>
              </a>
            ))}
          </nav>

          {topics.map((t) => (
            <section
              key={t.id}
              id={t.id}
              aria-labelledby={`${t.id}-title`}
              className="flex scroll-mt-24 flex-col gap-4"
            >
              <h2
                id={`${t.id}-title`}
                className="font-heading text-xl leading-[1.3] font-semibold tracking-[-0.01em] lg:text-2xl"
              >
                {t.label}
              </h2>
              <FaqAccordion
                items={t.items}
                openFromHash={t.id === topics[0]?.id}
                footer={
                  t.id === 'changes-and-refunds' ? (
                    <Link
                      href="/refund"
                      className="flex min-h-11 items-center justify-between gap-4 rounded-xl bg-secondary px-5 py-4 text-base text-foreground hover:bg-border"
                    >
                      <span>
                        Refunds, cancelled and postponed events are covered in the refund policy.
                      </span>
                      <span className="shrink-0 font-semibold text-accent-ink">
                        Refund policy <span aria-hidden>→</span>
                      </span>
                    </Link>
                  ) : null
                }
              />
            </section>
          ))}

          <ContactCard title="Didn’t find it?" settings={settings} />
        </div>
      </div>
      <TocSpy ids={topics.map((t) => t.id)} />
    </HelpMain>
  );
}
