import { type EventPhase, ticketAvailability } from '@/server/lib/event-phase';
import type { TicketTypeRecord } from '@/server/repositories/ticket-types.repository';
import { Money } from '@/components/money';
import { Chip } from '@/components/status-chip';
import { formatDhakaLong } from '@/lib/time';
import { cn } from '@/lib/utils';

interface Props {
  ticketTypes: TicketTypeRecord[];
  phase: EventPhase;
  now: Date;
  /** Desktop panel rows are denser than the mobile cards (A2 · 1440). */
  compact?: boolean;
  /** The row to tint marigold: the open type whose sales end soonest (an Early Bird). */
  highlightId?: string | null;
}

/**
 * A2 ticket rows. Prices are always shown; quantities only while registration
 * is open ("prices before the window opens, quantities are not"). A sold-out
 * or closed type stays visible, greyed, with its price — removing it makes
 * the page look wrong to anyone who saw it earlier.
 */
export function TicketList({ ticketTypes, phase, now, compact, highlightId }: Props) {
  const showQuantities = phase === 'open' || phase === 'closing_soon' || phase === 'sold_out';
  const scarce = phase === 'closing_soon';

  if (ticketTypes.length === 0) {
    return <p className="text-sm text-muted-foreground">Ticket details are coming soon.</p>;
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {ticketTypes.map((t) => {
        const availability = ticketAvailability(t, now);
        const inactive =
          showQuantities && (availability.kind === 'sold_out' || availability.kind === 'closed');
        const subtitle =
          availability.kind === 'closed' && t.salesEndsAt
            ? `Sales ended ${formatDhakaLong(t.salesEndsAt)}`
            : availability.kind === 'not_started' && t.salesStartsAt
              ? `On sale from ${formatDhakaLong(t.salesStartsAt)}`
              : null;

        return (
          <li
            key={t.id}
            className={cn(
              'flex items-start justify-between gap-2.5 rounded-xl border p-3.5',
              inactive
                ? 'border-border bg-secondary text-muted-foreground'
                : t.id === highlightId
                  ? 'border-[#f0d9ac] bg-accent'
                  : 'border-border bg-card',
              compact && 'items-center rounded-[10px]',
            )}
          >
            <div className="min-w-0">
              <div
                className={cn(
                  'font-semibold',
                  compact ? 'text-[15px]' : 'text-base',
                  inactive && 'line-through',
                )}
              >
                {t.name}
              </div>
              {subtitle && showQuantities ? (
                <div className="mt-0.5 text-[13px] text-muted-foreground tabular">{subtitle}</div>
              ) : null}
              {compact && showQuantities && availability.kind === 'left' ? (
                <div
                  className={cn(
                    'mt-0.5 text-[13px] font-medium',
                    scarce || t.id === highlightId ? 'text-accent-ink' : 'text-[#17603b]',
                  )}
                >
                  {availability.count} left
                </div>
              ) : null}
              {compact && showQuantities && availability.kind === 'sold_out' ? (
                <div className="mt-0.5 text-[13px] text-muted-foreground">Sold out</div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
              <Money
                paisa={t.pricePaisa}
                className={cn('font-heading font-bold', compact ? 'text-[18px]' : 'text-[17px]')}
              />
              {!compact && showQuantities ? (
                availability.kind === 'left' ? (
                  <Chip size="sm" tone={scarce ? 'warning' : 'success'}>
                    {availability.count} left
                  </Chip>
                ) : availability.kind === 'sold_out' ? (
                  <Chip size="sm" tone="neutralStrong">
                    Sold out
                  </Chip>
                ) : availability.kind === 'closed' ? (
                  <Chip size="sm" tone="neutralStrong">
                    Closed
                  </Chip>
                ) : (
                  <Chip size="sm" tone="info">
                    Not yet
                  </Chip>
                )
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
