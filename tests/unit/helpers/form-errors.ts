import { createTranslator } from 'use-intl/core';
import type { z } from 'zod';
import type { Locale } from '@/i18n/locales';
import { formErrorText } from '@/lib/form-error-text';
import { formErrorOf } from '@/lib/validation/form-errors';
import bn from '@/messages/bn';
import en from '@/messages/en';

/**
 * L3: schemas return catalogue codes. Tests word them through the real
 * catalogue, so the English assertions still pin the design's wording.
 */
export function worded(issue: z.ZodError['issues'][number] | undefined, locale: Locale = 'en') {
  if (!issue) return undefined;
  const t = createTranslator({
    locale,
    messages: locale === 'bn' ? bn : en,
    namespace: 'formErrors',
    timeZone: 'Asia/Dhaka',
  });
  return formErrorText(t, formErrorOf(issue), locale);
}
