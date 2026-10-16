import { useLocale, useTranslations } from 'next-intl';
import { createTranslator } from 'use-intl/core';
import { catalogue } from '@/i18n/catalogue';
import Link from '@/i18n/link';
import type { Locale } from '@/i18n/locales';
import { groupDigits } from '@/server/lib/digits';
import { MAX_TICKETS_PER_ORDER } from '@/server/lib/order-rules';
import { HOLD_MINUTES } from '@/content/site';
import { cn } from '@/lib/utils';
import { SectionHeading, homeColumn, homeSection, sectionLink } from './section-heading';

/**
 * The three steps, built from the rules they describe: the order cap
 * (order-rules), the hold (content/site) and the organizer's verification
 * promise (B14 settings), so the home page never states a different number
 * from the order page or the policies.
 */
export function howItWorksSteps(verificationPromise: string, locale: Locale = 'en') {
  const t = createTranslator({ locale, messages: catalogue(locale), namespace: 'home' });
  return [
    {
      title: t('stepRegister'),
      body: t('stepRegisterBody', {
        max: groupDigits(MAX_TICKETS_PER_ORDER, locale),
        minutes: groupDigits(HOLD_MINUTES, locale),
      }),
    },
    {
      title: t('stepPay'),
      body: t('stepPayBody', { promise: verificationPromise }),
    },
    { title: t('stepDoor'), body: t('stepDoorBody') },
  ];
}

/** N9 "How it works": three numbered cards (one column on phones), then the FAQ. */
export function HowItWorks({ verificationPromise }: { verificationPromise: string }) {
  const t = useTranslations('home');
  const locale = useLocale();
  return (
    <section aria-labelledby="how-heading" className={homeSection}>
      <div className={cn(homeColumn, 'flex flex-col gap-8')}>
        <div className="flex flex-col gap-2">
          <SectionHeading id="how-heading">{t('howTitle')}</SectionHeading>
          <p className="text-base text-muted-foreground lg:text-lg">{t('howLead')}</p>
        </div>
        {/* role="list": Safari drops list semantics once list-style is none. */}
        <ol role="list" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {howItWorksSteps(verificationPromise, locale).map((step, i) => (
            <li
              key={step.title}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6"
            >
              {/* The disc is for the eye; the heading carries "Step N" for a
                  screen reader, whatever the browser does with list numbering. */}
              <span
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-full bg-foreground font-heading text-base font-semibold text-background"
              >
                {groupDigits(i + 1, locale)}
              </span>
              <h3 className="text-xl leading-[1.25] font-semibold">
                <span className="sr-only">{t('step', { n: groupDigits(i + 1, locale) })}</span>
                {step.title}
              </h3>
              <p className="text-base leading-[1.6] text-pretty text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
        <Link href="/faq" className={cn(sectionLink, 'self-start')}>
          {t('faqLink')}
        </Link>
      </div>
    </section>
  );
}
