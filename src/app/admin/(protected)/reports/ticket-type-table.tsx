import { formatBDT } from '@/server/lib/money';
import { percent } from '@/server/lib/sales-report';
import type { SalesReport } from '@/server/services/reports.service';
import { Money } from '@/components/money';
import { ProgressBar } from '@/components/progress-bar';
import { formatCount, ReportCard } from './report-card';

/**
 * B12 "Sold per ticket type": seats from the inventory counters (sold is
 * net of cancellations — the number the public stock shows), money from
 * verified buyer orders on that type (comps are a column of their own, B13).
 * A type with no sales is still a row.
 * Phones get a card per type instead of a nine-column table.
 */
export function TicketTypeTable({ report }: { report: SalesReport }) {
  const rows = report.byTicketType;
  const total = rows.reduce(
    (t, r) => ({
      seats: t.seats + r.quantityTotal,
      sold: t.sold + r.quantitySold,
      held: t.held + r.quantityReserved,
      comp: t.comp + r.compTickets,
      orders: t.orders + r.orderCount,
      revenue: t.revenue + r.revenuePaisa,
    }),
    { seats: 0, sold: 0, held: 0, comp: 0, orders: 0, revenue: 0 },
  );
  const left = (r: (typeof rows)[number]) =>
    Math.max(0, r.quantityTotal - r.quantitySold - r.quantityReserved);
  // B13: the column exists only once there is something to show.
  const hasComps = total.comp > 0;

  const notes: string[] = [];
  if (hasComps) {
    notes.push(
      `${formatCount(total.comp)} complimentary ${total.comp === 1 ? 'ticket is' : 'tickets are'} counted as sold at ${formatBDT(0)}; they are not in Orders or Revenue.`,
    );
  }
  if (report.revenue.discountPaisa > 0) {
    notes.push(
      `Discounts of ${formatBDT(report.revenue.discountPaisa)} are already taken off these figures.`,
    );
  }
  if (report.cancelledTickets > 0) {
    notes.push(
      `${formatCount(report.cancelledTickets)} cancelled ${report.cancelledTickets === 1 ? 'ticket is' : 'tickets are'} not counted as sold; the money was returned outside the app.`,
    );
  }

  return (
    <ReportCard
      title="Sold per ticket type"
      subtitle="Seats from live inventory · revenue from verified orders"
      testId="ticket-types"
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No ticket types yet — add them on the event before publishing.
        </p>
      ) : (
        <>
          <table className="hidden w-full text-[13px] md:table print:table">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 text-right font-medium">Price</th>
                <th className="py-2 pr-3 text-right font-medium">Seats</th>
                <th className="py-2 pr-3 text-right font-medium">Sold</th>
                {hasComps ? <th className="py-2 pr-3 text-right font-medium">Comp</th> : null}
                <th className="py-2 pr-3 text-right font-medium">Held</th>
                <th className="py-2 pr-3 text-right font-medium">Left</th>
                <th className="w-[18%] py-2 pr-3 font-medium">Sold %</th>
                <th className="py-2 pr-3 text-right font-medium">Orders</th>
                <th className="py-2 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.ticketTypeId}
                  className="border-b border-border"
                  data-testid="ticket-type-row"
                >
                  <td className="py-2.5 pr-3 font-medium">{r.name}</td>
                  <td className="py-2.5 pr-3 text-right tabular">
                    <Money paisa={r.pricePaisa} />
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular">{formatCount(r.quantityTotal)}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold tabular">
                    {formatCount(r.quantitySold)}
                  </td>
                  {hasComps ? (
                    <td className="py-2.5 pr-3 text-right tabular" data-testid="ticket-type-comp">
                      {formatCount(r.compTickets)}
                    </td>
                  ) : null}
                  <td className="py-2.5 pr-3 text-right tabular">
                    {formatCount(r.quantityReserved)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular">{formatCount(left(r))}</td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <ProgressBar
                        total={r.quantityTotal}
                        sold={r.quantitySold}
                        held={r.quantityReserved}
                        complete={r.quantityTotal > 0 && left(r) === 0 && r.quantityReserved === 0}
                        label={`${r.name}: ${r.quantitySold} of ${r.quantityTotal} sold`}
                      />
                      <span className="w-9 text-right text-[12px] text-muted-foreground tabular">
                        {percent(r.quantitySold, r.quantityTotal)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular">{formatCount(r.orderCount)}</td>
                  <td className="py-2.5 text-right tabular">
                    <Money paisa={r.revenuePaisa} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold" data-testid="ticket-type-total">
                <td className="py-2.5 pr-3">Total</td>
                <td className="py-2.5 pr-3" />
                <td className="py-2.5 pr-3 text-right tabular">{formatCount(total.seats)}</td>
                <td className="py-2.5 pr-3 text-right tabular">{formatCount(total.sold)}</td>
                {hasComps ? (
                  <td className="py-2.5 pr-3 text-right tabular">{formatCount(total.comp)}</td>
                ) : null}
                <td className="py-2.5 pr-3 text-right tabular">{formatCount(total.held)}</td>
                <td className="py-2.5 pr-3 text-right tabular">
                  {formatCount(Math.max(0, total.seats - total.sold - total.held))}
                </td>
                <td className="py-2.5 pr-3 text-[12px] text-muted-foreground tabular">
                  {percent(total.sold, total.seats)}%
                </td>
                <td className="py-2.5 pr-3 text-right tabular">{formatCount(total.orders)}</td>
                <td className="py-2.5 text-right tabular">
                  <Money paisa={total.revenue} />
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Phone layout */}
          <ul className="flex flex-col gap-3 md:hidden print:hidden">
            {rows.map((r) => (
              <li
                key={r.ticketTypeId}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{r.name}</span>
                  <Money paisa={r.revenuePaisa} className="font-semibold" />
                </div>
                <ProgressBar
                  total={r.quantityTotal}
                  sold={r.quantitySold}
                  held={r.quantityReserved}
                  label={`${r.name}: ${r.quantitySold} of ${r.quantityTotal} sold`}
                />
                <p className="text-[12px] text-muted-foreground tabular">
                  {formatCount(r.quantitySold)} sold
                  {r.compTickets > 0 ? ` (${formatCount(r.compTickets)} comp)` : ''} ·{' '}
                  {formatCount(r.quantityReserved)} held · {formatCount(left(r))} left of{' '}
                  {formatCount(r.quantityTotal)} · <Money paisa={r.pricePaisa} /> each
                </p>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-3 px-1 font-semibold">
              <span>
                Total · {formatCount(total.sold)} of {formatCount(total.seats)}
              </span>
              <Money paisa={total.revenue} />
            </li>
          </ul>
        </>
      )}
      {notes.length > 0 ? (
        <p className="text-[13px] text-muted-foreground" data-testid="ticket-type-notes">
          {notes.join(' ')}
        </p>
      ) : null}
    </ReportCard>
  );
}
