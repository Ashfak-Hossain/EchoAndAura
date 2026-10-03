'use client';

import { Hand } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDhakaClock } from '@/lib/time';
import type { WireScanResult } from './door-api';
import type { FeedbackKind } from './use-feedback';

/**
 * ADR-053 "server disagrees": this phone showed ADMIT from its own list,
 * and the server's answer, arriving after, refuses the ticket — most often
 * used first at another gate. Takes over the screen, with a siren and
 * vibration repeated until staff answer; the answer is recorded, and
 * neither choice checks anyone in.
 */

const SIREN_EVERY_MS = 2_000;

function why(r: WireScanResult): string {
  const when = [r.at ? formatDhakaClock(new Date(r.at)) : null, r.gate].filter(Boolean);
  switch (r.result) {
    case 'already_in':
      return when.length > 0 ? `already in at ${[...when].reverse().join(', ')}` : 'already in';
    case 'cancelled':
      return 'this ticket was cancelled';
    case 'wrong_event':
      return 'this ticket is for another event';
    default:
      return 'not a valid ticket';
  }
}

export function DisagreeAlert({
  result,
  admittedAt,
  play,
  onAnswer,
}: {
  result: WireScanResult;
  /** When this phone showed ADMIT (HH:MM). */
  admittedAt: string;
  play: (kind: FeedbackKind) => void;
  onAnswer: (decision: 'turned_away' | 'let_in') => Promise<void>;
}) {
  const [sending, setSending] = useState(false);

  useEffect(() => {
    play('siren');
    const timer = setInterval(() => play('siren'), SIREN_EVERY_MS);
    return () => clearInterval(timer);
  }, [play]);

  const answer = async (decision: 'turned_away' | 'let_in') => {
    setSending(true);
    try {
      await onAnswer(decision);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Stop — the server disagrees"
      data-testid="door-disagree"
      data-result={result.result}
      className="fixed inset-0 z-80 flex flex-col gap-3 overflow-y-auto bg-[#c4242b] px-5 pt-[max(1.375rem,env(safe-area-inset-top))] pb-[max(1.125rem,env(safe-area-inset-bottom))] text-white"
    >
      <div
        aria-hidden
        data-door-motion
        className="pointer-events-none fixed inset-0 border-8 border-white"
        style={{ animation: 'door-flash .5s steps(1) infinite' }}
      />
      <div className="flex items-center gap-2.5">
        <span className="flex size-15 shrink-0 items-center justify-center rounded-full bg-white">
          <Hand aria-hidden className="size-9 fill-current text-[#c4242b]" />
        </span>
        <span className="font-heading text-[15px] font-extrabold tracking-[0.06em]">
          SERVER DISAGREES
        </span>
      </div>
      <p className="font-heading text-[clamp(4rem,22vw,5.5rem)] leading-[0.9] font-black">STOP</p>
      <p className="font-heading text-2xl leading-tight font-extrabold">{why(result)}</p>
      {result.attendeeName ? (
        <p className="truncate text-xl font-bold">{result.attendeeName}</p>
      ) : null}
      <p className="text-[15px] leading-snug text-pretty">
        You admitted them from this phone&apos;s list at {admittedAt}. The server says this ticket
        cannot be used. Find them if you can.
      </p>
      <div className="min-h-2 flex-1" />
      <button
        type="button"
        disabled={sending}
        onClick={() => void answer('turned_away')}
        className="h-15 shrink-0 rounded-[14px] bg-white font-heading text-xl font-extrabold text-[#c4242b] disabled:opacity-70"
      >
        Turned them away
      </button>
      <button
        type="button"
        disabled={sending}
        onClick={() => void answer('let_in')}
        className="h-14 shrink-0 rounded-[14px] border-2 border-white text-base font-bold disabled:opacity-70"
      >
        Let them in anyway
      </button>
    </div>
  );
}
