import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { localisedPath } from '@/i18n/locales';
import { plainDigits, toBanglaDigits } from '@/server/lib/digits';
import { eventsService } from '@/server/container';
import { ButtonLink } from '@/components/button-link';
import { EmptyState } from '@/components/empty-state';
import { siteUrl } from '@/lib/env.public';
import { DHAKA_TZ } from '@/lib/time';
import { formatInTimeZone } from 'date-fns-tz';
import { ArchiveGrid } from './archive-grid';

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations('archive'), getLocale()]);
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: { canonical: `${siteUrl()}${localisedPath('/archive', locale)}` },
  };
}

// Reads the database on every request: a show moves here the moment it starts.
export const dynamic = 'force-dynamic';

/** A6 — the archive. Proof the shows are real, even in a quiet month. */
export default async function ArchivePage() {
  const [events, t, locale] = await Promise.all([
    eventsService.getArchivePage(),
    getTranslations('archive'),
    getLocale(),
  ]);
  const years = new Set(events.map((e) => formatInTimeZone(e.event.startsAt, DHAKA_TZ, 'yyyy')));
  const since = [...years].sort()[0];

  return (
    <main className="flex flex-1 flex-col">
      {/* Title band, same family as the hero and the event page */}
      <section className="relative overflow-hidden bg-[#14120f] text-background">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_30%,#2a3a2e_0%,#14120f_60%)]"
        />
        <div className="relative mx-auto flex w-full max-w-360 flex-col gap-3 px-4 py-10 lg:gap-4 lg:px-16 lg:py-16">
          <p className="text-[11px] font-medium tracking-[0.14em] text-[#a8a29a] uppercase lg:text-xs">
            {t('eyebrow')}
          </p>
          <h1 className="font-heading text-[38px] leading-[1.02] font-extrabold tracking-[-0.025em] lg:text-[56px]">
            {t('title')}
          </h1>
          <p className="max-w-[520px] text-[15px] leading-relaxed text-[#c9c3b7] lg:text-[17px]">
            {events.length > 0
              ? t('lead', {
                  count: events.length,
                  n: plainDigits(events.length, locale),
                  since: locale === 'bn' && since ? toBanglaDigits(since) : (since ?? ''),
                })
              : t('leadEmpty')}
          </p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-360 px-4 py-8 lg:px-16 lg:py-16">
        {events.length > 0 ? (
          <ArchiveGrid events={events} />
        ) : (
          <EmptyState
            icon="↺"
            title={t('emptyTitle')}
            description={t('emptyBody')}
            action={
              <ButtonLink href={localisedPath('/', locale)} variant="secondary">
                {t('seeUpcoming')}
              </ButtonLink>
            }
          />
        )}
      </div>
    </main>
  );
}
