import { z } from 'zod';
import { ORDER_REFERENCE_PATTERN } from '@/server/lib/order-reference';
import { NAME_MAX, NAME_MIN } from '@/server/lib/attendee-name';
import { MAX_TICKETS_PER_ORDER, MIN_TICKETS_PER_ORDER } from '@/server/lib/order-rules';
import { normaliseDigits } from '@/server/lib/digits';
import { normalisePromoCode } from '@/server/lib/promo';
import type { FormErrorCode } from '@/lib/form-error-text';

/** A message key, checked against the catalogue at compile time. */
const code = (key: FormErrorCode): FormErrorCode => key;

/**
 * A3 registration form. The body carries the ticket type id and quantity —
 * never a price (Invariant 5). Every message is a code from `formErrors` in
 * the catalogue (L3): the page words it in the visitor's language, and the
 * English stays the design's own wording.
 */

export const BD_MOBILE_PREFIX = '+880';
/** Ten digits after +880, starting 13–19 (every BD mobile operator). */
const BD_MOBILE_PATTERN = /^1[3-9]\d{8}$/;

/**
 * A Bangladeshi mobile, entered as the ten digits after a fixed +880 prefix
 * and stored E.164. People type "01712…" or paste "+880 1712…"; the prefix
 * is fixed on the form, so those are stripped before the ten-digit check.
 * Bangla digits (a Bangla keyboard) count as digits (ADR-060).
 */
export const bdMobileWith = (error: string) =>
  z
    .string({ error })
    .transform((v) =>
      normaliseDigits(v)
        .replace(/[\s-]/g, '')
        .replace(/^(\+?880|0)/, ''),
    )
    .pipe(z.string().regex(BD_MOBILE_PATTERN, { error }))
    .transform((digits) => `${BD_MOBILE_PREFIX}${digits}`);

/** The public forms' number: its message is a catalogue code (L3). */
export const bdMobile = bdMobileWith(code('phone'));

/** A name field; `field` picks its two messages (`buyerName`, `buyerNameLong`). */
export const personName = (field: 'buyerName' | 'attendeeName' | 'guestName') =>
  z
    .string({ error: field })
    .trim()
    .min(NAME_MIN, { error: field })
    .max(NAME_MAX, { error: code(`${field}Long`) });

export const registrationFormSchema = z
  .object({
    ticketTypeId: z.uuid({ error: code('ticketType') }),
    quantity: z.preprocess(
      (v) => (typeof v === 'string' ? normaliseDigits(v) : v),
      z.coerce
        .number({ error: code('quantity') })
        .int({ error: code('quantity') })
        .min(MIN_TICKETS_PER_ORDER, { error: code('quantityMin') })
        .max(MAX_TICKETS_PER_ORDER, { error: code('quantityMax') }),
    ),
    buyerName: personName('buyerName'),
    buyerEmail: z
      .string({ error: code('email') })
      .trim()
      .toLowerCase()
      .pipe(z.email({ error: code('email') })),
    // Entered as the ten digits after a fixed +880 prefix; stored E.164.
    buyerPhone: bdMobile,
    // One name per order: every ticket starts with the buyer's name and can
    // be renamed on its own page. The array form stays for callers that do
    // pass names (must then be one per ticket).
    attendeeNames: z.array(personName('attendeeName')).optional(),
    terms: z.literal('on', { error: code('terms') }),
    // B10: the code as applied on the form (or typed and never applied). Only
    // the text crosses the wire — the service prices it (Invariant 5).
    promoCode: z
      .string()
      .optional()
      .transform((v) => (v ? normalisePromoCode(v) : ''))
      .pipe(z.string().max(24, { error: code('promoInvalid') }))
      .transform((v) => v || undefined),
  })
  .superRefine((v, ctx) => {
    if (v.attendeeNames && v.attendeeNames.length !== v.quantity) {
      ctx.addIssue({
        code: 'custom',
        path: ['attendeeNames'],
        message: code('attendeeName'),
      });
    }
  })
  .transform((v) => ({
    ...v,
    attendeeNames: v.attendeeNames ?? Array.from({ length: v.quantity }, () => v.buyerName),
  }));

export type RegistrationFormInput = z.infer<typeof registrationFormSchema>;

/** FormData → the plain object the schema expects (arrays from repeated keys). */
export function registrationFormValues(formData: FormData): Record<string, unknown> {
  const str = (key: string) => {
    const v = formData.get(key);
    return typeof v === 'string' ? v : undefined;
  };
  return {
    ticketTypeId: str('ticketTypeId'),
    quantity: str('quantity'),
    buyerName: str('buyerName'),
    buyerEmail: str('buyerEmail'),
    buyerPhone: str('buyerPhone'),
    attendeeNames: (() => {
      const names = formData
        .getAll('attendeeNames')
        .filter((v): v is string => typeof v === 'string');
      return names.length > 0 ? names : undefined;
    })(),
    terms: str('terms'),
    promoCode: str('promoCode'),
  };
}

/** bKash TrxIDs are ten letters and digits, e.g. 9AB12CD34E. Stored uppercase, trimmed (Invariant 3). */
export const TRX_ID_LENGTH = 10;
const TRX_ID_PATTERN = /^[A-Z0-9]{10}$/;

/** A4: the buyer reports a bKash payment. */
export const paymentFormSchema = z.object({
  trxId: z
    .string({ error: code('trxIdRequired') })
    .transform(normaliseDigits)
    .transform((v) => v.trim().toUpperCase())
    .transform((v) => v.replace(/\s+/g, ''))
    .superRefine((v, ctx) => {
      if (!TRX_ID_PATTERN.test(v)) {
        ctx.addIssue(
          v.length === 0
            ? { code: 'custom', message: code('trxIdRequired') }
            : {
                code: 'custom',
                message: code('trxIdLength'),
                params: { length: TRX_ID_LENGTH, entered: v.length },
              },
        );
      }
    }),
  senderPhone: bdMobile,
});

export type PaymentFormInput = z.infer<typeof paymentFormSchema>;

export function paymentFormValues(formData: FormData): Record<string, unknown> {
  const str = (key: string) => {
    const v = formData.get(key);
    return typeof v === 'string' ? v : undefined;
  };
  return { trxId: str('trxId'), senderPhone: str('senderPhone') };
}

/** "Find my order": the reference from the bKash field + the phone used at registration. */
export const findOrderSchema = z.object({
  reference: z
    .string({ error: code('referenceRequired') })
    .transform((v) => normaliseDigits(v).trim().toUpperCase())
    // Accept "EA-7K3M9Q", "EA7K3M9Q", "7K3M9Q" and any case; store form is EA-XXXXXX.
    .transform((v) => `EA-${v.replace(/^EA-?/, '')}`)
    .pipe(z.string().regex(ORDER_REFERENCE_PATTERN, { error: code('reference') })),
  phone: bdMobile,
});

/** Passwordless sign-in: just the email. */
export const signInSchema = z.object({
  email: z
    .string({ error: code('emailRequired') })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: code('email') })),
});
