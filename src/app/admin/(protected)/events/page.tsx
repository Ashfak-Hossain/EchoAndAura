import type { Metadata } from 'next';
import Link from 'next/link';
import { eventsService, ticketTypesService } from '@/server/container';
import { ButtonLink } from '@/components/button-link';
import { EmptyState } from '@/components/empty-state';
import { DataTable } from '@/components/admin/data-table';
import { StatusChip } from '@/components/status-chip';
import { TabNav } from '@/components/tab-nav';
import type { EventStatus } from '@/lib/status-labels';
import { parseSort, type SortState } from '@/lib/table-sort';
import { formatDhakaLong, formatRelative } from '@/lib/time';
import { eventColumns, type EventRow } from './columns';

export const metadata: Metadata = { title: 'Events' };

const FILTERS: { key: 'all' | EventStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'draft', label: 'Draft' },
  { key: 'archived', label: 'Archived' },
];

const EVENT_SORT_COLUMNS = ['starts', 'title', 'status', 'sold', 'updated'] as const;
type EventSortColumn = (typeof EVENT_SORT_COLUMNS)[number];
const DEFAULT_SORT: SortState<EventSortColumn> = { column: 'starts', desc: true };

interface Props {
  searchParams: Promise<{ status?: string; sort?: string }>;
}

// B4: segmented status filter with counts, table, row → editor. Archived rows
// stay readable — the money history has to survive.
export default async function AdminEventsPage({ searchParams }: Props) {
  const { status, sort: sortParam } = await searchParams;
  const sort = parseSort(sortParam, EVENT_SORT_COLUMNS, DEFAULT_SORT);
  const active = FILTERS.some((f) => f.key === status)
    ? (status as (typeof FILTERS)[number]['key'])
    : 'all';

  const events = await eventsService.listEvents();
  const counts = { all: events.length, published: 0, draft: 0, archived: 0 };
  for (const e of events) counts[e.status] += 1;
  const visible = active === 'all' ? events : events.filter((e) => e.status === active);

  // Sold / total per event in one aggregate query (no order data yet).
  const capacity = await ticketTypesService.capacityForEvents(visible.map((e) => e.id));

  // The list is unpaginated (one organizer, tens of events), so the sort
  // happens here on the server — still URL-driven, never in the browser.
  const dir = sort.desc ? -1 : 1;
  const sorted = [...visible].sort((a, b) => {
    const ca = capacity.get(a.id)?.sold ?? 0;
    const cb = capacity.get(b.id)?.sold ?? 0;
    const cmp =
      sort.column === 'title'
        ? a.title.localeCompare(b.title)
        : sort.column === 'status'
          ? a.status.localeCompare(b.status)
          : sort.column === 'sold'
            ? ca - cb
            : sort.column === 'updated'
              ? a.updatedAt.getTime() - b.updatedAt.getTime()
              : a.startsAt.getTime() - b.startsAt.getTime();
    return dir * cmp;
  });
  const rows: EventRow[] = sorted.map((event) => {
    const t = capacity.get(event.id) ?? { sold: 0, total: 0 };
    return {
      id: event.id,
      title: event.title,
      slug: event.slug,
      startsLabel: formatDhakaLong(event.startsAt),
      status: event.status,
      venueHidden: event.venueHidden,
      sold: t.sold,
      total: t.total,
      updatedLabel: formatRelative(event.updatedAt),
    };
  });
  const query = active === 'all' ? '' : `?status=${active}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabNav
          label="Filter by status"
          active={active}
          variant="segmented"
          items={FILTERS.map((f) => ({
            key: f.key,
            label: f.label,
            count: counts[f.key],
            href: f.key === 'all' ? '/admin/events' : `/admin/events?status=${f.key}`,
          }))}
        />
        <ButtonLink href="/admin/events/new">New event</ButtonLink>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={active === 'all' ? 'Create your first event' : `No ${active} events`}
          description={
            active === 'all'
              ? 'Add the date, venue and ticket types. Nothing is public until you press Publish.'
              : 'Change the filter to see the rest.'
          }
          action={
            active === 'all' ? (
              <ButtonLink href="/admin/events/new">New event</ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <>
          <DataTable
            tableId="events"
            columns={eventColumns}
            data={rows}
            sort={sort}
            sortBase={{ pathname: '/admin/events', query }}
            rowTestId="event-row"
          />
          {/* Phone: one card per event */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/admin/events/${r.id}/edit`}
                  className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4 hover:border-border-strong"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{r.title}</span>
                    <StatusChip status={r.status} />
                  </div>
                  <div className="text-[13px] text-muted-foreground tabular">{r.startsLabel}</div>
                  <div className="flex justify-between text-[13px] text-muted-foreground tabular">
                    <span>
                      {r.sold} / {r.total} sold
                    </span>
                    <span>{r.updatedLabel}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
