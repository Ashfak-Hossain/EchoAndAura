'use client';

import { useEffect, useState } from 'react';

/**
 * S6 Countdown to the hold expiry. Server renders the absolute Dhaka time
 * beside it, so a paused tab or a blocked script never hides the deadline.
 */
export function Countdown({ until }: { until: string }) {
  const target = new Date(until).getTime();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // First tick is deferred so hydration renders the same (empty) output as the server.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  if (now === null) return null;
  const ms = target - now;
  if (ms <= 0) return <span className="font-semibold tabular">expired</span>;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return (
    <span className="font-mono font-medium tabular">
      {h}h {m}m
    </span>
  );
}
