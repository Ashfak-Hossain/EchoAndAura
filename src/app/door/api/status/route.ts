import { doorService } from '@/server/container';
import { DOOR_UNAUTHORISED, currentDoor, doorJson } from '@/lib/door-session';
import { doorStatusQuerySchema } from '@/lib/validation/door';

export const dynamic = 'force-dynamic';

/**
 * Counts, this gate's last scans, practice or live — and the "am I online"
 * ping. With `?since=`, also the check-ins made since (ADR-053).
 */
export async function GET(request: Request) {
  const ctx = await currentDoor();
  if (!ctx) return DOOR_UNAUTHORISED();
  const query = doorStatusQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const since = query.success && query.data.since ? new Date(query.data.since) : undefined;
  const status = await doorService.status(ctx, since);
  return doorJson({
    ...status,
    event: { title: ctx.event.title, startsAt: ctx.event.startsAt },
    gate: ctx.pass.label,
    validFrom: ctx.window.validFrom,
  });
}
