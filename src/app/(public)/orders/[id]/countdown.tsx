'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * ADR-054: the 20-minute hold clock, mm:ss. Counted on the SERVER's clock:
 * the page passes its render time, and the offset to this phone's clock is
 * taken once, so a phone a few minutes out still shows the true time left.
 * The server renders the absolute Dhaka deadline beside it, so a blocked
 * script or a paused tab never hides when the hold ends.
 *
 * At 0:00 the clock says "Time's up" and nothing more: the server still
 * takes a transaction ID until `cutoff`, but that grace is never announced
 * (ADR-054) — the form simply keeps working. At `cutoff` the page refreshes
 * and the server draws the expired frame.
 */

const WARN_MS = 5 * 60_000;

/**
 * Server minus phone clock, measured ONCE per page load: a remount (Back to
 * this page from the router cache) carries an old `serverNow`, and measuring
 * again then would skew the clock by the age of that render.
 */
let clockOffset: number | null = null;

/** m:ss, or h:mm:ss for a hold placed before ADR-054 (24 hours long). */
function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function Countdown({
  until,
  cutoff,
  serverNow,
}: {
  /** When the hold ends on the buyer's clock (ISO). */
  until: string;
  /** When the server stops taking a trxID (ISO): the page refreshes then. */
  cutoff: string;
  /** The server's clock when it rendered the page (ISO). */
  serverNow: string;
}) {
  const router = useRouter();
  const target = Date.parse(until);
  const end = Date.parse(cutoff);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // Network latency aside, the server's clock from here on.
    clockOffset ??= Date.parse(serverNow) - Date.now();
    const tick = () => setNow(Date.now() + (clockOffset ?? 0));
    // First tick deferred so hydration renders what the server did (nothing).
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [serverNow]);

  const lapsed = now !== null && now >= end;
  useEffect(() => {
    if (lapsed) router.refresh();
  }, [lapsed, router]);

  if (now === null) return null;
  const left = target - now;
  const minutesLeft = Math.max(0, Math.ceil(left / 60_000));
  return (
    <span className="flex flex-col gap-1" data-testid="hold-countdown">
      <span
        aria-hidden
        className={cn(
          'font-mono text-4xl leading-none font-semibold tabular',
          left <= 0 ? 'text-[#a32e1e]' : left <= WARN_MS ? 'text-[#a65b00]' : 'text-foreground',
        )}
      >
        {clock(left)}
      </span>
      {/* Once a minute for screen readers, not every second. */}
      <span className="sr-only" aria-live="polite">
        {left > 0
          ? `${minutesLeft} ${minutesLeft === 1 ? 'minute' : 'minutes'} left to pay`
          : 'Time is up'}
      </span>
      {left <= 0 ? (
        <span className="text-sm font-semibold text-[#a32e1e]">Time&apos;s up.</span>
      ) : null}
    </span>
  );
}
