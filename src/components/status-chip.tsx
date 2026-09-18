import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  type ChipTone,
  type EventStatus,
  EVENT_STATUS_LABELS,
  type OrderStatus,
  ORDER_STATUS_LABELS,
  type TicketStatus,
  TICKET_STATUS_LABELS,
} from '@/lib/status-labels';

/**
 * S7 StatusChip, to the pixel: 28px pill, 13px/600, 12px side padding, a
 * tinted background with a matching 1px border. Some statuses add a 7px dot
 * (payment states), a dashed border (Draft), a solid fill (Tickets issued) or
 * a strike-through (Cancelled).
 */
const TONE: Record<ChipTone, string> = {
  neutral: 'border-[#ddd8ce] bg-secondary text-[#5c574c]',
  neutralStrong: 'border-border-strong bg-[#e8e4db] text-[#5c574c]',
  draft: 'border-dashed border-border-strong bg-secondary text-[#5c574c]',
  success: 'border-[#bfe0cd] bg-success-tint text-[#17603b]',
  successSolid: 'border-[#17603b] bg-success text-white',
  warning: 'border-[#f0d9ac] bg-accent text-[#5c4514]',
  info: 'border-[#c3d6ec] bg-info-tint text-[#194673]',
  danger: 'border-[#efc4c0] bg-destructive-tint text-[#8e1e17]',
  accent: 'border-marigold bg-marigold text-foreground',
};

const DOT: Partial<Record<ChipTone, string>> = {
  warning: 'bg-marigold',
  info: 'bg-info',
  success: 'bg-success',
};

interface ChipProps {
  tone: ChipTone;
  children: ReactNode;
  dot?: boolean;
  strike?: boolean;
  className?: string;
}

export function Chip({ tone, children, dot, strike, className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-[7px] rounded-full border px-3 text-[13px] font-semibold whitespace-nowrap',
        TONE[tone],
        strike && 'line-through decoration-[#5c574c]/60',
        className,
      )}
    >
      {dot && DOT[tone] ? (
        <span aria-hidden="true" className={cn('size-[7px] rounded-full', DOT[tone])} />
      ) : null}
      {children}
    </span>
  );
}

type StatusChipProps =
  | { kind?: 'event'; status: EventStatus; className?: string }
  | { kind: 'order'; status: OrderStatus; className?: string }
  | { kind: 'ticket'; status: TicketStatus; className?: string };

/** A chip for a real schema status — label and styling come from status-labels.ts. */
export function StatusChip(props: StatusChipProps) {
  const entry =
    props.kind === 'order'
      ? ORDER_STATUS_LABELS[props.status]
      : props.kind === 'ticket'
        ? TICKET_STATUS_LABELS[props.status]
        : EVENT_STATUS_LABELS[props.status];
  return (
    <Chip tone={entry.tone} dot={entry.dot} strike={entry.strike} className={props.className}>
      {entry.label}
    </Chip>
  );
}
