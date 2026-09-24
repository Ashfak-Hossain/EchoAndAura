import { doorService } from '@/server/container';
import { CheckInUndoRefusedError, DoorPassRevokedError } from '@/server/lib/errors';
import {
  DOOR_FORBIDDEN,
  DOOR_UNAUTHORISED,
  currentDoor,
  doorJson,
  isSameOriginJson,
} from '@/lib/door-session';
import { doorUndoSchema } from '@/lib/validation/door';

const REFUSED: Record<CheckInUndoRefusedError['reason'], string> = {
  not_found: 'That scan was not an admit.',
  not_yours: 'Only the gate that admitted them can undo it here.',
  too_late: 'Too late to undo here — ask the organizer.',
  not_checked_in: 'They are no longer checked in.',
};

/** The door undoes its own admit, within 2 minutes. */
export async function POST(request: Request) {
  if (!isSameOriginJson(request)) return DOOR_FORBIDDEN();
  const ctx = await currentDoor();
  if (!ctx) return DOOR_UNAUTHORISED();
  const parsed = doorUndoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return doorJson({ error: 'Bad undo.' }, { status: 400 });
  try {
    await doorService.undoOwnAdmit(ctx, parsed.data.scanId, parsed.data.reason);
    return doorJson({ ok: true });
  } catch (err: unknown) {
    if (err instanceof CheckInUndoRefusedError) {
      return doorJson({ error: REFUSED[err.reason] }, { status: 409 });
    }
    if (err instanceof DoorPassRevokedError) return DOOR_UNAUTHORISED();
    throw err;
  }
}
