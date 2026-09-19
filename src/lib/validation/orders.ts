import { z } from 'zod';
import { MAX_TICKETS_PER_ORDER, MIN_TICKETS_PER_ORDER } from '@/server/lib/order-rules';

/**
 * A3 registration form. The body carries the ticket type id and quantity —
 * never a price (Invariant 5). Messages are the design's own wording so the
 * inline errors read the same as the mock-ups.
 */

export const BD_MOBILE_PREFIX = '+880';
/** Ten digits after +880, starting 13–19 (every BD mobile operator). */
const BD_MOBILE_PATTERN = /^1[3-9]\d{8}$/;

const NAME_MIN = 2;
const NAME_MAX = 120;

const personName = (label: string) =>
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
    buyerPhone: z
      .string({ error: 'A bKash number is 10 digits after +880.' })
      // People type "01712…" or paste "+880 1712…"; the prefix is fixed on
      // the form, so strip any of those before checking the ten digits.
      .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+?880|0)/, ''))
      .pipe(
        z.string().regex(BD_MOBILE_PATTERN, { error: 'A bKash number is 10 digits after +880.' }),
      )
      .transform((digits) => `${BD_MOBILE_PREFIX}${digits}`),
    attendeeNames: z.array(personName('a name for every ticket')),
    terms: z.literal('on', { error: 'Accept the terms to continue.' }),
  })
  .superRefine((v, ctx) => {
    if (v.attendeeNames.length !== v.quantity) {
      ctx.addIssue({
        code: 'custom',
        path: ['attendeeNames'],
        message: 'Enter a name for every ticket.',
      });
    }
  });

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
    attendeeNames: formData
      .getAll('attendeeNames')
      .filter((v): v is string => typeof v === 'string'),
    terms: str('terms'),
  };
}
