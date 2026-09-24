import { doorService } from '@/server/container';
import { normalisePassCode } from '@/server/lib/door-pass';
import {
  DOOR_FORBIDDEN,
  DOOR_SLOW_DOWN,
  clearDoorCookie,
  doorJson,
  isSameOriginJson,
  setDoorCookie,
} from '@/lib/door-session';
import { DOOR_LIMITS, createDoorLimiter } from '@/lib/door-limits';
import { requestIp } from '@/lib/request-ip';
import { doorSessionSchema } from '@/lib/validation/door';

// The 12-symbol code (~59 bits) is the defence; this throttle only keeps
// noise down, so a Redis outage lets gate phones sign in (fail open). Only
// WRONG codes count: door phones share the venue's IP with everyone there,
// so a stranger's bad guesses must never lock a right code out.
const limiter = createDoorLimiter();

/** Sign a door phone in with its gate code. Thin: guard → Zod → throttle → service. */
export async function POST(request: Request) {
  if (!isSameOriginJson(request)) return DOOR_FORBIDDEN();
  const parsed = doorSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return doorJson({ error: 'Enter the gate code.' }, { status: 400 });
  const ctx = await doorService.authenticate(parsed.data.code);
  if (!ctx) {
    const allowed = await limiter.allow([{ ...DOOR_LIMITS.code, subject: await requestIp() }]);
    if (!allowed) return DOOR_SLOW_DOWN(DOOR_LIMITS.code.windowSeconds);
    return doorJson(
      { error: 'That gate code is not active — check it, or ask for a new one.' },
      { status: 401 },
    );
  }
  const response = doorJson({
    event: { title: ctx.event.title, startsAt: ctx.event.startsAt },
    gate: ctx.pass.label,
    practice: ctx.practice,
    validFrom: ctx.window.validFrom,
  });
  setDoorCookie(response, request, normalisePassCode(parsed.data.code)!, ctx.window.validUntil);
  return response;
}

/** End the session on this phone. */
export async function DELETE(request: Request) {
  if (!isSameOriginJson(request)) return DOOR_FORBIDDEN();
  const response = doorJson({ ok: true });
  clearDoorCookie(response);
  return response;
}
