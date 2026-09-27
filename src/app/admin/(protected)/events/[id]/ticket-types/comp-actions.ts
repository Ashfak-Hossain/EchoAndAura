'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { fulfilmentService } from '@/server/container';
import { InvalidQuantityError, SoldOutError, TicketTypeNotFoundError } from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { requireAdmin } from '@/lib/session';
import {
  type ComplimentaryField,
  complimentaryFormValues,
  complimentaryTicketsFormSchema,
  isComplimentaryField,
} from '@/lib/validation/complimentary-tickets';
import { editorPath } from '../editor-path';

export interface CompFormState {
  /** New on every failed submit: the fields remount, re-seeded from `values` (React 19 form reset). */
  nonce?: string;
  error?: string;
  field?: ComplimentaryField;
  values?: Record<ComplimentaryField, string>;
}

function fail(state: Omit<CompFormState, 'nonce'>): CompFormState {
  return { ...state, nonce: crypto.randomUUID() };
}

/**
 * B13 Issue complimentary tickets. Thin: session → Zod → fulfilment →
 * back to the Ticket types tab with a banner linking to the new order.
 * `eventId` is bound by the page.
 */
export async function issueComplimentaryTicketsAction(
  eventId: string,
  _prev: CompFormState,
  formData: FormData,
): Promise<CompFormState> {
  const admin = await requireAdmin();
  const values = complimentaryFormValues(formData);
  // Bound arguments are client input too.
  if (!z.uuid().safeParse(eventId).success) return fail({ error: 'This event no longer exists.' });
  const parsed = complimentaryTicketsFormSchema.safeParse(values);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    return fail({
      error: issue?.message ?? 'Check the form.',
      field: isComplimentaryField(field) ? field : undefined,
      values,
    });
  }

  let orderId: string;
  try {
    const { order } = await fulfilmentService.issueComplimentaryTickets({
      eventId,
      ...parsed.data,
      actor: admin.email,
    });
    orderId = order.id;
  } catch (err: unknown) {
    if (err instanceof SoldOutError) {
      return fail({
        error: `Not enough left for ${err.requested} — fewer seats are available now. Lower the number.`,
        field: 'quantity',
        values,
      });
    }
    if (err instanceof TicketTypeNotFoundError) {
      return fail({
        error: 'That ticket type no longer exists on this event. Reload and choose again.',
        field: 'ticketTypeId',
        values,
      });
    }
    if (err instanceof InvalidQuantityError) {
      return fail({ error: 'Choose how many tickets.', field: 'quantity', values });
    }
    logger.error(
      { err: err instanceof Error ? { name: err.name, message: err.message } : String(err) },
      'comps: issue failed',
    );
    return fail({ error: 'Could not issue them — nothing was changed. Please try again.', values });
  }
  const path = editorPath(eventId, 'ticket-types');
  revalidatePath(path);
  redirect(`${path}&comped=${orderId}`);
}
