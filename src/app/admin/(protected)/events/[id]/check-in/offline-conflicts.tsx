import Link from 'next/link';
import { doorService } from '@/server/container';
import { formatDhakaClock } from '@/lib/time';

/**
 * ADR-034 double entries: an offline door phone showed ADMIT, and when its
 * scans reached the server the ticket was already in at another gate (or
 * had been cancelled). Offline, that cannot be prevented — two gates
 * without signal cannot know about each other — so it is shown here,
 * where the organizer can follow up on the order.
 */
export async function OfflineConflicts({ eventId }: { eventId: string }) {
  const [rows, decisions] = await Promise.all([
    doorService.offlineConflicts(eventId),
    doorService.raceDecisions(eventId),
  ]);
  return (
    <div data-testid="offline-conflicts" className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">Double entries</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None. When a gate scans offline, its admits are checked here once it has signal again.
        </p>
      ) : (
        <>
          <p className="max-w-3xl text-sm text-muted-foreground">
            A gate without signal admitted these tickets, but they had already been used, or were
            cancelled. The same ticket may have let two people in — a shared screenshot, most
            likely.
          </p>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {rows.map((r) => (
              <li
                key={r.scanId}
                data-testid="offline-conflict-row"
                className="flex flex-col gap-0.5 px-4 py-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {r.attendeeName ?? 'Unknown ticket'}
                    {r.ticketTypeName ? (
                      <span className="font-normal text-muted-foreground">
                        {' '}
                        · {r.ticketTypeName}
                      </span>
                    ) : null}
                  </span>
                  {r.orderId ? (
                    <Link
                      href={`/admin/orders/${r.orderId}`}
                      className="font-semibold underline underline-offset-2"
                    >
                      Order
                    </Link>
                  ) : null}
                </div>
                <span className="text-muted-foreground tabular">
                  {r.result === 'cancelled'
                    ? 'Ticket was cancelled'
                    : `In first ${r.priorAt ? formatDhakaClock(r.priorAt) : '—'} · ${r.priorGate ?? '?'}`}
                  {' — then admitted offline '}
                  {formatDhakaClock(r.admittedAt)} · {r.gate} (synced {formatDhakaClock(r.syncedAt)}
                  )
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {decisions.length > 0 ? (
        <>
          <h3 className="mt-3 text-base font-semibold">The server disagreed</h3>
          <p className="max-w-3xl text-sm text-muted-foreground">
            A gate&apos;s phone showed ADMIT from its own ticket list before the server answered,
            and the server then refused the ticket. Gate staff chose what to do; neither choice
            checked anyone in. &ldquo;Let in anyway&rdquo; means the ticket may have let two people
            in.
          </p>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {decisions.map((d) => (
              <li
                key={d.scanId}
                data-testid="race-decision-row"
                className="flex flex-col gap-0.5 px-4 py-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {d.attendeeName ?? 'Unknown ticket'}
                    {d.ticketTypeName ? (
                      <span className="font-normal text-muted-foreground">
                        {' '}
                        · {d.ticketTypeName}
                      </span>
                    ) : null}
                    <span
                      className={
                        d.decision === 'let_in'
                          ? 'ml-2 font-semibold text-destructive'
                          : 'ml-2 font-normal text-muted-foreground'
                      }
                    >
                      {d.decision === 'let_in' ? 'Let in anyway' : 'Turned away'}
                    </span>
                  </span>
                  {d.orderId ? (
                    <Link
                      href={`/admin/orders/${d.orderId}`}
                      className="font-semibold underline underline-offset-2"
                    >
                      Order
                    </Link>
                  ) : null}
                </div>
                <span className="text-muted-foreground tabular">
                  {d.result === 'already_in'
                    ? `In first ${d.priorCheckedInAt ? formatDhakaClock(d.priorCheckedInAt) : '—'} · ${d.priorCheckedInBy ?? '?'}`
                    : d.result === 'cancelled'
                      ? 'Ticket was cancelled'
                      : 'Not a valid ticket'}
                  {' — shown ADMIT early at '}
                  {d.gate} {formatDhakaClock(d.receivedAt)} (answered{' '}
                  {formatDhakaClock(d.decidedAt)})
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
