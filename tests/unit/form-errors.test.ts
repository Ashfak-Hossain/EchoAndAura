import { createTranslator } from 'use-intl/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formErrorText } from '@/lib/form-error-text';
import {
  fieldErrorsOf,
  firstFormError,
  formErrorOf,
  isFormErrorCode,
} from '@/lib/validation/form-errors';
import bn from '@/messages/bn';
import en from '@/messages/en';

/** L3: server actions return codes from the catalogue, never sentences. */
const issues = (schema: z.ZodType, input: unknown) => {
  const r = schema.safeParse(input);
  if (r.success) throw new Error('expected a failure');
  return r.error;
};

describe('formErrorOf', () => {
  it('passes a catalogue code through', () => {
    const err = issues(z.string({ error: 'phone' }), 7);
    expect(formErrorOf(err.issues[0]!)).toEqual({ code: 'phone' });
  });

  it("turns Zod's own English into `invalid`, so no library sentence reaches a page", () => {
    const err = issues(z.string(), 7);
    expect(err.issues[0]?.message).toMatch(/expected string/i);
    expect(formErrorOf(err.issues[0]!)).toEqual({ code: 'invalid' });
    expect(formErrorOf({ ...err.issues[0]!, message: 'not a key' })).toEqual({ code: 'invalid' });
  });

  it('carries the numbers a sentence needs: custom params, and min/max bounds', () => {
    const custom = issues(
      z.string().superRefine((v, ctx) =>
        ctx.addIssue({
          code: 'custom',
          message: 'trxIdLength',
          params: { length: 10, entered: v.length, note: 'dropped: not a number' },
        }),
      ),
      'abc',
    );
    expect(formErrorOf(custom.issues[0]!)).toEqual({
      code: 'trxIdLength',
      values: { length: 10, entered: 3 },
    });
    const bounds = z.number().min(1, { error: 'quantityMin' }).max(10, { error: 'quantityMax' });
    expect(formErrorOf(issues(bounds, 0).issues[0]!)).toEqual({
      code: 'quantityMin',
      values: { min: 1 },
    });
    expect(formErrorOf(issues(bounds, 11).issues[0]!)).toEqual({
      code: 'quantityMax',
      values: { max: 10 },
    });
  });
});

describe('fieldErrorsOf / firstFormError', () => {
  const schema = z.object({
    a: z.string({ error: 'email' }).min(3, { error: 'emailRequired' }),
    names: z.array(z.string().min(2, { error: 'attendeeName' })),
  });

  it('keeps the first error per field, keyed by its path', () => {
    const err = issues(schema, { a: 'x', names: ['ok', 'y'] });
    expect(fieldErrorsOf(err)).toEqual({
      a: { code: 'emailRequired', values: { min: 3 } },
      'names.1': { code: 'attendeeName', values: { min: 2 } },
    });
    expect(firstFormError(err)).toEqual({ code: 'emailRequired', values: { min: 3 } });
  });

  it('an error with no issues is still a code', () => {
    expect(firstFormError(new z.ZodError([]))).toEqual({ code: 'invalid' });
  });
});

describe('isFormErrorCode', () => {
  it('knows exactly the catalogue keys', () => {
    expect(isFormErrorCode('phone')).toBe(true);
    expect(isFormErrorCode('toString')).toBe(false);
    expect(isFormErrorCode('A bKash number is 10 digits after +880.')).toBe(false);
    expect(isFormErrorCode(undefined)).toBe(false);
  });
});

describe('formErrorText', () => {
  const t = (locale: 'en' | 'bn') =>
    createTranslator({
      locale,
      messages: locale === 'bn' ? bn : en,
      namespace: 'formErrors',
      timeZone: 'Asia/Dhaka',
    });
  const err = { code: 'trxIdLength', values: { length: 10, entered: 8 } } as const;

  it('words a code in English as the design did', () => {
    expect(formErrorText(t('en'), err, 'en')).toBe(
      'A TrxID is exactly 10 letters and numbers — you have entered 8.',
    );
  });

  it('writes its numbers in Bangla digits on /bn, by hand rather than ICU', () => {
    expect(formErrorText(t('bn'), err, 'bn')).toBe(
      'TrxID ঠিক ১০টি অক্ষর ও সংখ্যা — আপনি লিখেছেন ৮টি।',
    );
  });

  it('keeps what people type elsewhere in Latin: +880 and the reference shape', () => {
    expect(formErrorText(t('bn'), { code: 'phone' }, 'bn')).toContain('+880');
    expect(formErrorText(t('bn'), { code: 'reference' }, 'bn')).toContain('EA-7K3M9Q');
  });
});
