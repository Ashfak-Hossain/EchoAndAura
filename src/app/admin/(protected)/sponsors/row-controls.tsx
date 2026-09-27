'use client';

import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { setSponsorActiveAction, setSponsorPositionAction } from './actions';
import { useAnnounce } from './list-status';

type Control = 'up' | 'down' | 'input';

/**
 * B15 order controls: ▲ / ▼ and the number field, which saves on Enter or
 * when it loses focus — never per keystroke. There is no drag handle.
 *
 * A move re-renders the list in its new order, and the browser drops
 * focus from a row React moves. So the control that made the move takes
 * focus back once the row has its new place (`position` changes); an arrow
 * that is now disabled at the end hands it to the number field.
 */
export function OrderControls({
  id,
  name,
  position,
  count,
}: {
  id: string;
  name: string;
  /** 1-based place within the level. */
  position: number;
  /** How many sponsors the level has. */
  count: number;
}) {
  const announce = useAnnounce();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(String(position));
  const [shown, setShown] = useState(position);
  const refocus = useRef<Control | null>(null);
  // Where focus went when the field was left (Tab, Shift+Tab, a click).
  // If the save then moves this row, React re-inserts it and the browser
  // drops that focus to <body>; it is put back once the row has landed.
  const blurTarget = useRef<HTMLElement | null>(null);
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const first = position <= 1;
  const last = position >= count;

  // The server's order wins whenever it changes, ours or someone else's.
  if (shown !== position) {
    setShown(position);
    setDraft(String(position));
  }

  useEffect(() => {
    const went = blurTarget.current;
    blurTarget.current = null;
    if (
      went?.isConnected &&
      (document.activeElement === document.body || document.activeElement === null)
    ) {
      went.focus();
    }
    const control = refocus.current;
    if (!control) return;
    refocus.current = null;
    const target =
      control === 'up' && !first
        ? upRef.current
        : control === 'down' && !last
          ? downRef.current
          : inputRef.current;
    target?.focus();
  }, [position, first, last]);

  function move(to: number, control: Control | null) {
    const target = Math.min(Math.max(to, 1), count);
    if (pending || target === position) {
      blurTarget.current = null;
      setDraft(String(position));
      return;
    }
    setError(null);
    refocus.current = control;
    start(async () => {
      try {
        const r = await setSponsorPositionAction(id, target);
        if (r.ok) {
          announce('Order saved.');
          return;
        }
        refocus.current = null;
        blurTarget.current = null;
        setDraft(String(position));
        setError(r.error);
      } catch {
        refocus.current = null;
        blurTarget.current = null;
        setDraft(String(position));
        setError('Could not move it. Please try again.');
      }
    });
  }

  function commitDraft(control: Control | null) {
    const n = Number(draft.trim());
    if (draft.trim() === '' || !Number.isInteger(n)) {
      blurTarget.current = null;
      setDraft(String(position));
      return;
    }
    move(n, control);
  }

  // aria-disabled, not disabled, while a move is in flight: a disabled
  // button would lose focus mid-move.
  const arrow = (disabled: boolean) =>
    cn(
      'flex items-center justify-center rounded-md text-[10px] leading-none text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:text-border-strong disabled:hover:bg-transparent aria-disabled:cursor-wait',
      'size-11 border border-border-strong bg-card lg:h-[18px] lg:w-7 lg:border-0 lg:bg-transparent',
      disabled && 'border-border',
    );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          min={1}
          max={count}
          value={draft}
          aria-label={`Display order for ${name}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft('input');
            }
            if (e.key === 'Escape') setDraft(String(position));
          }}
          // Leaving the field saves too, but focus stays where the admin went.
          onBlur={(e) => {
            blurTarget.current = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null;
            commitDraft(null);
          }}
          className="h-11 w-12 rounded-lg border border-border-strong bg-card text-center font-mono text-sm font-medium tabular outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 lg:h-9"
        />
        <div className="flex gap-1 lg:flex-col lg:gap-0">
          <button
            ref={upRef}
            type="button"
            aria-label={`Move ${name} up`}
            disabled={first}
            aria-disabled={pending || undefined}
            onClick={() => move(position - 1, 'up')}
            className={arrow(first)}
          >
            <span aria-hidden="true">▲</span>
          </button>
          <button
            ref={downRef}
            type="button"
            aria-label={`Move ${name} down`}
            disabled={last}
            aria-disabled={pending || undefined}
            onClick={() => move(position + 1, 'down')}
            className={arrow(last)}
          >
            <span aria-hidden="true">▼</span>
          </button>
        </div>
      </div>
      {error ? (
        <span role="alert" className="text-xs font-medium text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * B15 Active switch, after promo codes' ActiveSwitch: flips at once
 * (optimistic), settles on the server's answer, springs back and says why
 * on failure. A hidden sponsor is kept, just not shown on the site.
 */
export function SponsorActiveSwitch({
  id,
  name,
  active,
}: {
  id: string;
  name: string;
  active: boolean;
}) {
  const announce = useAnnounce();
  const [optimistic, setOptimistic] = useOptimistic(active);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className="flex h-11 items-center gap-2.5 text-sm">
        <Switch
          checked={optimistic}
          disabled={pending}
          aria-label={`Show ${name} on the site`}
          onCheckedChange={(next: boolean) => {
            setError(null);
            start(async () => {
              setOptimistic(next);
              try {
                const r = await setSponsorActiveAction(id, next);
                if (r.ok) announce(`${name} is now ${next ? 'active' : 'hidden'}.`);
                else setError(r.error);
              } catch {
                setError('Could not change it. Please try again.');
              }
            });
          }}
        />
        {/* The switch's state is read out already; this is for the eye. */}
        <span aria-hidden="true">{optimistic ? 'Active' : 'Hidden'}</span>
      </span>
      {error ? (
        <span role="alert" className="text-xs font-medium text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
