'use client';

import Link from 'next/link';
import { formatBDT } from '@/server/lib/money';
import { adminColumnHelper, type DataTableColumn } from '@/components/admin/data-table';
import { cn } from '@/lib/utils';

export interface QueueRowData {
  id: string;
  reference: string;
  buyerName: string;
  buyerPhone: string | null;
  ticketTypeName: string;
  quantity: number;
  eventTitle: string;
  totalPaisa: number;
  trxId: string;
  sender: string;
  /** "8 min ago" — formatted on the server against the request clock. */
  submittedLabel: string;
  /** "in 1h 05m" / "lapsed" — formatted on the server. */
  holdLabel: string;
  holdUrgent: boolean;
}

const col = adminColumnHelper<QueueRowData>();

/** B7 columns. Approve/reject stay on the order page: amount and trxID side by side. */
export const queueColumns: DataTableColumn<QueueRowData>[] = col.columns([
  col.accessor('reference', {
    header: 'Reference · buyer',
    meta: { alwaysVisible: true },
    cell: ({ row }) => (
      <>
        <Link
          href={`/admin/orders/${row.original.id}`}
          className="font-mono font-medium hover:underline"
        >
          {row.original.reference}
        </Link>
        <div className="text-[13px]">{row.original.buyerName}</div>
        <div className="text-[13px] text-muted-foreground tabular">
          {row.original.buyerPhone ?? '—'}
        </div>
      </>
    ),
  }),
  col.display({
    id: 'tickets',
    header: 'Tickets',
    cell: ({ row }) => (
      <>
        <div>
          {row.original.ticketTypeName} × {row.original.quantity}
        </div>
        <div className="text-[13px] text-muted-foreground">{row.original.eventTitle}</div>
      </>
    ),
  }),
  col.accessor('totalPaisa', {
    id: 'amount',
    header: 'Amount',
    meta: { sortKey: 'amount', sortDescFirst: true, align: 'right', className: 'font-semibold' },
    cell: ({ getValue }) => <span className="tabular">{formatBDT(getValue())}</span>,
  }),
  col.accessor('trxId', {
    header: 'trxID',
    meta: { className: 'font-mono' },
  }),
  col.accessor('sender', {
    header: 'Sender',
    meta: { className: 'tabular' },
  }),
  col.accessor('submittedLabel', {
    id: 'submitted',
    header: 'Submitted',
    meta: { sortKey: 'submitted', className: 'tabular' },
  }),
  col.accessor('holdLabel', {
    id: 'hold',
    header: 'Hold expires',
    meta: { sortKey: 'hold', className: 'tabular' },
    cell: ({ row }) => (
      <span className={cn(row.original.holdUrgent && 'font-semibold text-destructive')}>
        {row.original.holdLabel}
      </span>
    ),
  }),
]);
