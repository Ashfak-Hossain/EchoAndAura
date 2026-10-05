import bn from '@/messages/bn';
import en, { type Messages } from '@/messages/en';
import type { Locale } from './locales';

/**
 * ADR-061: the text for a language, for pure code that builds sentences
 * (`createTranslator` from use-intl/core — no `next/*`, so `src/server/`
 * can use it too).
 */
export function catalogue(locale: Locale): Messages {
  return locale === 'bn' ? bn : en;
}
