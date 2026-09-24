'use client';

import { useEffect, useState } from 'react';
import { formatDhakaClock } from '@/lib/time';
import { type WireSearchResult, doorApi } from './door-api';

/**
 * Find someone by name when their QR will not scan (a cracked screen, a
 * dead phone). Admitting from a name is the easiest thing to abuse, so it
 * is two steps: staff ask for the last 3 digits of the phone that BOUGHT
 * the ticket and type what they hear; the server checks them. The digits
 * are never on this screen — an impostor could read them off it — and
 * these admits have their own, tighter rate budget.
 */
export function DoorSearch({
  busy,
  onAdmit,
  onClose,
  onSignedOut,
}: {
  busy: boolean;
  /** `phoneLast3`: what the person said; omitted only for a comp (no phone on file). */
  onAdmit: (row: WireSearchResult, phoneLast3?: string) => void;
  onClose: () => void;
  onSignedOut: (message: string) => void;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<WireSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<WireSearchResult | null>(null);
  const [digits, setDigits] = useState('');

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      const reply = await doorApi.search(term);
      if (!live) return;
      if (reply.ok) {
        setRows(reply.data.results);
        setError(null);
      } else if (reply.kind === 'signed_out') {
        onSignedOut(reply.message);
      } else if (reply.kind === 'slow') {
        setError(`Slow down — wait ${reply.retryAfter} s.`);
      } else if (reply.kind === 'network') {
        setError('No connection. Use the printed list if it does not come back.');
      } else {
        setError(reply.message);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, onSignedOut]);

  if (confirming) {
    return (
      <section
        aria-label="Confirm admit"
        className="fixed inset-0 z-40 flex flex-col justify-between gap-6 bg-[#161412] px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex flex-col gap-4">
          <p className="text-2xl leading-tight font-semibold text-white">
            {confirming.attendeeName}
          </p>
          <p className="text-lg text-white/70">{confirming.ticketTypeName}</p>
          {confirming.phoneOnFile ? (
            <label className="flex flex-col gap-3 rounded-xl bg-white/10 p-4">
              <span className="text-lg text-white">
                Ask for the last 3 digits of the phone number that bought the tickets — it may be a
                friend&apos;s. Type what they say.
              </span>
              <input
                value={digits}
                onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, 3))}
                autoFocus
                inputMode="numeric"
                autoComplete="off"
                maxLength={3}
                aria-label="Last 3 digits of the buying phone"
                placeholder="• • •"
                className="h-16 w-40 rounded-xl border border-white/30 bg-white/5 text-center font-mono text-3xl tracking-[0.4em] text-white placeholder:text-white/30 focus:border-white focus:outline-none"
              />
            </label>
          ) : (
            <p className="rounded-xl bg-white/10 p-4 text-lg text-white">
              A complimentary ticket — there is no phone on file. Check the name with the organizer
              before letting them in.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled={busy || (confirming.phoneOnFile && digits.length !== 3)}
            onClick={() => onAdmit(confirming, confirming.phoneOnFile ? digits : undefined)}
            className="h-16 rounded-xl bg-[#1f7a4c] text-xl font-bold text-white disabled:opacity-60"
          >
            {confirming.phoneOnFile ? 'Check digits and admit' : 'Admit'}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(null);
              setDigits('');
            }}
            className="h-14 rounded-xl border border-white/40 text-lg font-semibold text-white"
          >
            Back
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Find by name"
      className="fixed inset-0 z-40 flex flex-col gap-4 bg-[#161412] px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-2xl text-white">Find by name</h2>
        <button
          type="button"
          onClick={onClose}
          className="h-11 px-3 text-[15px] text-white/80 underline"
        >
          Close
        </button>
      </div>
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
        className="h-14 rounded-xl border border-white/25 bg-white/5 px-4 text-lg text-white placeholder:text-white/35 focus:border-white focus:outline-none"
      />
      {error ? (
        <p role="alert" className="text-[15px] text-[#ff9b93]">
          {error}
        </p>
      ) : null}
      <ul className="-mx-1 flex flex-1 flex-col gap-2 overflow-y-auto px-1">
        {rows?.length === 0 ? (
          <li className="py-6 text-center text-white/60">No one by that name for this event.</li>
        ) : null}
        {rows?.map((row) => {
          const cancelled = row.status === 'cancelled';
          const inAt = row.checkedInAt;
          const inside = inAt !== null;
          return (
            <li key={row.ticketId}>
              <button
                type="button"
                disabled={cancelled || inside}
                onClick={() => {
                  setDigits('');
                  setConfirming(row);
                }}
                className="flex w-full flex-col gap-1 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left disabled:opacity-70"
              >
                <span className="text-lg font-semibold text-white">{row.attendeeName}</span>
                <span className="text-[15px] text-white/70">
                  {row.ticketTypeName}
                  {row.phoneOnFile ? '' : ' · comp ticket'}
                </span>
                {cancelled ? (
                  <span className="text-[15px] font-semibold text-[#ff9b93]">Cancelled</span>
                ) : inAt !== null ? (
                  <span className="text-[15px] font-semibold text-[#f5c26b]">
                    In {formatDhakaClock(new Date(inAt))}
                    {row.checkedInBy ? ` · ${row.checkedInBy}` : ''}
                  </span>
                ) : (
                  <span className="text-[15px] font-semibold text-[#8fd6ae]">
                    Not in yet — tap to admit
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
