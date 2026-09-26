import { doorService } from '@/server/container';
import { logger } from '@/server/lib/logger';
import { safeErrorShape } from '@/server/lib/pg-errors';
import { DOOR_SLOW_DOWN, DOOR_UNAUTHORISED, currentDoor, doorJson } from '@/lib/door-session';
import { DOOR_LIMITS, createDoorLimiter } from '@/lib/door-limits';

export const dynamic = 'force-dynamic';

// Fails open (see door-limits): a gate must never stop because Redis blinked.
const limiter = createDoorLimiter();

/** ADR-034: this event's tickets for the phone to answer from offline. Hashed codes, no buyer details. */
export async function GET() {
  const ctx = await currentDoor();
  if (!ctx) return DOOR_UNAUTHORISED();
  const rule = { ...DOOR_LIMITS.list, subject: ctx.pass.id };
  if (!(await limiter.allow([rule]))) return DOOR_SLOW_DOWN(rule.windowSeconds);
  try {
    return doorJson(await doorService.offlineList(ctx));
  } catch (err: unknown) {
    logger.error({ err: safeErrorShape(err), passId: ctx.pass.id }, 'door: offline list failed');
    return doorJson({ error: 'The offline list could not be built.' }, { status: 500 });
  }
}
