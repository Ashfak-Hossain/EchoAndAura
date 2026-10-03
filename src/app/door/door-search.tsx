'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDhakaClock } from '@/lib/time';
import { cn } from '@/lib/utils';
import { type WireSearchResult, doorApi } from './door-api';

/**
 * Find someone by name when their QR will not scan (a cracked screen, a
 * dead phone). Admitting from a name is the easiest thing to abuse, so it
 * is two steps: staff ask for the last 3 digits of the phone that BOUGHT
 * the ticket and type what they hear; the server checks them. The digits
 * are never on this screen — not even part of the number: an impostor
 * could read them off it — and these admits have their own, tighter rate
 * budget.
 *
 * ADR-034: without signal the search runs on the phone's offline list, so
 * staff can still see who someone is and whether they are in — but cannot
 * admit by name, because only the server can check the digits.
 */
export function DoorSearch({
  busy,
  offlineMode,
  searchOffline,
  onAdmit,
  onClose,
  onSignedOut,
}: {
  busy: boolean;
  /** Known to be offline: search the phone's list, not the server. */
  offlineMode: boolean;
  searchOffline: (term: string) => Promise<WireSearchResult[] | null>;
  /** `phoneLast3`: what the person said; omitted only for a comp (no phone on file). */
  onAdmit: (row: WireSearchResult, phoneLast3?: string) => void;
  onClose: () => void;
  onSignedOut: (message: string) => void;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<WireSearchResult[] | null>(null);
  /** The rows came from the offline list: nobody can be admitted from them. */
  const [local, setLocal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<WireSearchResult | null>(null);
  const [digits, setDigits] = useState('');

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let live = true;
    const fromList = async (): Promise<boolean> => {
      const found = await searchOffline(term);
      if (!live || found === null) return false;
      setRows(found);
      setLocal(true);
      setError(null);
      return true;
    };
    const timer = setTimeout(async () => {
      if (offlineMode && (await fromList())) return;
      const reply = await doorApi.search(term);
      if (!live) return;
      if (reply.ok) {
        setRows(reply.data.results);
        setLocal(false);
        setError(null);
      } else if (reply.kind === 'signed_out') {
        onSignedOut(reply.message);
      } else if (reply.kind === 'slow') {
        setError(`Slow down — wait ${reply.retryAfter} s.`);
      } else if (reply.kind === 'network') {
        if (await fromList()) return;
        if (live) setError('No connection. Use the printed list if it does not come back.');
      } else {
        setError(reply.message);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, onSignedOut, offlineMode, searchOffline]);

  const handle = <span aria-hidden className="h-1 w-9 self-center rounded-full bg-white/25" />;

  if (confirming) {
    return (
      <>
        <div aria-hidden className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
        <section
          aria-label="Confirm admit"
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-3 rounded-t-[20px] bg-[#231f1b] px-4 pt-2.5 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          {handle}
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="font-heading text-xl font-extrabold text-white">
              {confirming.phoneOnFile ? 'Last 3 digits of buyer’s phone' : 'Complimentary ticket'}
            </h2>
            <p className="truncate text-sm text-white/75">
              {confirming.attendeeName} · {confirming.ticketTypeName}
            </p>
          </div>
          {confirming.phoneOnFile ? (
            <>
              <label className="relative block w-fit">
                <span className="sr-only">Last 3 digits of the buying phone</span>
                <span aria-hidden className="grid grid-cols-[repeat(3,52px)] gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        'flex h-15 items-center justify-center rounded-[10px] border-2 bg-[#161412] font-mono text-[26px] text-white',
                        i === Math.min(digits.length, 2) ? 'border-[#eda43c]' : 'border-white/20',
                      )}
                    >
                      {digits[i] ?? ''}
                    </span>
                  ))}
                </span>
                <input
                  value={digits}
                  onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  autoFocus
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={3}
                  aria-label="Last 3 digits of the buying phone"
                  className="absolute inset-0 opacity-0"
                />
              </label>
              <p className="text-[13px] text-white/55">
                Ask them — it may be a friend’s phone. Do not show this screen.
              </p>
            </>
          ) : (
            <p className="text-[15px] leading-snug text-white/85">
              There is no phone on file. Check the name with the organizer before letting them in.
            </p>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(null);
                setDigits('');
              }}
              className="h-14 truncate rounded-[14px] border border-white/20 text-base text-white"
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy || (confirming.phoneOnFile && digits.length !== 3)}
              onClick={() => onAdmit(confirming, confirming.phoneOnFile ? digits : undefined)}
              className="h-14 truncate rounded-[14px] bg-[#eda43c] px-2 font-heading text-lg font-extrabold text-[#161412] disabled:opacity-50"
            >
              {confirming.phoneOnFile ? 'Check and admit' : 'Admit'}
            </button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <div aria-hidden className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <section
        aria-label="Find by name"
        className="fixed inset-x-0 top-2 bottom-0 z-50 flex flex-col rounded-t-[20px] bg-[#231f1b]"
      >
        <div className="flex shrink-0 flex-col gap-2.5 px-4 pt-2.5 pb-2.5">
          {handle}
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-heading text-xl font-extrabold text-white">Find by name</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2.5 flex size-12 items-center justify-center text-white"
            >
              <X aria-hidden className="size-6" />
            </button>
          </div>
          <label className="flex h-13 items-center gap-2 rounded-xl border-2 border-[#eda43c] bg-[#161412] px-3">
            <Search aria-hidden className="size-5.5 shrink-0 text-white/55" />
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (e.target.value.trim().length < 2) setRows(null);
              }}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={80}
              placeholder="Name, or the ticket code"
              aria-label="Name or ticket code"
              className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-white placeholder:text-white/35 focus:outline-none"
            />
          </label>
          {rows !== null && rows.length > 0 ? (
            <p className="text-[13px] text-white/55">
              {rows.length} {rows.length === 1 ? 'match' : 'matches'}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-[15px] text-[#ff8a80]">
              {error}
            </p>
          ) : null}
          {local && rows !== null ? (
            <p
              role="status"
              data-testid="door-search-offline"
              className="rounded-lg bg-[#a65b00] px-3 py-2 text-sm text-white"
            >
              Offline — from this phone&apos;s ticket list. Admitting by name needs signal: use the
              printed list.
            </p>
          ) : null}
        </div>
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {rows?.length === 0 ? (
            <li className="py-6 text-center text-white/60">No one by that name for this event.</li>
          ) : null}
          {rows?.map((row) => {
            const cancelled = row.status === 'cancelled';
            const inAt = row.checkedInAt;
            const canAdmit = !cancelled && inAt === null && !local;
            return (
              <li
                key={row.ticketId}
                className="flex items-center gap-2.5 rounded-xl bg-[#2d2823] p-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-base font-bold text-white">
                    {row.attendeeName}
                  </span>
                  <span className="truncate text-[13px] text-white/75">
                    {row.ticketTypeName}
                    {row.phoneOnFile ? '' : ' · Complimentary · no digits needed'}
                  </span>
                  <span
                    className={cn(
                      'truncate text-[13px] font-bold',
                      cancelled
                        ? 'text-[#ff8a80]'
                        : inAt !== null
                          ? 'text-[#6fd897]'
                          : 'text-white/75',
                    )}
                  >
                    {cancelled
                      ? 'Cancelled'
                      : inAt !== null
                        ? `In at ${formatDhakaClock(new Date(inAt))}${row.checkedInBy ? ` · ${row.checkedInBy}` : ''}`
                        : 'Not in'}
                  </span>
                </div>
                {canAdmit ? (
                  <button
                    type="button"
                    aria-label={`Admit ${row.attendeeName}`}
                    onClick={() => {
                      setDigits('');
                      setConfirming(row);
                    }}
                    className="h-12 shrink-0 rounded-xl bg-[#eda43c] px-4 text-[15px] font-extrabold text-[#161412]"
                  >
                    Admit
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
