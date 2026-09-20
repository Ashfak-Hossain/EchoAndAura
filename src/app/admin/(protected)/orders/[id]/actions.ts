'use server';

import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { fulfilmentService } from '@/server/container';
import {
  AttendeeNamesMismatchError,
  InvalidRejectionReasonError,
  OrderNotFoundError,
  OrderStatusConflictError,
  TicketCodeCollisionError,
  TrxIdChangedError,
} from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { requireAdmin } from '@/lib/session';
import { rejectFormSchema } from '@/lib/validation/verification';

export interface VerificationActionState {
  error?: string;
}

/** The acting admin, for the audit row. Role-checked here, not just by the layout. */
async function actor(): Promise<string> {
  return (await requireAdmin()).email;
}

/**
 * Thin: session → fulfilment.approveOrder → back to the order. `verifiedTrxId`
 * is the trxID the page showed when the admin clicked Approve, so a buyer
 * edit in between is refused rather than silently approved.
 */
export async function approveOrderAction(
  orderId: string,
  verifiedTrxId: string,
): Promise<VerificationActionState> {
  // redirect() throws; it must not sit inside the try below.
  const who = await actor();
  try {
    await fulfilmentService.approveOrder(orderId, { actor: who, verifiedTrxId });
  } catch (err: unknown) {
    return { error: toMessage(err) };
  }
  redirect(`/admin/orders/${orderId}?approved=1`);
}

/** Thin: Zod → session → fulfilment.rejectOrder → back to the queue. */
export async function rejectOrderAction(
  orderId: string,
  _prev: VerificationActionState,
  formData: FormData,
): Promise<VerificationActionState> {
  const parsed = rejectFormSchema.safeParse({
    reason: formData.get('reason'),
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const who = await actor();
  try {
    await fulfilmentService.rejectOrder(orderId, { actor: who, ...parsed.data });
  } catch (err: unknown) {
    return { error: toMessage(err) };
  }
  redirect(`/admin/orders/${orderId}?rejected=1`);
}

/** B8 "Re-send tickets email". Thin: uuid guard → session → service → redirect with the outcome. */
export async function resendTicketsEmailAction(orderId: string): Promise<void> {
  if (!z.uuid().safeParse(orderId).success) notFound();
  const who = await actor();
  let ok = true;
  try {
    await fulfilmentService.resendTicketsEmail(orderId, who);
  } catch (err: unknown) {
    logger.error(
      { orderId, err: err instanceof Error ? { name: err.name, message: err.message } : err },
      'resend tickets email failed',
    );
    ok = false;
  }
  redirect(`/admin/orders/${orderId}?resent=${ok ? 1 : 0}`);
}

function toMessage(err: unknown): string {
  if (err instanceof OrderStatusConflictError) {
    return `This order is already ${err.status.replace('_', ' ')} — reload to see its current state.`;
  }
  if (err instanceof TrxIdChangedError) {
    return 'The buyer changed the transaction ID after you opened this page — reload and check the new one against the statement.';
  }
  if (err instanceof AttendeeNamesMismatchError) {
    return 'This order’s attendee names do not match its quantity. Do not approve — this needs looking at.';
  }
  if (err instanceof OrderNotFoundError) return 'This order no longer exists.';
  if (err instanceof InvalidRejectionReasonError) return 'Choose a reason from the list.';
  if (err instanceof TicketCodeCollisionError) return 'Could not allocate ticket codes; try again.';
  // Shape only: a PostgresError carries the query and its parameters.
  const shape =
    err instanceof Error ? { name: err.name, message: err.message } : { value: String(err) };
  logger.error({ err: shape }, 'verification action: unexpected error');
  return 'Something went wrong on our side. Nothing was changed — please try again.';
}
