import Link from 'next/link';
import type { ReportRange } from '@/server/lib/sales-report';
import type { EventOverviewRow } from '@/server/services/reports.service';
import { Money } from '@/components/money';
import { StatusChip } from '@/components/status-chip';
import { formatDhakaShort } from '@/lib/time';
import { cn } from '@/lib/utils';
import { formatCount, ReportCard } from './report-card';

/** B12 "All events": one line per event, each a link into its report; the open one is highlighted. */
export function EventsOverview({
  rows,
  more,
  currentId,
  range,
}: {
  rows: EventOverviewRow[];
  /** Older events not listed here (the CSV export has every one). */
  more: number;
  currentId: string;
  range: ReportRange;
}) {
  return (
    <ReportCard
      title="All events"
      subtitle="Seats and money per event, newest first"
      aside={
        <Link href={`/admin/orders?event=${currentId}`} className="underline underline-offset-2">
          Orders for this event →
        </Link>
      }
      testId="events-overview"
    >
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Event</th>
            <th className="hidden py-2 pr-3 font-medium sm:table-cell">Status</th>
            <th className="py-2 pr-3 text-right font-medium">Sold</th>
            <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">Held</th>
            <th className="py-2 pr-3 text-right font-medium">Revenue</th>
            <th className="hidden py-2 text-right font-medium md:table-cell">Pending</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const current = r.event.id === currentId;
            return (
              <tr
                key={r.event.id}
                className={cn('border-b border-border', current && 'bg-accent')}
                aria-current={current ? 'true' : undefined}
                data-testid="overview-row"
              >
                <td className="py-2.5 pr-3">
                  <Link
                    href={`/admin/reports?event=${r.event.id}&range=${range}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {r.event.title}
                  </Link>
                  <span className="block text-[12px] text-muted-foreground">
                    {formatDhakaShort(r.event.startsAt)}
                  </span>
                </td>
                <td className="hidden py-2.5 pr-3 sm:table-cell">
                  <StatusChip status={r.event.status} />
                </td>
                <td className="py-2.5 pr-3 text-right tabular">
                  {formatCount(r.seats.sold)}
                  <span className="text-muted-foreground"> / {formatCount(r.seats.total)}</span>
                </td>
                <td className="hidden py-2.5 pr-3 text-right tabular sm:table-cell">
                  {formatCount(r.seats.held)}
                </td>
                <td className="py-2.5 pr-3 text-right tabular">
                  <Money paisa={r.revenuePaisa} />
                </td>
                <td className="hidden py-2.5 text-right tabular md:table-cell">
                  {r.pendingOrders === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <>
                      <Money paisa={r.pendingPaisa} />
                      <span className="text-muted-foreground">
                        {' '}
                        · {formatCount(r.pendingOrders)}
                      </span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {more > 0 ? (
        <p className="text-[13px] text-muted-foreground">
          {formatCount(more)} older {more === 1 ? 'event is' : 'events are'} not listed — pick one
          from the selector above, or export “All events” for the full sheet.
        </p>
      ) : null}
    </ReportCard>
  );
}
