import { useLocale, useTranslations } from 'next-intl';
import { localisedPath } from '@/i18n/locales';
import { ButtonLink } from '@/components/button-link';

// A8 404. The 500/error frame with a reference code is a later slice.
export default function PublicNotFound() {
  const t = useTranslations('errors');
  const locale = useLocale();
  return (
    <main className="mx-auto flex w-full max-w-160 flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase">404</p>
      <h1 className="text-3xl">{t('notFoundTitle')}</h1>
      <p className="max-w-md text-[15px] text-muted-foreground">{t('notFoundBody')}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <ButtonLink href={localisedPath('/', locale)} variant="secondary">
          {t('seeUpcoming')}
        </ButtonLink>
        <ButtonLink href={localisedPath('/orders/find', locale)} variant="ghost">
          {t('findOrder')}
        </ButtonLink>
      </div>
    </main>
  );
}
