'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
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
import { auth } from '@/lib/auth';
import { rejectFormSchema } from '@/lib/validation/verification';

export interface VerificationActionState {
  error?: string;
}

/** The acting admin, for the audit row. The layout already guaranteed a session. */
async function actor(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/admin/login');
  return session.user.email;
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
