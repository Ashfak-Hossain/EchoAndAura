import type { Locale } from '@/i18n/locales';
import type { Messages } from '@/messages/en';
import { plainDigits } from '@/server/lib/digits';

/**
 * L3: an error code from a server action, worded on the page. Kept apart
 * from `validation/form-errors.ts` so client components import the type and
 * this helper without the English catalogue.
 */
export type FormErrorCode = keyof Messages['formErrors'];

export interface FormError {
  code: FormErrorCode;
  /** Numbers the sentence names, e.g. `{ length: 10, entered: 8 }`. */
  values?: Record<string, number>;
}

/**
 * The sentence for an error. `t` translates within `formErrors` (next-intl's
 * `useTranslations`/`getTranslations`, or `createTranslator` in tests).
 * Numbers are written in the page's digits by hand, like every other
 * number on /bn (ADR-061), not by ICU.
 */
export function formErrorText(
  t: (code: FormErrorCode, values: Record<string, string>) => string,
  error: FormError,
  locale: Locale,
): string {
  const values: Record<string, string> = {};
  for (const [k, n] of Object.entries(error.values ?? {})) values[k] = plainDigits(n, locale);
  return t(error.code, values);
}
