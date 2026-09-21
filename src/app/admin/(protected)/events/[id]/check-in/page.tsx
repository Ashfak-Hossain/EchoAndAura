import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download } from 'lucide-react';
import { z } from 'zod';
import { ticketsService } from '@/server/container';
import { CHECK_IN_DEFAULT_SORT, sortCheckInRows } from '@/server/lib/check-in';
import { EventNotFoundError } from '@/server/lib/errors';
import { DataTable } from '@/components/admin/data-table';
import { PrintButton } from '@/components/admin/print-button';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatusChip } from '@/components/status-chip';
import { formatDhakaLong } from '@/lib/time';
import { formatSort } from '@/lib/table-sort';
import { cn } from '@/lib/utils';
import { getSiteSettings } from '@/lib/settings';
import { checkInQuerySchema } from '@/lib/validation/check-in';
import { CheckInPrintSheet } from './check-in-print-sheet';
import { CheckInToolbar } from './check-in-toolbar';
import { checkInColumns, type CheckInRowData } from './columns';

export const metadata: Metadata = { title: 'Check-in list' };
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// B11: the door list for one event. Thin: Zod → service → rows for the
// table, the phone list and the print sheet (all from the same rows).
export default async function CheckInPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const raw = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const input = checkInQuerySchema.parse({ q: first(raw.q), sort: first(raw.sort) });

  let list;
  const settings = getSiteSettings();
  try {
    list = await ticketsService.checkInList(id, input);
  } catch (err: unknown) {
    if (err instanceof EventNotFoundError) notFound();
    throw err;
  }
  const { event, total, cancelled } = list;
  const rows: CheckInRowData[] = list.rows.map((r) => ({
    id: r.id,
    attendeeName: r.attendeeName,
    ticketTypeName: r.ticketTypeName,
    code: r.code,
    orderId: r.orderId,
    orderReference: r.orderReference,
  }));

  const pathname = `/admin/events/${event.id}/check-in`;
  const query = new URLSearchParams();
  if (input.q) query.set('q', input.q);
  query.set('sort', formatSort(input.sort));
  const exportHref = `${pathname}/export.csv?${query.toString()}`;
  const names = `${total} ${total === 1 ? 'name' : 'names'}`;

  const empty = input.q ? (
    <EmptyState
      icon="⌕"
      title={`No names match “${input.q}”`}
      description="Try part of the name, the ticket code or the order reference."
      action={
        <Link href={pathname} className="text-sm font-semibold underline underline-offset-2">
          Clear search
        </Link>
      }
    />
  ) : (
    <EmptyState
      icon="—"
      title="No tickets issued yet"
      description="The list fills up as payments are approved. Print it the day before the show."
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <PageHeader
          title={event.title}
          badge={<StatusChip status={event.status} />}
          subtitle={
            <>
              {formatDhakaLong(event.startsAt)} (Dhaka) ·{' '}
              <span data-testid="check-in-count">
                {total === 0 ? 'no tickets issued yet' : names}
              </span>
              {cancelled > 0
                ? ` · ${cancelled} cancelled ${cancelled === 1 ? 'ticket' : 'tickets'} not listed`
                : ''}
            </>
          }
          actions={
            <>
              <Link
                href={`/admin/events/${event.id}/edit`}
                className="inline-flex h-9 items-center rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                ← Event
              </Link>
              {total === 0 ? (
                <span
                  aria-disabled="true"
                  className={cn(exportButton, 'cursor-not-allowed border-border text-[#a8a29a]')}
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  Export CSV
                </span>
              ) : (
                <Link href={exportHref} prefetch={false} className={exportButton}>
                  <Download className="size-3.5" aria-hidden="true" />
                  Export CSV
                </Link>
              )}
              {/* Never print a filtered list: a partial sheet looks like the whole door list. */}
              <PrintButton
                label="Print list"
                disabled={rows.length === 0 || Boolean(input.q)}
                title={input.q ? 'Clear the search to print the full list' : undefined}
              />
            </>
          }
        />
      </div>

      {/* `contents`: the wrapper must not take a gap slot on phones, where the table is hidden. */}
      <div className="contents print:hidden">
        <DataTable
          tableId="check-in"
          columns={checkInColumns}
          data={rows}
          sort={input.sort}
          sortBase={{ pathname, query: input.q ? `q=${encodeURIComponent(input.q)}` : '' }}
          toolbar={total > 0 ? <CheckInToolbar /> : undefined}
          rowTestId="check-in-row"
          empty={empty}
        />
      </div>

      {/* Phone layout: the same search, then a compact list for the door. */}
      <div className="flex flex-col gap-4 lg:hidden print:hidden">
        {total > 0 ? <CheckInToolbar /> : null}
        {rows.length === 0 ? (
          empty
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-0.5 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{row.attendeeName}</span>
                  <span className="text-[13px] text-muted-foreground">{row.ticketTypeName}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 font-mono text-[13px] text-muted-foreground">
                  <Link href={`/tickets/${row.code}`} target="_blank" rel="noreferrer">
                    {row.code}
                  </Link>
                  <Link href={`/admin/orders/${row.orderId}`}>{row.orderReference}</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Always name A–Z on paper, whatever the screen is sorted by. */}
      <CheckInPrintSheet
        event={event}
        rows={sortCheckInRows(rows, CHECK_IN_DEFAULT_SORT)}
        total={total}
        query={input.q}
        asOf={new Date()}
        settings={await settings}
      />
    </div>
  );
}

const exportButton =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-card px-3.5 text-[13px] font-semibold hover:bg-secondary';
