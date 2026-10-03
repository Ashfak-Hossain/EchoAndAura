import { doorService } from '@/server/container';
import { DoorDecisionRefusedError } from '@/server/lib/errors';
import {
  DOOR_FORBIDDEN,
  DOOR_UNAUTHORISED,
  currentDoor,
  doorJson,
  isSameOriginJson,
} from '@/lib/door-session';
import { doorDecisionSchema } from '@/lib/validation/door';

const REFUSED: Record<DoorDecisionRefusedError['reason'], string> = {
  not_found: 'That scan is not on record.',
  not_yours: 'Only the gate that scanned it can answer.',
  too_late: 'Too late to record — tell the organizer.',
  not_refused: 'The server admitted that ticket: nothing to record.',
};

/** ADR-053: what the gate did after its phone showed ADMIT and the server refused. */
export async function POST(request: Request) {
  if (!isSameOriginJson(request)) return DOOR_FORBIDDEN();
  const ctx = await currentDoor();
  if (!ctx) return DOOR_UNAUTHORISED();
  const parsed = doorDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return doorJson({ error: 'Bad decision.' }, { status: 400 });
  try {
    return doorJson(await doorService.decide(ctx, parsed.data.scanId, parsed.data.decision));
  } catch (err: unknown) {
    if (err instanceof DoorDecisionRefusedError) {
      return doorJson({ error: REFUSED[err.reason] }, { status: 409 });
    }
    throw err;
  }
}
