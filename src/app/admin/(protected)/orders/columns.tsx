'use client';

import Link from 'next/link';
import { formatBDT } from '@/server/lib/money';
import { adminColumnHelper, type DataTableColumn } from '@/components/admin/data-table';
import { Chip, StatusChip } from '@/components/status-chip';
import type { OrderStatus } from '@/lib/status-labels';
import type { MatchedField } from '@/lib/validation/orders-search';
import { cn } from '@/lib/utils';

/** A serialised order row: what the server page hands the client table. */
export interface OrderRow {
  id: string;
  reference: string;
  buyerName: string;
  buyerEmail: string;
  /** NULL on complimentary orders (B13). */
  buyerPhone: string | null;
  ticketTypeName: string;
  quantity: number;
  eventTitle: string;
  totalPaisa: number;
  complimentary: boolean;
  trxId: string | null;
  status: OrderStatus;
  /** Already formatted in Dhaka time on the server. */
  createdLabel: string;
  matchedField: MatchedField | null;
}

/** The cell that made this row a hit is tinted, so Raj sees why it matched. */
const hit = 'rounded bg-accent px-1 -mx-1';

const col = adminColumnHelper<OrderRow>();

export const orderColumns: DataTableColumn<OrderRow>[] = col.columns([
  col.accessor('reference', {
    header: 'Reference',
    meta: { sortKey: 'reference', alwaysVisible: true },
    cell: ({ row }) => (
      <Link
        href={`/admin/orders/${row.original.id}`}
        className={cn(
          'font-mono font-medium hover:underline',
          row.original.matchedField === 'reference' && hit,
        )}
      >
        {row.original.reference}
      </Link>
    ),
  }),
  col.accessor('buyerName', {
    id: 'buyer',
    header: 'Buyer',
    meta: { sortKey: 'buyer' },
    cell: ({ row }) => (
      <>
        <div>{row.original.buyerName}</div>
        <div
          className={cn(
            'text-[13px] text-muted-foreground',
            row.original.matchedField === 'email' && hit,
          )}
        >
          {row.original.buyerEmail}
        </div>
        {row.original.buyerPhone ? (
          <div
            className={cn(
              'text-[13px] text-muted-foreground tabular',
              row.original.matchedField === 'phone' && hit,
            )}
          >
            {row.original.buyerPhone}
          </div>
        ) : null}
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
    id: 'total',
    header: 'Total',
    meta: { sortKey: 'total', sortDescFirst: true, align: 'right', className: 'font-semibold' },
    cell: ({ row, getValue }) => (
      <span className="inline-flex items-center gap-2">
        {row.original.complimentary ? (
          <Chip tone="warning" size="sm">
            Comp
          </Chip>
        ) : null}
        <span className="tabular">{formatBDT(getValue())}</span>
      </span>
    ),
  }),
  col.accessor('trxId', {
    id: 'trxId',
    header: 'trxID',
    meta: { className: 'font-mono' },
    cell: ({ row }) =>
      row.original.trxId ? (
        <span className={cn(row.original.matchedField === 'trxId' && hit)}>
          {row.original.trxId}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  }),
  col.accessor('status', {
    header: 'Status',
    meta: { sortKey: 'status' },
    cell: ({ getValue }) => <StatusChip kind="order" status={getValue()} />,
  }),
  col.accessor('createdLabel', {
    id: 'created',
    header: 'Created (Dhaka)',
    meta: {
      sortKey: 'created',
      sortDescFirst: true,
      align: 'right',
      className: 'text-[13px] text-muted-foreground tabular whitespace-nowrap',
    },
  }),
]);
