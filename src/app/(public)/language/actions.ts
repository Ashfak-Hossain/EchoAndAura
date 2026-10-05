'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isEnglishOnly,
  localeFromPath,
  localisedPath,
  publicLocales,
} from '@/i18n/locales';
import { languageSwitchSchema } from '@/lib/validation/language';

/**
 * ADR-061: the language switch. Remembers the choice (the only place the
 * cookie is set — never on a page view, so cached pages stay
 * cookie-free, ADR-056) and opens the same page in that language.
 */
export async function setLanguageAction(formData: FormData): Promise<void> {
  const parsed = languageSwitchSchema.safeParse({
    locale: formData.get('locale'),
    path: formData.get('path'),
  });
  if (!parsed.success || !publicLocales(process.env.PUBLIC_LOCALES).includes(parsed.data.locale)) {
    redirect('/');
  }
  const { locale } = parsed.data;
  const { path } = localeFromPath(parsed.data.path);
  (await cookies()).set(LOCALE_COOKIE, locale, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  redirect(isEnglishOnly(path) ? '/' : localisedPath(path, locale));
}
