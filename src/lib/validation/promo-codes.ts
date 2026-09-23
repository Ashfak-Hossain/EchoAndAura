import { z } from 'zod';
import { takaToPaisa } from '@/server/lib/money';
import {
  normalisePromoCode,
  PROMO_CODE_MAX,
  PROMO_CODE_MIN,
  PROMO_CODE_PATTERN,
} from '@/server/lib/promo';

/**
 * B10 "New promo code" sheet. The code is typed any way and stored in
 * capitals; a percentage is a whole number 1–99; a fixed amount is taka
 * with up to two decimals, converted to paisa here and nowhere else
 * (`takaToPaisa`, Invariant 1). Errors are in the design's voice.
 */

/** Taka with at most two decimals, e.g. "200" or "199.50". */
const TAKA_PATTERN = /^\d{1,7}(?:\.\d{1,2})?$/;

export const promoCodeSchema = z
  .string({ error: 'Enter a code.' })
  .transform(normalisePromoCode)
  .pipe(
    z
      .string()
      .min(PROMO_CODE_MIN, { error: `A code is at least ${PROMO_CODE_MIN} characters.` })
      .max(PROMO_CODE_MAX, { error: `Keep the code to ${PROMO_CODE_MAX} characters.` })
      .regex(PROMO_CODE_PATTERN, {
        error: 'Use letters, numbers and hyphens only, e.g. DHAKA15.',
      }),
  );

export const promoCodeFormSchema = z
  .object({
    code: promoCodeSchema,
    type: z.enum(['percentage', 'fixed'], { error: 'Choose Percentage or Fixed ৳.' }),
    value: z.string({ error: 'Enter the discount.' }).trim(),
    // Explicit, never inferred from "nothing ticked": unticking the last type
    // must not silently turn a restricted code into one for every event.
    scope: z.enum(['all', 'some'], { error: 'Choose Any ticket type or Only these.' }),
    ticketTypeIds: z.array(z.uuid({ error: 'Choose ticket types from the list.' })).default([]),
    active: z.boolean().default(false),
  })
  .transform((v, ctx) => {
    const { scope, ...rest } = v;
    if (scope === 'some' && v.ticketTypeIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['ticketTypeIds'],
        message: 'Tick at least one ticket type, or choose Any ticket type.',
      });
      return z.NEVER;
    }
    const base = { ...rest, ticketTypeIds: scope === 'all' ? [] : v.ticketTypeIds };
    if (v.type === 'percentage') {
      const n = Number(v.value);
      // 100% would make every order ৳0, which bKash cannot pay — free
      // tickets are complimentary tickets issued by the organizer.
      if (!/^\d{1,2}$/.test(v.value) || n < 1 || n > 99) {
        ctx.addIssue({
          code: 'custom',
          path: ['value'],
          message: 'A percentage is 1 – 99. For free tickets, issue complimentary ones.',
        });
        return z.NEVER;
      }
      return { ...base, value: n };
    }
    if (!TAKA_PATTERN.test(v.value) || Number(v.value) <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Enter an amount in taka above ৳0, e.g. 200 or 199.50.',
      });
      return z.NEVER;
    }
    return { ...base, value: takaToPaisa(Number(v.value)) };
  });

export type PromoCodeFormInput = z.infer<typeof promoCodeFormSchema>;

/** FormData → the plain object the schema expects. */
export function promoCodeFormValues(formData: FormData): Record<string, unknown> {
  const str = (key: string) => {
    const v = formData.get(key);
    return typeof v === 'string' ? v : undefined;
  };
  return {
    code: str('code'),
    type: str('type'),
    value: str('value'),
    scope: str('scope'),
    ticketTypeIds: formData
      .getAll('ticketTypeIds')
      .filter((v): v is string => typeof v === 'string'),
    active: formData.get('active') === 'on',
  };
}

/** A3 "Apply": the event, the code as typed, and the ticket type it is for. */
export const promoCheckSchema = z.object({
  eventSlug: z.string().min(1).max(200),
  code: promoCodeSchema,
  ticketTypeId: z.uuid({ error: 'Choose a ticket type first.' }),
});
