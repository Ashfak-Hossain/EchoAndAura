'use client';

import { useEffect, useState } from 'react';
import { formatBDT } from '@/server/lib/money';

/**
 * A number that counts up to its value on first paint (B12 KPIs). The
 * server renders the final value, so nothing jumps without JavaScript and
 * the print view is exact; the animation only runs after mount, and not
 * at all for people who asked for reduced motion.
 */
export function CountUp({
  value,
  money = false,
  duration = 700,
  className,
  'data-testid': testId,
}: {
  /** A count, or integer paisa when `money` is set. */
  value: number;
  /** Render as "৳1,234.56" (a function prop cannot cross the server/client boundary). */
  money?: boolean;
  duration?: number;
  className?: string;
  'data-testid'?: string;
}) {
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (value === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      // rAF timestamps mark the frame start and can precede `start` by a few
      // ms; without the lower clamp the ease dips negative (a negative paisa
      // throws in formatBDT).
      const t = Math.max(0, Math.min(1, (now - start) / duration));
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(value * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return (
    <span className={className} data-testid={testId}>
      {money ? formatBDT(shown) : shown.toLocaleString('en-US')}
    </span>
  );
}
