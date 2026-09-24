import { doorService } from '@/server/container';
import {
  DOOR_FORBIDDEN,
  DOOR_SLOW_DOWN,
  DOOR_UNAUTHORISED,
  currentDoor,
  doorJson,
  isSameOriginJson,
} from '@/lib/door-session';
import { DOOR_LIMITS, createDoorLimiter } from '@/lib/door-limits';
import { doorSearchSchema } from '@/lib/validation/door';

const limiter = createDoorLimiter();

/** Name search at the gate. A POST, so attendee names never sit in URLs or access logs. */
export async function POST(request: Request) {
  if (!isSameOriginJson(request)) return DOOR_FORBIDDEN();
  const ctx = await currentDoor();
  if (!ctx) return DOOR_UNAUTHORISED();
  const parsed = doorSearchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return doorJson({ error: 'Bad search.' }, { status: 400 });
  const allowed = await limiter.allow([{ ...DOOR_LIMITS.search, subject: ctx.pass.id }]);
  if (!allowed) return DOOR_SLOW_DOWN(DOOR_LIMITS.search.windowSeconds);
  return doorJson({ results: await doorService.search(ctx, parsed.data.q) });
}
