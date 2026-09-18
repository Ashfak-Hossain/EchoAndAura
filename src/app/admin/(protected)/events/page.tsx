import type { Metadata } from 'next';
import Link from 'next/link';
import { eventsService, ticketTypesService } from '@/server/container';
import { ButtonLink } from '@/components/button-link';
import { EmptyState } from '@/components/empty-state';
import { StatusChip } from '@/components/status-chip';
import { TabNav } from '@/components/tab-nav';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { EventStatus } from '@/lib/status-labels';
import { formatDhakaLong, formatRelative } from '@/lib/time';

export const metadata: Metadata = { title: 'Events' };

const FILTERS: { key: 'all' | EventStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'draft', label: 'Draft' },
  { key: 'archived', label: 'Archived' },
];

interface Props {
  searchParams: Promise<{ status?: string }>;
}

// B4: segmented status filter with counts, table, row → editor. Archived rows
// stay readable — the money history has to survive.
export default async function AdminEventsPage({ searchParams }: Props) {
  const { status } = await searchParams;
  const active = FILTERS.some((f) => f.key === status)
    ? (status as (typeof FILTERS)[number]['key'])
    : 'all';

  const events = await eventsService.listEvents();
  const counts = { all: events.length, published: 0, draft: 0, archived: 0 };
  for (const e of events) counts[e.status] += 1;
  const visible = active === 'all' ? events : events.filter((e) => e.status === active);

  // Sold / total per event in one aggregate query (no order data yet).
  const capacity = await ticketTypesService.capacityForEvents(visible.map((e) => e.id));

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
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Starts (Dhaka)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Sold / total</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((event) => {
                const t = capacity.get(event.id) ?? { sold: 0, total: 0 };
                return (
                  <TableRow key={event.id}>
                    <TableCell>
                      <Link
                        href={`/admin/events/${event.id}/edit`}
                        className="flex flex-col gap-0.5 font-medium hover:underline"
                      >
                        {event.title}
                        <span className="font-mono text-xs font-normal text-muted-foreground">
                          /{event.slug}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular">
                      {formatDhakaLong(event.startsAt)}
                    </TableCell>
                    <TableCell>
                      <StatusChip status={event.status} />
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {t.sold} / {t.total}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                    <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                      {formatRelative(event.updatedAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
