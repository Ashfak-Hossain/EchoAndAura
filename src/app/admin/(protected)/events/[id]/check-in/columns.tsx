'use client';

import Link from 'next/link';
import { adminColumnHelper, type DataTableColumn } from '@/components/admin/data-table';
import { formatDhakaClock } from '@/lib/time';

/** One door-list line, serialised for the client table (no buyer contact). */
export interface CheckInRowData {
  id: string;
  attendeeName: string;
  ticketTypeName: string;
  code: string;
  orderId: string;
  orderReference: string;
  /** ADR-030: when (ISO) and at which gate it was scanned in, or null. */
  checkedInAt: string | null;
  checkedInBy: string | null;
}

const col = adminColumnHelper<CheckInRowData>();

/** B11 columns: what door staff read, in the order they read it. */
export const checkInColumns: DataTableColumn<CheckInRowData>[] = col.columns([
  col.accessor('attendeeName', {
    id: 'name',
    header: 'Attendee',
    meta: { sortKey: 'name', alwaysVisible: true, className: 'font-medium' },
  }),
  col.accessor('ticketTypeName', {
    id: 'type',
    header: 'Type',
    meta: { sortKey: 'type' },
  }),
  col.accessor('code', {
    header: 'Ticket code',
    meta: { sortKey: 'code', className: 'font-mono' },
    cell: ({ getValue }) => (
      <Link
        href={`/tickets/${getValue()}`}
        target="_blank"
        rel="noreferrer"
        className="hover:underline"
      >
        {getValue()}
      </Link>
    ),
  }),
  col.accessor('checkedInAt', {
    id: 'checkedIn',
    header: 'Checked in',
    cell: ({ row }) =>
      row.original.checkedInAt ? (
        <span className="text-success tabular">
          {formatDhakaClock(new Date(row.original.checkedInAt))} · {row.original.checkedInBy}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  }),
  col.accessor('orderReference', {
    id: 'order',
    header: 'Order',
    meta: { sortKey: 'order', className: 'font-mono' },
    cell: ({ row }) => (
      <Link href={`/admin/orders/${row.original.orderId}`} className="hover:underline">
        {row.original.orderReference}
      </Link>
    ),
  }),
]);
