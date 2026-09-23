import { z } from 'zod';
import { MAX_TICKETS_PER_ORDER, MIN_TICKETS_PER_ORDER } from '@/server/lib/order-rules';
import { personName } from '@/lib/validation/orders';

/**
 * B13 "Issue complimentary tickets" sheet. A ticket type id and a quantity
 * cross the wire, never a price (Invariant 5) — unknown keys are stripped.
 * One name for every ticket, like registration; the reason is required
 * because it is the only record of why seats were given away.
 */

export const COMP_REASON_MAX = 200;

export const complimentaryTicketsFormSchema = z.object({
  ticketTypeId: z.uuid({ error: 'Choose a ticket type.' }),
  quantity: z.coerce
    .number({ error: 'Choose how many tickets.' })
    .int({ error: 'Choose how many tickets.' })
    .min(MIN_TICKETS_PER_ORDER, { error: `At least ${MIN_TICKETS_PER_ORDER} ticket.` })
    .max(MAX_TICKETS_PER_ORDER, {
      error: `Max ${MAX_TICKETS_PER_ORDER} at a time — issue again for more.`,
    }),
  guestName: personName('the name on the tickets'),
  guestEmail: z
    .string({ error: 'Enter the guest’s email address.' })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Enter a complete email address.' })),
  reason: z
    .string({ error: 'Say why — it goes in the audit trail.' })
    .trim()
    .min(2, { error: 'Say why — it goes in the audit trail.' })
    .max(COMP_REASON_MAX, { error: `Keep the reason under ${COMP_REASON_MAX} characters.` }),
});

export type ComplimentaryTicketsFormInput = z.infer<typeof complimentaryTicketsFormSchema>;

const FIELDS = ['ticketTypeId', 'quantity', 'guestName', 'guestEmail', 'reason'] as const;
export type ComplimentaryField = (typeof FIELDS)[number];

/** The form's raw values, as strings, for the schema and for re-filling on error. */
export function complimentaryFormValues(formData: FormData): Record<ComplimentaryField, string> {
  return Object.fromEntries(
    FIELDS.map((f) => {
      const v = formData.get(f);
      return [f, typeof v === 'string' ? v : ''];
    }),
  ) as Record<ComplimentaryField, string>;
}

export function isComplimentaryField(v: unknown): v is ComplimentaryField {
  return typeof v === 'string' && (FIELDS as readonly string[]).includes(v);
}
