'use server';

import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { doorService } from '@/server/container';
import {
  DoorPassNotAllowedError,
  DoorPassNotFoundError,
  EventNotFoundError,
} from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { requireAdmin } from '@/lib/session';
import { checkInUndoFormSchema, gatePassFormSchema } from '@/lib/validation/door';

export interface GatePassActionState {
  error?: string;
}

const checkInPath = (eventId: string) => `/admin/events/${eventId}/check-in`;

function guard(...ids: string[]): void {
  if (ids.some((id) => !z.uuid().safeParse(id).success)) notFound();
}

/** ADR-030 "New gate pass". Thin: uuid guard → Zod → session → door.createPass → show it. */
export async function createGatePassAction(
  eventId: string,
  _prev: GatePassActionState,
  formData: FormData,
): Promise<GatePassActionState> {
  guard(eventId);
  const parsed = gatePassFormSchema.safeParse({ label: formData.get('label') ?? '' });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const admin = await requireAdmin();
  let passId: string;
  try {
    passId = (await doorService.createPass(eventId, parsed.data.label, admin.email)).id;
  } catch (err: unknown) {
    return { error: toMessage(err) };
  }
  redirect(`${checkInPath(eventId)}?pass=${passId}`);
}

/** Stop a gate pass working — a lost phone, a gate closed. Its check-ins stand. */
export async function revokeGatePassAction(
  eventId: string,
  passId: string,
): Promise<GatePassActionState> {
  guard(eventId, passId);
  const admin = await requireAdmin();
  try {
    await doorService.revokePass(eventId, passId, admin.email);
  } catch (err: unknown) {
    return { error: toMessage(err) };
  }
  redirect(`${checkInPath(eventId)}?revoked=1`);
}

/**
 * A leaked pass: revoke it AND undo every check-in it made that still
 * stands (each audited), so those tickets can be scanned again by their
 * real holders.
 */
export async function revokeAndUndoGatePassAction(
  eventId: string,
  passId: string,
  _prev: GatePassActionState,
  formData: FormData,
): Promise<GatePassActionState> {
  guard(eventId, passId);
  const parsed = checkInUndoFormSchema.safeParse({ reason: formData.get('reason') ?? '' });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const admin = await requireAdmin();
  let undone: number;
  try {
    undone = await doorService.revokeAndUndo(eventId, passId, parsed.data.reason, admin.email);
  } catch (err: unknown) {
    return { error: toMessage(err) };
  }
  redirect(`${checkInPath(eventId)}?revoked=1&undone=${undone}`);
}

function toMessage(err: unknown): string {
  if (err instanceof DoorPassNotAllowedError) {
    return err.reason === 'not_published'
      ? 'New gate passes need a published event (an archived event keeps its existing passes).'
      : 'This event is over; its gate passes have stopped working.';
  }
  if (err instanceof DoorPassNotFoundError)
    return 'This gate pass no longer exists — reload the page.';
  if (err instanceof EventNotFoundError) return 'This event no longer exists.';
  const shape =
    err instanceof Error ? { name: err.name, message: err.message } : { value: String(err) };
  logger.error({ err: shape }, 'gate pass action: unexpected error');
  return 'Something went wrong on our side. Nothing was changed — please try again.';
}
