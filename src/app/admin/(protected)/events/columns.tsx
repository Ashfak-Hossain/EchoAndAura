'use client';

import Link from 'next/link';
import { adminColumnHelper, type DataTableColumn } from '@/components/admin/data-table';
import { StatusChip } from '@/components/status-chip';
import type { EventStatus } from '@/lib/status-labels';

export interface EventRow {
  id: string;
  title: string;
  slug: string;
  /** Formatted on the server (Dhaka). */
  startsLabel: string;
  status: EventStatus;
  /** ADR-029: the venue is kept off public pages. */
  venueHidden: boolean;
  sold: number;
  total: number;
  /** "8 min ago" — formatted on the server. */
  updatedLabel: string;
}

const col = adminColumnHelper<EventRow>();

/** B4 events list columns. Revenue arrives with the reports slice. */
export const eventColumns: DataTableColumn<EventRow>[] = col.columns([
  col.accessor('title', {
    header: 'Title',
    meta: { sortKey: 'title', alwaysVisible: true },
    cell: ({ row }) => (
      <Link
        href={`/admin/events/${row.original.id}/edit`}
        className="flex flex-col gap-0.5 font-medium hover:underline"
      >
        {row.original.title}
        <span className="font-mono text-xs font-normal text-muted-foreground">
          /{row.original.slug}
          {row.original.venueHidden ? <span className="font-sans"> · private venue</span> : null}
        </span>
      </Link>
    ),
  }),
  col.accessor('startsLabel', {
    id: 'starts',
    header: 'Starts (Dhaka)',
    meta: { sortKey: 'starts', className: 'whitespace-nowrap tabular' },
  }),
  col.accessor('status', {
    header: 'Status',
    meta: { sortKey: 'status' },
    cell: ({ getValue }) => <StatusChip status={getValue()} />,
  }),
  col.accessor('sold', {
    header: 'Sold / total',
    meta: { sortKey: 'sold', sortDescFirst: true, align: 'right', className: 'tabular' },
    cell: ({ row }) => `${row.original.sold} / ${row.original.total}`,
  }),
  col.display({
    id: 'revenue',
    header: 'Revenue',
    meta: { align: 'right', className: 'text-muted-foreground' },
    cell: () => '—',
  }),
  col.accessor('updatedLabel', {
    id: 'updated',
    header: 'Updated',
    meta: {
      sortKey: 'updated',
      sortDescFirst: true,
      align: 'right',
      className: 'whitespace-nowrap text-muted-foreground',
    },
  }),
]);
