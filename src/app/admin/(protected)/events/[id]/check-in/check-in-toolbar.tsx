'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { SearchBox } from '@/components/admin/search-box';

/** B11 toolbar: one search box, written to `?q=`; the sort stays in the URL. */
export function CheckInToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  // Clear remounts the search box so its draft and any pending debounce die with it.
  const [generation, setGeneration] = useState(0);

  const navigate = (q: string) => {
    const next = new URLSearchParams(params.toString());
    if (q) next.set('q', q);
    else next.delete('q');
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
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
