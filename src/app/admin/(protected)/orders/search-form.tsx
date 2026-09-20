import type { EventRecord } from '@/server/repositories/events.repository';
import { ButtonLink } from '@/components/button-link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/status-labels';
import type { OrdersSearchInput } from '@/lib/validation/orders-search';

const select =
  'h-11 rounded-md border border-input bg-card px-3 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/**
 * B9 search & filters. A plain GET form: the URL is the state, so the back
 * button, a bookmark and the CSV link all carry the same query. No client
 * JavaScript; the page re-renders on submit.
 */
export function SearchForm({
  input,
  events,
  exportHref,
}: {
  input: OrdersSearchInput;
  events: EventRecord[];
  exportHref: string;
}) {
  return (
    <form
      method="get"
      action="/admin/orders"
      role="search"
      aria-label="Search orders"
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 lg:flex-row lg:flex-wrap lg:items-end"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 lg:min-w-65">
        <Label htmlFor="orders-q">Search</Label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          >
            ⌕
          </span>
          <Input
            id="orders-q"
            name="q"
            type="search"
            defaultValue={input.q}
            placeholder="Reference, email, phone or trxID"
            className="h-11 pl-8"
            maxLength={80}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="orders-status">Status</Label>
        <select
          id="orders-status"
          name="status"
          defaultValue={input.status ?? ''}
          className={select}
        >
          <option value="">All</option>
          {(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABELS[s].label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="orders-event">Event</Label>
        <select
          id="orders-event"
          name="event"
          defaultValue={input.event ?? ''}
          className={`${select} max-w-65`}
        >
          <option value="">All events</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="orders-from">From</Label>
          <Input
            id="orders-from"
            name="from"
            type="date"
            defaultValue={input.from ?? ''}
            className="h-11"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="orders-to">To</Label>
          <Input
            id="orders-to"
            name="to"
            type="date"
            defaultValue={input.to ?? ''}
            className="h-11"
          />
        </div>
      </div>

      <div className="flex gap-2 lg:ml-auto">
        <button
          type="submit"
          className="inline-flex h-11 items-center rounded-lg border border-foreground bg-foreground px-5 text-[15px] font-semibold text-background hover:bg-[#33302a]"
        >
          Apply
        </button>
        <ButtonLink href={exportHref} variant="secondary" prefetch={false}>
          Export CSV
        </ButtonLink>
      </div>
    </form>
  );
}
