import { doorService } from '@/server/container';
import { DOOR_UNAUTHORISED, currentDoor, doorJson } from '@/lib/door-session';

export const dynamic = 'force-dynamic';

/** Counts, this gate's last scans, practice or live — and the "am I online" ping. */
export async function GET() {
  const ctx = await currentDoor();
  if (!ctx) return DOOR_UNAUTHORISED();
  const status = await doorService.status(ctx);
  return doorJson({
    ...status,
    event: { title: ctx.event.title, startsAt: ctx.event.startsAt },
    gate: ctx.pass.label,
    validFrom: ctx.window.validFrom,
  });
}
