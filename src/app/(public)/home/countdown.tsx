'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/**
 * Time left until `targetMs`, split for the four cells; all zero once it
 * has passed. Seconds round UP, so the cells read 0 at the target itself
 * (the moment the page refreshes), not a second early.
 */
export function countdownParts(targetMs: number, nowMs: number): CountdownParts {
  let s = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
  const days = Math.floor(s / 86_400);
  s %= 86_400;
  const hours = Math.floor(s / 3_600);
  s %= 3_600;
  return { days, hours, minutes: Math.floor(s / 60), seconds: s % 60 };
}

const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * The timer's accessible name, to the minute: it changes once a minute,
 * so a screen reader that re-reads it never hears the seconds churn.
 */
export function countdownLabel(label: string, { days, hours, minutes }: CountdownParts): string {
  return `${label} ${count(days, 'day')}, ${count(hours, 'hour')}, ${count(minutes, 'minute')}`;
}

/** Before hydration: same cells, same size, no numbers — nothing jumps when they fill in. */
const PLACEHOLDER = '–';
const pad = (n: number) => String(n).padStart(2, '0');
/** Waits between refreshes once the countdown has reached zero. */
const RETRY_DELAYS_MS = [0, 3_000, 10_000, 30_000];

/**
 * N6 countdown, a client island inside the hero's phase panel. The server
 * renders placeholder cells; the phase sentence above already carries the
 * exact Dhaka time, so a blocked script or a paused tab never hides the
 * deadline.
 *
 * Ticks every second while the tab is visible and sleeps while it is
 * hidden. At zero the phase has changed — sales opened or registration
 * closed — so it asks the server for the new hero. A phone clock a few
 * seconds fast reaches zero before the server does and gets the same hero
 * back, so it asks again a few times, further apart (with a little jitter,
 * so a room full of phones doesn't ask at the same instant), then stops.
 * A new target (the hero keys this component by it) starts afresh.
 */
export function Countdown({ label, target }: { label: string; target: string }) {
  const router = useRouter();
  const targetMs = new Date(target).getTime();
  const [now, setNow] = useState<number | null>(null);
  const attempts = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      if (at >= targetMs) {
        // Bounded: a badly skewed clock must not refresh forever.
        if (attempts.current < RETRY_DELAYS_MS.length) {
          const wait = RETRY_DELAYS_MS[attempts.current] + Math.random() * 1_000;
          attempts.current += 1;
          timer = setTimeout(() => {
            router.refresh();
            tick();
          }, wait);
        }
        return;
      }
      // Wake as the next second turns over, so the seconds cell neither
      // skips nor lingers the way a free-running 1s interval drifts.
      timer = setTimeout(tick, (targetMs - at) % 1000 || 1000);
    };
    const onVisibility = () => {
      clearTimeout(timer);
      if (!document.hidden) tick();
    };
    // Deferred like the order page's countdown: hydration first renders the
    // same placeholder cells as the server did.
    timer = setTimeout(() => {
      if (!document.hidden) tick();
    }, 0);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [targetMs, router]);

  const parts = now === null ? null : countdownParts(targetMs, now);
  const cells = [
    {
      key: 'days',
      value: parts ? String(parts.days) : PLACEHOLDER,
      unit: parts?.days === 1 ? 'day' : 'days',
    },
    { key: 'hours', value: parts ? pad(parts.hours) : PLACEHOLDER, unit: 'hours' },
    { key: 'minutes', value: parts ? pad(parts.minutes) : PLACEHOLDER, unit: 'minutes' },
    { key: 'seconds', value: parts ? pad(parts.seconds) : PLACEHOLDER, unit: 'seconds' },
  ];

  return (
    // aria-live off: no per-second announcements. The name says it all, to
    // the minute, so the visible label and cells are hidden from the tree.
    <div
      role="timer"
      aria-live="off"
      aria-label={parts ? countdownLabel(label, parts) : label}
      className="flex flex-col gap-2 print:hidden"
    >
      <span
        aria-hidden="true"
        className="text-xs font-medium tracking-[0.14em] text-[#a8a29a] uppercase"
      >
        {label}
      </span>
      <div aria-hidden="true" className="grid max-w-100 grid-cols-4 gap-2">
        {cells.map((c) => (
          <div
            key={c.key}
            className="flex min-w-0 flex-col gap-1 rounded-[8px] border border-[#33302a] bg-[#1c1a17] p-3"
          >
            <span className="font-mono text-[24px] leading-none font-medium text-[#fbfaf8] tabular lg:text-[30px]">
              {c.value}
            </span>
            <span className="text-xs text-[#a8a29a]">{c.unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
