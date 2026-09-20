import { z } from 'zod';
import { ORDER_REFERENCE_PATTERN } from '@/server/lib/order-reference';
import { NAME_MAX, NAME_MIN } from '@/server/lib/attendee-name';
import { MAX_TICKETS_PER_ORDER, MIN_TICKETS_PER_ORDER } from '@/server/lib/order-rules';

/**
 * A3 registration form. The body carries the ticket type id and quantity —
 * never a price (Invariant 5). Messages are the design's own wording so the
 * inline errors read the same as the mock-ups.
 */

export const BD_MOBILE_PREFIX = '+880';
/** Ten digits after +880, starting 13–19 (every BD mobile operator). */
const BD_MOBILE_PATTERN = /^1[3-9]\d{8}$/;

/**
 * A Bangladeshi mobile, entered as the ten digits after a fixed +880 prefix
 * and stored E.164. People type "01712…" or paste "+880 1712…"; the prefix
 * is fixed on the form, so those are stripped before the ten-digit check.
 */
const bdMobile = z
  .string({ error: 'A bKash number is 10 digits after +880.' })
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+?880|0)/, ''))
  .pipe(z.string().regex(BD_MOBILE_PATTERN, { error: 'A bKash number is 10 digits after +880.' }))
  .transform((digits) => `${BD_MOBILE_PREFIX}${digits}`);

export const personName = (label: string) =>
  z
    .string({ error: `Enter ${label}.` })
    .trim()
    .min(NAME_MIN, { error: `Enter ${label}.` })
    .max(NAME_MAX, { error: `${label.charAt(0).toUpperCase()}${label.slice(1)} is too long.` });

export const registrationFormSchema = z
  .object({
    ticketTypeId: z.uuid({ error: 'Choose a ticket type.' }),
    quantity: z.coerce
      .number({ error: 'Choose how many tickets.' })
      .int({ error: 'Choose how many tickets.' })
      .min(MIN_TICKETS_PER_ORDER, { error: `At least ${MIN_TICKETS_PER_ORDER} ticket.` })
      .max(MAX_TICKETS_PER_ORDER, { error: `Max ${MAX_TICKETS_PER_ORDER} per order.` }),
    buyerName: personName('your full name'),
    buyerEmail: z
      .string({ error: 'Enter a complete email address.' })
      .trim()
      .toLowerCase()
      .pipe(z.email({ error: 'Enter a complete email address.' })),
    // Entered as the ten digits after a fixed +880 prefix; stored E.164.
    buyerPhone: bdMobile,
    // One name per order: every ticket starts with the buyer's name and can
    // be renamed on its own page. The array form stays for callers that do
    // pass names (must then be one per ticket).
    attendeeNames: z.array(personName('a name for every ticket')).optional(),
    terms: z.literal('on', { error: 'Accept the terms to continue.' }),
  })
  .superRefine((v, ctx) => {
    if (v.attendeeNames && v.attendeeNames.length !== v.quantity) {
      ctx.addIssue({
        code: 'custom',
        path: ['attendeeNames'],
        message: 'Enter a name for every ticket.',
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
  };
}

/** bKash TrxIDs are ten letters and digits, e.g. 9AB12CD34E. Stored uppercase, trimmed (Invariant 3). */
export const TRX_ID_LENGTH = 10;
const TRX_ID_PATTERN = /^[A-Z0-9]{10}$/;

/** A4: the buyer reports a bKash payment. */
export const paymentFormSchema = z.object({
  trxId: z
    .string({ error: 'Enter the transaction ID from your bKash history.' })
    .trim()
    .toUpperCase()
    .transform((v) => v.replace(/\s+/g, ''))
    .superRefine((v, ctx) => {
      if (!TRX_ID_PATTERN.test(v)) {
        ctx.addIssue({
          code: 'custom',
          message:
            v.length === 0
              ? 'Enter the transaction ID from your bKash history.'
              : `A TrxID is exactly ${TRX_ID_LENGTH} letters and numbers — you have entered ${v.length}.`,
        });
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
    .string({ error: 'Enter your order reference.' })
    .trim()
    .toUpperCase()
    // Accept "EA-7K3M9Q", "EA7K3M9Q", "7K3M9Q" and any case; store form is EA-XXXXXX.
    .transform((v) => `EA-${v.replace(/^EA-?/, '')}`)
    .pipe(
      z.string().regex(ORDER_REFERENCE_PATTERN, {
        error: 'An order reference looks like EA-7K3M9Q.',
      }),
    ),
  phone: bdMobile,
});

/** Passwordless sign-in: just the email. */
export const signInSchema = z.object({
  email: z
    .string({ error: 'Enter your email address.' })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Enter a complete email address.' })),
});
