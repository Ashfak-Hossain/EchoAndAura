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
import { formatDhakaClock, formatDhakaLong } from '@/lib/time';
import { formatSort } from '@/lib/table-sort';
import { cn } from '@/lib/utils';
import { getSiteSettings } from '@/lib/settings';
import { checkInQuerySchema } from '@/lib/validation/check-in';
import { CheckInPrintSheet } from './check-in-print-sheet';
import { CheckInToolbar } from './check-in-toolbar';
import { checkInColumns, type CheckInRowData } from './columns';
import { GatePasses } from './gate-passes';

export const metadata: Metadata = { title: 'Check-in list' };
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// B11: the door list for one event. Thin: Zod → service → rows for the
// table, the phone list and the print sheet (all from the same rows).
// ADR-030: plus the gate passes, and who is already in.
export default async function CheckInPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const raw = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const input = checkInQuerySchema.parse({
    q: first(raw.q),
    sort: first(raw.sort),
    show: first(raw.show),
  });
  const openPassId = z.uuid().safeParse(first(raw.pass)).data ?? null;
  const revoked = first(raw.revoked) === '1';
  const undone = Number(first(raw.undone) ?? 0) || 0;

  let list;
  const settings = getSiteSettings();
  try {
    list = await ticketsService.checkInList(id, input);
  } catch (err: unknown) {
    if (err instanceof EventNotFoundError) notFound();
    throw err;
  }
  const { event, total, cancelled, checkedIn } = list;
  const rows: CheckInRowData[] = list.rows.map((r) => ({
    id: r.id,
    attendeeName: r.attendeeName,
    ticketTypeName: r.ticketTypeName,
    code: r.code,
    orderId: r.orderId,
    orderReference: r.orderReference,
    checkedInAt: r.ticket.checkedInAt?.toISOString() ?? null,
    checkedInBy: r.ticket.checkedInBy,
  }));
  // A search or an In / Not-yet filter makes a partial list: never printed.
  const filtered = Boolean(input.q) || input.show !== 'all';

  const pathname = `/admin/events/${event.id}/check-in`;
  const keep = new URLSearchParams();
  if (input.q) keep.set('q', input.q);
  if (input.show !== 'all') keep.set('show', input.show);
  const query = new URLSearchParams(keep);
  query.set('sort', formatSort(input.sort));
  const exportHref = `${pathname}/export.csv?${query.toString()}`;
  const names = `${total} ${total === 1 ? 'name' : 'names'}`;

  // Links that drop one filter and keep the other.
  const withoutShow = input.q ? `${pathname}?q=${encodeURIComponent(input.q)}` : pathname;
  const withoutQ = input.show !== 'all' ? `${pathname}?show=${input.show}` : pathname;
  const empty =
    input.show !== 'all' && input.q ? (
      <EmptyState
        icon="⌕"
        title={`No one matching “${input.q}” is ${input.show === 'in' ? 'checked in' : 'still to come'}`}
        description="The search and the In / Not yet filter both apply."
        action={
          <span className="flex gap-4">
            <Link href={withoutShow} className="text-sm font-semibold underline underline-offset-2">
              Show everyone matching
            </Link>
            <Link href={withoutQ} className="text-sm font-semibold underline underline-offset-2">
              Clear search
            </Link>
          </span>
        }
      />
    ) : input.show !== 'all' ? (
      <EmptyState
        icon="—"
        title={input.show === 'in' ? 'No one checked in yet' : 'Everyone is in'}
        description={
          input.show === 'in'
            ? 'Tickets show here as the gates scan them.'
            : 'Every issued ticket has been scanned in.'
        }
        action={
          <Link href={pathname} className="text-sm font-semibold underline underline-offset-2">
            Show everyone
          </Link>
        }
      />
    ) : input.q ? (
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
              {total > 0 ? (
                <>
                  {' · '}
                  <span data-testid="checked-in-count">
                    {checkedIn} of {total} checked in
                  </span>
                </>
              ) : null}
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
                disabled={rows.length === 0 || filtered}
                title={
                  filtered ? 'Clear the search and show everyone to print the full list' : undefined
                }
              />
            </>
          }
        />
      </div>

      {revoked ? (
        <p role="status" className="rounded-md bg-secondary px-3 py-2 text-sm print:hidden">
          Gate pass revoked — the phone using it has stopped scanning.
          {undone > 0
            ? ` ${undone} ${undone === 1 ? 'check-in was' : 'check-ins were'} undone; those tickets can be scanned in again.`
            : ''}
        </p>
      ) : null}

      <GatePasses event={event} openPassId={openPassId} now={new Date()} />

      {/* `contents`: the wrapper must not take a gap slot on phones, where the table is hidden. */}
      <div className="contents print:hidden">
        <DataTable
          tableId="check-in"
          columns={checkInColumns}
          data={rows}
          sort={input.sort}
          sortBase={{ pathname, query: keep.toString() }}
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
                {row.checkedInAt ? (
                  <span className="text-[13px] text-success">
                    In {formatDhakaClock(new Date(row.checkedInAt))} · {row.checkedInBy}
                  </span>
                ) : null}
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
        show={input.show}
        asOf={new Date()}
        settings={await settings}
      />
    </div>
  );
}

const exportButton =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-card px-3.5 text-[13px] font-semibold hover:bg-secondary';
