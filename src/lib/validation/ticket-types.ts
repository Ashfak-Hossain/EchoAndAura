import { z } from 'zod';
import { takaToPaisa } from '@/server/lib/money';
import { DATETIME_LOCAL_PATTERN, fromDhakaInput } from '@/lib/time';

/**
 * Admin ticket-type form input. Price is typed in taka ("800" or "799.50")
 * and leaves this schema as integer paisa — `takaToPaisa` in money.ts is the
 * only conversion site (Invariant 1). More than two decimals is rejected,
 * not rounded: the organizer must type the price they mean.
 */

export const TICKET_TYPE_MAX_QUANTITY = 100_000;

const TAKA_PATTERN = /^\d{1,9}(?:\.\d{1,2})?$/;
const INTEGER_PATTERN = /^\d{1,7}$/;

const dhakaDateTime = z
  .string()
  .trim()
  .regex(DATETIME_LOCAL_PATTERN, { error: 'Enter a valid date and time' })
  .transform((v, ctx) => {
    const date = fromDhakaInput(v);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid date and time' });
      return z.NEVER;
    }
    return date;
  });

const optionalDhakaDateTime = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional()
  .pipe(dhakaDateTime.optional());

export const ticketTypeFormSchema = z
  .object({
    name: z
      .string({ error: 'Name is required' })
      .trim()
      .min(1, { error: 'Name is required' })
      .max(120, { error: 'Name must be at most 120 characters' }),
    priceTaka: z
      .string({ error: 'Price is required' })
      .trim()
      .regex(TAKA_PATTERN, {
        error: 'Enter a price in taka with at most 2 decimals, e.g. 799.50',
      })
      .transform((v) => takaToPaisa(Number(v))),
    quantityTotal: z
      .string({ error: 'Quantity is required' })
      .trim()
      .regex(INTEGER_PATTERN, { error: 'Enter a whole number of tickets' })
      .transform(Number)
      .pipe(
        z
          .number()
          .int()
          .min(1, { error: 'Quantity must be at least 1' })
          .max(TICKET_TYPE_MAX_QUANTITY, {
            error: `Quantity must be at most ${TICKET_TYPE_MAX_QUANTITY.toLocaleString('en-US')}`,
          }),
      ),
    salesStartsAt: optionalDhakaDateTime,
    salesEndsAt: optionalDhakaDateTime,
  })
  .transform(({ priceTaka, ...rest }) => ({ ...rest, pricePaisa: priceTaka }))
  .superRefine((v, ctx) => {
    if (v.salesStartsAt && v.salesEndsAt && v.salesStartsAt >= v.salesEndsAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['salesEndsAt'],
        message: 'Sales must end after they start',
      });
    }
  });

export type TicketTypeFormInput = z.infer<typeof ticketTypeFormSchema>;
