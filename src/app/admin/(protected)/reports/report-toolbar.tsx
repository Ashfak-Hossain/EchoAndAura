'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { REPORT_RANGE_LABELS, REPORT_RANGES, type ReportRange } from '@/lib/report-range';
import { cn } from '@/lib/utils';

export interface ToolbarEvent {
  id: string;
  title: string;
}

const select =
  'h-9 max-w-full rounded-md border border-input bg-card px-2.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/**
 * B12 controls: the event and the range live in the URL (`?event=&range=`)
 * and the server re-renders, so a bookmark, the back button and the CSV
 * links all agree on what is being looked at.
 */
export function ReportToolbar({
  events,
  eventId,
  range,
}: {
  events: ToolbarEvent[];
  eventId: string;
  range: ReportRange;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const navigate = (next: { event: string; range: ReportRange }) => {
    const qs = new URLSearchParams({ event: next.event, range: next.range });
    startTransition(() => router.replace(`${pathname}?${qs.toString()}`));
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 transition-opacity',
        pending && 'opacity-60',
      )}
      aria-busy={pending}
    >
      <select
        aria-label="Event"
        value={eventId}
        onChange={(e) => navigate({ event: e.target.value, range })}
        className={select}
      >
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.title}
          </option>
        ))}
      </select>

      <div
        role="radiogroup"
        aria-label="Period"
        className="inline-flex h-9 items-center rounded-md border border-input bg-card p-0.5"
      >
        {REPORT_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={r === range}
            onClick={() => navigate({ event: eventId, range: r })}
            className={cn(
              'h-full rounded-[5px] px-2.5 text-[13px] font-medium transition-colors',
              r === range
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            {REPORT_RANGE_LABELS[r]}
          </button>
        ))}
      </div>
    </div>
  );
}
