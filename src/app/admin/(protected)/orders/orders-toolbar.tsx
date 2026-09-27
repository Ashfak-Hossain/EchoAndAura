'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { SearchBox } from '@/components/admin/search-box';
import { Input } from '@/components/ui/input';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/status-labels';

export interface ToolbarEvent {
  id: string;
  title: string;
}

const select =
  'h-9 rounded-md border border-input bg-card px-2.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/**
 * B9 toolbar. Every control writes to the URL (`q`, `status`, `event`,
 * `from`, `to`) and the server re-renders — the URL stays the single
 * source of truth, so bookmarks, the back button and the CSV link agree.
 * The search box is debounced so typing feels instant; the selects apply
 * on change. `page` is dropped on every change (back to page 1).
 */
export function OrdersToolbar({ events }: { events: ToolbarEvent[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  // Clear remounts the search box so its draft and any pending debounce die
  // with it — otherwise a timer firing mid-navigation re-applies the term.
  const [generation, setGeneration] = useState(0);

  const navigate = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  };

  const filtered = Boolean(
    params.get('q') ||
    params.get('status') ||
    params.get('event') ||
    params.get('from') ||
    params.get('to'),
  );

  return (
    <div
      className="flex w-full flex-wrap items-center gap-2"
      role="search"
      aria-label="Search orders"
    >
      <SearchBox
        key={generation}
        value={params.get('q') ?? ''}
        onSearch={(term) => navigate({ q: term || null })}
        placeholder="Reference, email, phone or trxID"
        pending={pending}
      />

      <select
        aria-label="Status"
        value={params.get('status') ?? ''}
        onChange={(e) => navigate({ status: e.target.value || null })}
        className={select}
      >
        <option value="">All statuses</option>
        {(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((s) => (
          <option key={s} value={s}>
            {ORDER_STATUS_LABELS[s].label}
          </option>
        ))}
      </select>

      <select
        aria-label="Event"
        value={params.get('event') ?? ''}
        onChange={(e) => navigate({ event: e.target.value || null })}
        className={`${select} max-w-47.5`}
      >
        <option value="">All events</option>
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.title}
          </option>
        ))}
      </select>

      <Input
        type="date"
        aria-label="From"
        value={params.get('from') ?? ''}
        onChange={(e) => navigate({ from: e.target.value || null })}
        className="h-9 w-37 bg-card text-[13px]"
      />
      <span className="text-[13px] text-muted-foreground">–</span>
      <Input
        type="date"
        aria-label="To"
        value={params.get('to') ?? ''}
        onChange={(e) => navigate({ to: e.target.value || null })}
        className="h-9 w-37 bg-card text-[13px]"
      />

      {filtered ? (
        <button
          type="button"
          onClick={() => {
            setGeneration((g) => g + 1);
            startTransition(() => router.replace(pathname));
          }}
          className="inline-flex h-9 items-center gap-1 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
