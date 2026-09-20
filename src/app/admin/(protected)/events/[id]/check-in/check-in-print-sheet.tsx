import type { EventRecord } from '@/server/repositories/events.repository';
import { ORGANIZER_NAME } from '@/content/site';
import { organizerPhone } from '@/lib/env.public';
import { formatDhaka, formatDhakaLong } from '@/lib/time';
import type { CheckInRowData } from './columns';

interface Props {
  event: EventRecord;
  /** The rows on screen (the current search), sorted name A–Z by the page. */
  rows: readonly CheckInRowData[];
  /** Issued tickets for the event, before any search. */
  total: number;
  /** The search in force, if any — the sheet must say so. */
  query: string;
  /** When the rows were read (the page render), not when the dialog opened. */
  asOf: Date;
}

/**
 * B11 print sheet (A4, black and white). A separate plain table rather than
 * print CSS on the DataTable: that table is `hidden lg:flex`, and an A4
 * page is narrower than `lg`, so in print it would vanish and the phone
 * list would print instead. `<thead>` repeats on every page natively; page
 * numbers need `@page` margin boxes, which Chrome and Safari do not
 * implement, so the sheet carries the count and the data time instead.
 * The Print button is disabled under a search, but ⌘P is not, so a partial
 * list labels itself: an unlabelled subset looks like the whole door list.
 */
export function CheckInPrintSheet({ event, rows, total, query, asOf }: Props) {
  const phone = organizerPhone();
  return (
    <section
      data-testid="check-in-print-sheet"
      aria-label="Printable check-in list"
      className="hidden text-[13px] leading-snug text-black print:block"
    >
      <header className="mb-4 flex items-end justify-between gap-6 border-b-2 border-black pb-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{event.title}</h1>
          <p>
            {formatDhakaLong(event.startsAt)} (Dhaka)
            {event.venue ? ` · ${event.venue}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="font-semibold">Check-in list</p>
          <p>
            {query ? `${rows.length} of ${total}` : total} {total === 1 ? 'name' : 'names'} · as of{' '}
            {formatDhaka(asOf)}
          </p>
        </div>
      </header>
      {query ? (
        <p className="mb-3 border-2 border-black px-2 py-1 font-semibold uppercase">
          Partial list — search “{query}” applied. Not the full door list.
        </p>
      ) : null}

      <table className="w-full border-collapse">
        <thead className="table-header-group">
          <tr className="border-b border-black text-left text-[11px] font-semibold tracking-[0.04em] uppercase">
            <th scope="col" className="w-9 py-1.5">
              <span className="sr-only">Checked in</span>
            </th>
            <th scope="col" className="py-1.5 pr-3">
              Attendee
            </th>
            <th scope="col" className="py-1.5 pr-3">
              Type
            </th>
            <th scope="col" className="py-1.5 pr-3">
              Ticket code
            </th>
            <th scope="col" className="py-1.5">
              Order
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="break-inside-avoid border-b border-black/40">
              <td className="py-1.5 align-middle">
                {/* 28px box, wide enough for a pen. */}
                <span aria-hidden="true" className="block size-7 border border-black" />
              </td>
              <td className="py-1.5 pr-3 align-middle font-medium">{row.attendeeName}</td>
              <td className="py-1.5 pr-3 align-middle">{row.ticketTypeName}</td>
              <td className="py-1.5 pr-3 align-middle font-mono">{row.code}</td>
              <td className="py-1.5 align-middle font-mono">{row.orderReference}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="mt-4 flex justify-between gap-6 border-t border-black pt-2 text-[11px]">
        <p>
          Cancelled tickets are not printed. Names can change until registration closes — reprint on
          the day if in doubt.
        </p>
        <p className="shrink-0">
          echoandaura · {ORGANIZER_NAME}
          {phone ? ` · ${phone}` : ''}
        </p>
      </footer>
    </section>
  );
}
