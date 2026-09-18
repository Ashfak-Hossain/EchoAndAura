import Link from 'next/link';
import { ticketTypesService } from '@/server/container';
import { formatBDT } from '@/server/lib/money';
import { formatDhaka } from '@/lib/time';

interface Props {
  eventId: string;
}

// TEMPORARY DEMO MARKUP — becomes the "Ticket types" tab of the event hub
// (design B5/B6). Server component: reads through the service.
export async function TicketTypesSection({ eventId }: Props) {
  const ticketTypes = await ticketTypesService.listForEvent(eventId);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="ticket-types-heading">
      <div className="flex items-center justify-between">
        <h2 id="ticket-types-heading" className="text-lg font-semibold">
          Ticket types
        </h2>
        <Link
          href={`/admin/events/${eventId}/ticket-types/new`}
          className="rounded bg-black px-3 py-2 text-sm text-white"
        >
          Add ticket type
        </Link>
      </div>

      {ticketTypes.length === 0 ? (
        <p className="text-sm text-neutral-600">No ticket types yet — add at least one to publish.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">Name</th>
              <th className="py-2">Price</th>
              <th className="py-2">Total</th>
              <th className="py-2">Sold</th>
              <th className="py-2">Held</th>
              <th className="py-2">Available</th>
              <th className="py-2">Sales window (Dhaka)</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {ticketTypes.map((tt) => (
              <tr key={tt.id} className="border-b">
                <td className="py-2">{tt.name}</td>
                <td className="py-2 tabular-nums">{formatBDT(tt.pricePaisa)}</td>
                <td className="py-2 tabular-nums">{tt.quantityTotal}</td>
                <td className="py-2 tabular-nums">{tt.quantitySold}</td>
                <td className="py-2 tabular-nums">{tt.quantityReserved}</td>
                <td className="py-2 tabular-nums">
                  {tt.quantityTotal - tt.quantitySold - tt.quantityReserved}
                </td>
                <td className="py-2">
                  {tt.salesStartsAt || tt.salesEndsAt
                    ? `${tt.salesStartsAt ? formatDhaka(tt.salesStartsAt) : '…'} → ${
                        tt.salesEndsAt ? formatDhaka(tt.salesEndsAt) : '…'
                      }`
                    : '—'}
                </td>
                <td className="py-2 text-right">
                  <Link
                    href={`/admin/events/${eventId}/ticket-types/${tt.id}/edit`}
                    className="underline"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
