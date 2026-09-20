'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Search, X } from 'lucide-react';
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
  const [q, setQ] = useState(params.get('q') ?? '');
  const lastPushed = useRef(params.get('q') ?? '');

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

  // Debounced search → URL. The ref stops a re-push of the value the URL already has.
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed === lastPushed.current) return;
    const t = setTimeout(() => {
      lastPushed.current = trimmed;
      navigate({ q: trimmed || null });
    }, 300);
    return () => clearTimeout(t);
    // navigate is recreated each render; the debounce keys on `q` only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

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
      <div className="relative w-[260px] max-w-full">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          name="q"
          aria-label="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              lastPushed.current = q.trim();
              navigate({ q: q.trim() || null });
            }
          }}
          placeholder="Reference, email, phone or trxID"
          maxLength={80}
          className="h-9 bg-card pl-8 text-[13px]"
        />
        {pending ? (
          <span className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-border-strong border-t-foreground" />
        ) : null}
      </div>

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
        className={`${select} max-w-[190px]`}
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
        className="h-9 w-[148px] bg-card text-[13px]"
      />
      <span className="text-[13px] text-muted-foreground">–</span>
      <Input
        type="date"
        aria-label="To"
        value={params.get('to') ?? ''}
        onChange={(e) => navigate({ to: e.target.value || null })}
        className="h-9 w-[148px] bg-card text-[13px]"
      />

      {filtered ? (
        <button
          type="button"
          onClick={() => {
            setQ('');
            lastPushed.current = '';
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
