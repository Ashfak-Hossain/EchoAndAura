import type { TicketTypeRecord } from '@/server/repositories/ticket-types.repository';
import { ButtonLink } from '@/components/button-link';
import { EmptyState } from '@/components/empty-state';
import { Money } from '@/components/money';
import { Chip } from '@/components/status-chip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TICKET_TYPE_SALE_STATE_LABELS, ticketTypeSaleState } from '@/lib/status-labels';
import { formatDhaka } from '@/lib/time';

interface Props {
  eventId: string;
  ticketTypes: TicketTypeRecord[];
}

// B6: Available is the computed column and the only one in bold — it is the
// number that decides everything downstream. Row chips say *why* a type is
// not selling so Raj never has to work it out from the numbers.
export function TicketTypesSection({ eventId, ticketTypes }: Props) {
  const now = new Date();
  const totals = ticketTypes.reduce(
    (acc, t) => ({
      total: acc.total + t.quantityTotal,
      sold: acc.sold + t.quantitySold,
      held: acc.held + t.quantityReserved,
    }),
    { total: 0, sold: 0, held: 0 },
  );
  const addHref = `/admin/events/${eventId}/ticket-types/new`;

  if (ticketTypes.length === 0) {
    return (
      <section aria-labelledby="ticket-types-heading" className="flex flex-col gap-4">
        <h2 id="ticket-types-heading" className="sr-only">
          Ticket types
        </h2>
        <EmptyState
          title="Add your first ticket type"
          description="A name, a price and how many exist. You can add Early Bird later as a second type with its own end date."
          action={<ButtonLink href={addHref}>Add ticket type</ButtonLink>}
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="ticket-types-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ticket-types-heading" className="text-xl">
          Ticket types
        </h2>
        <ButtonLink href={addHref}>Add ticket type</ButtonLink>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Sold</TableHead>
              <TableHead className="text-right">Held</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead>Sales window (Dhaka)</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ticketTypes.map((tt) => {
              const state = ticketTypeSaleState(tt, now);
              const available = tt.quantityTotal - tt.quantitySold - tt.quantityReserved;
              return (
                <TableRow key={tt.id}>
                  <TableCell className="font-medium">
                    <span className="flex flex-wrap items-center gap-2">
                      {tt.name}
                      {state ? (
                        <Chip tone={TICKET_TYPE_SALE_STATE_LABELS[state].tone}>
                          {TICKET_TYPE_SALE_STATE_LABELS[state].label}
                        </Chip>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money paisa={tt.pricePaisa} />
                  </TableCell>
                  <TableCell className="text-right tabular">{tt.quantityTotal}</TableCell>
                  <TableCell className="text-right tabular">{tt.quantitySold}</TableCell>
                  <TableCell className="text-right tabular">{tt.quantityReserved}</TableCell>
                  <TableCell className="text-right font-semibold tabular">{available}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {tt.salesStartsAt || tt.salesEndsAt
                      ? `${tt.salesStartsAt ? formatDhaka(tt.salesStartsAt) : 'any time'} → ${
                          tt.salesEndsAt ? formatDhaka(tt.salesEndsAt) : 'no end'
                        }`
                      : 'always on sale'}
                  </TableCell>
                  <TableCell className="text-right">
                    <ButtonLink
                      variant="ghost"
                      size="sm"
                      href={`/admin/events/${eventId}/ticket-types/${tt.id}/edit`}
                    >
                      Edit
                    </ButtonLink>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-muted-foreground tabular">
        {totals.total} tickets across {ticketTypes.length}{' '}
        {ticketTypes.length === 1 ? 'type' : 'types'} · {totals.sold} sold · {totals.held} held ·{' '}
        {totals.total - totals.sold - totals.held} available. Sold-out types cannot be deleted, only
        closed by setting a sales end date.
      </p>
    </section>
  );
}
