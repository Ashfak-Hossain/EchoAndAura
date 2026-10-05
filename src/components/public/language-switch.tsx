'use client';

import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { setLanguageAction } from '@/app/(public)/language/actions';
import { LOCALES, localeFromPath } from '@/i18n/locales';
import { cn } from '@/lib/utils';

/**
 * ADR-061: `English | বাংলা` — the one way into the other language (no
 * guessing from the browser). Keeps the visitor on the same page. Posts
 * the page's English path: the server and the browser see the same value,
 * whether the address bar says `/events` or `/bn/events`.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations('language');
  const path = localeFromPath(usePathname()).path;
  return (
    <form action={setLanguageAction} className={cn('flex items-center gap-1', className)}>
      <input type="hidden" name="path" value={path} />
      <span className="sr-only">{t('label')}</span>
      {LOCALES.map((l, i) => (
        <span key={l} className="flex items-center gap-1">
          {i > 0 ? <span aria-hidden="true">|</span> : null}
          <button
            type="submit"
            name="locale"
            value={l}
            lang={l}
            aria-current={l === locale ? 'true' : undefined}
            disabled={l === locale}
            className="min-h-11 px-1.5 underline-offset-4 hover:underline disabled:font-bold disabled:no-underline"
          >
            {t(l)}
          </button>
        </span>
      ))}
    </form>
  );
}
