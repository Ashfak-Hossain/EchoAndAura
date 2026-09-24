import { currentDoor } from '@/lib/door-session';
import { doorService } from '@/server/container';
import { type DoorInitial, DoorApp } from './door-app';

/**
 * ADR-030: the gate scanner. The door phone's only credential is its
 * gate-pass cookie (Path=/door); this page never touches an admin session.
 */
export default async function DoorPage() {
  const ctx = await currentDoor();
  let initial: DoorInitial | null = null;
  if (ctx) {
    const status = await doorService.status(ctx);
    initial = {
      passId: ctx.pass.id,
      status: {
        ...status,
        recent: status.recent.map((r) => ({ ...r, at: r.at.toISOString() })),
        event: { title: ctx.event.title, startsAt: ctx.event.startsAt.toISOString() },
        gate: ctx.pass.label,
        validFrom: ctx.window.validFrom.toISOString(),
      },
    };
  }
  return <DoorApp initial={initial} />;
}
