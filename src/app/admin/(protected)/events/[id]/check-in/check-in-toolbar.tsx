'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { SearchBox } from '@/components/admin/search-box';
import { cn } from '@/lib/utils';

const SHOW = [
  ['all', 'All'],
  ['in', 'In'],
  ['out', 'Not yet'],
] as const;

/**
 * B11 toolbar: one search box, written to `?q=`, and (ADR-030) who to show
 * — everyone, only those checked in, only those not yet in — as `?show=`.
 * The sort stays in the URL.
 */
export function CheckInToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  // Clear remounts the search box so its draft and any pending debounce die with it.
  const [generation, setGeneration] = useState(0);

  const rawShow = params.get('show');
  const show = rawShow === 'in' || rawShow === 'out' ? rawShow : 'all';

  const replace = (next: URLSearchParams) => {
    // One-shot flash params from the gate-pass actions must not follow a search.
    for (const once of ['pass', 'revoked', 'undone']) next.delete(once);
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  };
  const navigate = (q: string) => {
    const next = new URLSearchParams(params.toString());
    if (q) next.set('q', q);
    else next.delete('q');
    replace(next);
  };
  const setShow = (value: (typeof SHOW)[number][0]) => {
    const next = new URLSearchParams(params.toString());
    if (value === 'all') next.delete('show');
    else next.set('show', value);
    replace(next);
  };

  return (
    <div
      className="flex w-full flex-wrap items-center gap-2"
      role="search"
      aria-label="Search check-in list"
    >
      <SearchBox
        key={generation}
        value={params.get('q') ?? ''}
        onSearch={navigate}
        placeholder="Search name, code or reference"
        pending={pending}
      />
      <div
        role="group"
        aria-label="Show"
        className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-card p-0.5"
      >
        {SHOW.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={show === value}
            onClick={() => setShow(value)}
            className={cn(
              'h-full rounded-md px-3 text-[13px] font-semibold',
              show === value
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {params.get('q') ? (
        <button
          type="button"
          onClick={() => {
            setGeneration((g) => g + 1);
            navigate('');
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
