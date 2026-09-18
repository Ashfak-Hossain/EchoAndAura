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

// S7: pill, tint background, matching ink. Tones map to the status tokens.
const TONE_CLASSES: Record<ChipTone, string> = {
  neutral: 'bg-secondary text-muted-foreground',
  success: 'bg-success-tint text-success',
  warning: 'bg-warning-tint text-warning',
  danger: 'bg-destructive-tint text-destructive',
  info: 'bg-info-tint text-info',
  accent: 'bg-accent text-accent-ink',
};

interface ChipProps {
  tone: ChipTone;
  children: ReactNode;
  className?: string;
}

export function Chip({ tone, children, className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type StatusChipProps =
  | { kind?: 'event'; status: EventStatus; className?: string }
  | { kind: 'order'; status: OrderStatus; className?: string }
  | { kind: 'ticket'; status: TicketStatus; className?: string };

/** A chip for a real schema status — label and tone come from status-labels.ts. */
export function StatusChip(props: StatusChipProps) {
  const entry =
    props.kind === 'order'
      ? ORDER_STATUS_LABELS[props.status]
      : props.kind === 'ticket'
        ? TICKET_STATUS_LABELS[props.status]
        : EVENT_STATUS_LABELS[props.status];
  return (
    <Chip tone={entry.tone} className={props.className}>
      {entry.label}
    </Chip>
  );
}
