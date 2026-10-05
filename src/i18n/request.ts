import { headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import bn from '@/messages/bn';
import en from '@/messages/en';
import { DEFAULT_LOCALE, LOCALE_HEADER, isLocale } from './locales';

/**
 * ADR-061: next-intl without its own routing. The proxy decides the
 * language from the URL and always sets the header (a visitor's own value
 * never gets through), so this only reads it.
 */
export default getRequestConfig(async () => {
  const value = (await headers()).get(LOCALE_HEADER);
  const locale = isLocale(value) ? value : DEFAULT_LOCALE;
  return { locale, messages: locale === 'bn' ? bn : en, timeZone: 'Asia/Dhaka' };
});
