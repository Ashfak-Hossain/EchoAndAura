import type { z } from 'zod';
import en from '@/messages/en';
import type { FormError, FormErrorCode } from '@/lib/form-error-text';

/**
 * L3 (LOCALISATION.md §4): server actions return error codes, never
 * sentences, and the page words them in the visitor's language. A schema's
 * message is a key of `formErrors` in the catalogue; a number the sentence
 * needs (a length, a limit) travels beside it.
 */

export type { FormError, FormErrorCode };

export function isFormErrorCode(value: unknown): value is FormErrorCode {
  return typeof value === 'string' && Object.hasOwn(en.formErrors, value);
}

type Issue = z.ZodError['issues'][number];

/**
 * One issue as a code. Zod's own messages (a type it didn't expect, say)
 * are not codes and become `invalid`, so no English sentence from a library
 * ever reaches a Bangla page.
 */
export function formErrorOf(issue: Issue): FormError {
  const code = isFormErrorCode(issue.message) ? issue.message : 'invalid';
  const values: Record<string, number> = {};
  if (issue.code === 'custom' && issue.params) {
    for (const [k, v] of Object.entries(issue.params)) if (typeof v === 'number') values[k] = v;
  }
  if (issue.code === 'too_small') values.min = Number(issue.minimum);
  if (issue.code === 'too_big') values.max = Number(issue.maximum);
  return Object.keys(values).length > 0 ? { code, values } : { code };
}

/** The first error per field, keyed by its path (`attendeeNames.1`). */
export function fieldErrorsOf(error: z.ZodError): Record<string, FormError> {
  const out: Record<string, FormError> = {};
  for (const issue of error.issues) out[issue.path.join('.')] ??= formErrorOf(issue);
  return out;
}

/** The first error of a one-field form. */
export function firstFormError(error: z.ZodError): FormError {
  const issue = error.issues[0];
  return issue ? formErrorOf(issue) : { code: 'invalid' };
}
