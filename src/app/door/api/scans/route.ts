import { doorService } from '@/server/container';
import { DoorPassRevokedError } from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { safeErrorShape } from '@/server/lib/pg-errors';
import {
  DOOR_FORBIDDEN,
  DOOR_SLOW_DOWN,
  DOOR_UNAUTHORISED,
  currentDoor,
  doorJson,
  isSameOriginJson,
} from '@/lib/door-session';
import { DOOR_LIMITS, createDoorLimiter } from '@/lib/door-limits';
import { doorScansSchema } from '@/lib/validation/door';

// Fails open (see door-limits): a gate must never stop because Redis blinked.
const limiter = createDoorLimiter();

/** One scan (Slice A). Thin: guard → pass → Zod → throttle → service. */
export async function POST(request: Request) {
  if (!isSameOriginJson(request)) return DOOR_FORBIDDEN();
  const ctx = await currentDoor();
  if (!ctx) return DOOR_UNAUTHORISED();
  const parsed = doorScansSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return doorJson({ error: 'Bad scan.' }, { status: 400 });

  const subject = ctx.pass.id;
  const byName = parsed.data.scans.some((s) => s.method === 'search');
  const rules = [
    { ...DOOR_LIMITS.scan, subject },
    ...(byName ? [{ ...DOOR_LIMITS.searchAdmit, subject }] : []),
  ];
  if (!(await limiter.allow(rules))) return DOOR_SLOW_DOWN(DOOR_LIMITS.scan.windowSeconds);

  try {
    const results = await doorService.scanBatch(ctx, parsed.data.scans);
    return doorJson({ results });
  } catch (err: unknown) {
    // Revoked while this scan was in flight: the phone is signed out.
    if (err instanceof DoorPassRevokedError) return DOOR_UNAUTHORISED();
    logger.error({ err: safeErrorShape(err), passId: ctx.pass.id }, 'door: scan failed');
    return doorJson({ error: 'The scan could not be recorded — try again.' }, { status: 500 });
  }
}
