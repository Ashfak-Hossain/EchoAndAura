'use client';

import {
  Ban,
  CalendarX,
  Check,
  CircleX,
  CloudOff,
  GraduationCap,
  Hash,
  History,
  Hourglass,
  type LucideIcon,
  X,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { formatDhakaClock } from '@/lib/time';
import { cn } from '@/lib/utils';
import { SAME_GATE_SECONDS } from '@/server/lib/door-rules';
import type { WireScanResult } from './door-api';
import type { FeedbackKind } from './use-feedback';

/**
 * The answer card, over the camera view, readable at arm's length in a dark
 * doorway. Green lets them in and clears itself — and the next scan
 * replaces it at once; amber (this gate admitted the same ticket a moment
 * ago) and every red stay until tapped — staff must look at those. Never
 * shows a ticket code or contact details.
 */

export const AUTO_DISMISS_MS = 800;

export type Overlay =
  /** `viaRetry`: sent by the Retry button, with the same person still at the gate. */
  | { kind: 'result'; result: WireScanResult; viaRetry?: boolean; offline?: boolean }
  | { kind: 'not_recorded'; canRetry: boolean }
  | { kind: 'slow'; retryAfter: number };

type Tone = 'green' | 'amber' | 'red' | 'blue';

interface View {
  tone: Tone;
  icon: LucideIcon;
  /** The small line above the headline: what to do (DO NOT ADMIT, LOOK AGAIN…). */
  eyebrow: string;
  headline: string;
  /** Second, smaller headline line: when and where, or the other event. */
  sub?: string;
  detail?: string;
  feedback: FeedbackKind;
  autoDismiss: boolean;
}

// White text on each is 5:1 or better (the design's signal spec).
const TONE_BG: Record<Tone, string> = {
  green: 'bg-[#12803f]',
  amber: 'bg-[#a65b00]',
  red: 'bg-[#c4242b]',
  blue: 'bg-[#2457c5]',
};
const TONE_TEXT: Record<Tone, string> = {
  green: 'text-[#12803f]',
  amber: 'text-[#a65b00]',
  red: 'text-[#c4242b]',
  blue: 'text-[#2457c5]',
};

function seconds(n: number | undefined): string {
  return n === undefined ? '' : n < 60 ? `${n} s` : `${Math.round(n / 60)} min`;
}

const STOP = 'DO NOT ADMIT';

/** `gate`: this phone's gate, the eyebrow of a plain ADMIT. */
export function viewOf(overlay: Overlay, gate = ''): View {
  if (overlay.kind === 'slow') {
    return {
      tone: 'red',
      icon: Hourglass,
      eyebrow: 'TOO MANY SCANS',
      headline: 'SLOW DOWN',
      sub: `Wait ${overlay.retryAfter} s`,
      detail: 'Too many scans from this phone in a short time.',
      feedback: 'slow',
      autoDismiss: false,
    };
  }
  if (overlay.kind === 'not_recorded') {
    return {
      tone: 'red',
      icon: CloudOff,
      eyebrow: 'HOLD THEM A MOMENT',
      headline: 'NOT RECORDED',
      detail: overlay.canRetry
        ? 'No answer from the server. Retry — or check their name on the printed list.'
        : 'Scan it again.',
      feedback: 'retry',
      autoDismiss: false,
    };
  }
  const r = overlay.result;
  const at = r.at ? formatDhakaClock(new Date(r.at)) : '';
  if (overlay.offline) return offlineView(r, at, gate);
  const eyebrow = r.practice ? 'PRACTICE' : STOP;
  switch (r.result) {
    case 'admitted':
      // A replayed ADMIT from a fresh read (not the Retry button) might be a
      // second person with a screenshot of a ticket whose first answer was
      // lost: staff must look, so amber — never green, never a false red.
      if (r.replayed && !overlay.viaRetry) return sameGate(r);
      return {
        tone: 'green',
        icon: Check,
        eyebrow: gate.toUpperCase(),
        headline: 'ADMIT',
        feedback: 'admit',
        autoDismiss: true,
      };
    case 'phone_mismatch':
      return {
        tone: 'red',
        icon: Hash,
        eyebrow: STOP,
        headline: 'DIGITS DO NOT MATCH',
        detail:
          'Not the last 3 digits of the phone that bought this ticket. Ask to see the ticket, or call the organizer.',
        feedback: 'deny',
        autoDismiss: false,
      };
    case 'rescan':
      return {
        tone: 'red',
        icon: History,
        eyebrow: 'HOLD THEM A MOMENT',
        headline: 'SCAN AGAIN',
        detail: 'The earlier answer for this ticket no longer holds.',
        feedback: 'deny',
        autoDismiss: false,
      };
    case 'practice_ok':
      return {
        tone: 'blue',
        icon: GraduationCap,
        eyebrow: 'PRACTICE',
        headline: 'WOULD ADMIT',
        detail: 'Doors are not open yet: nothing was checked in.',
        feedback: 'practice',
        autoDismiss: true,
      };
    case 'already_in':
      if (!r.practice && r.byThisPass && (r.secondsAgo ?? Infinity) <= SAME_GATE_SECONDS) {
        return sameGate(r);
      }
      return {
        tone: 'red',
        icon: Ban,
        eyebrow,
        headline: 'ALREADY IN',
        sub: [at, r.gate].filter(Boolean).join(' · ') || undefined,
        detail: r.byThisPass
          ? 'Checked in earlier at this gate.'
          : 'Checked in at another gate. Possible copied ticket.',
        feedback: 'deny',
        autoDismiss: false,
      };
    case 'cancelled':
      return {
        tone: 'red',
        icon: CircleX,
        eyebrow,
        headline: 'CANCELLED',
        detail: 'This ticket was cancelled. Send them to the organizer.',
        feedback: 'deny',
        autoDismiss: false,
      };
    case 'wrong_event':
      return {
        tone: 'red',
        icon: CalendarX,
        eyebrow,
        headline: 'WRONG EVENT',
        sub: r.otherEventTitle,
        detail: 'This ticket is for a different event.',
        feedback: 'deny',
        autoDismiss: false,
      };
    case 'scan_id_conflict':
      return {
        tone: 'red',
        icon: CloudOff,
        eyebrow: 'HOLD THEM A MOMENT',
        headline: 'NOT RECORDED',
        detail: 'Scan it again.',
        feedback: 'retry',
        autoDismiss: false,
      };
    case 'unknown':
    default:
      return {
        tone: 'red',
        icon: X,
        eyebrow,
        headline: 'NOT A VALID TICKET',
        detail: 'Check the code, or find them by name.',
        feedback: 'deny',
        autoDismiss: false,
      };
  }
}

/** This gate let the same ticket in a moment ago: probably the same person. */
function sameGate(r: WireScanResult, offline = false): View {
  return {
    tone: 'amber',
    icon: History,
    eyebrow: 'LOOK AGAIN',
    headline: `ADMITTED ${seconds(r.secondsAgo)} AGO`,
    sub: 'AT THIS GATE',
    detail: `Same person? Let them through. Someone else? Stop them.${offline ? ' (Offline)' : ''}`,
    feedback: 'warn',
    autoDismiss: false,
  };
}

/**
 * ADR-034: an answer from the phone's own list. Same colours and sounds —
 * the gate works the same way — but every one says "offline", and a code
 * that is not on the list cannot be called a wrong event: offline, another
 * event's ticket looks exactly like a made-up one.
 */
function offlineView(r: WireScanResult, at: string, gate: string): View {
  const eyebrow = r.practice ? 'PRACTICE' : STOP;
  switch (r.result) {
    case 'admitted':
      return {
        tone: 'green',
        icon: Check,
        eyebrow: gate.toUpperCase(),
        headline: 'ADMIT',
        detail: 'Offline — sent when the signal is back.',
        feedback: 'admit',
        autoDismiss: true,
      };
    case 'practice_ok':
      return {
        tone: 'blue',
        icon: GraduationCap,
        eyebrow: 'PRACTICE',
        headline: 'WOULD ADMIT',
        detail: 'Offline. Doors are not open yet: nothing was checked in.',
        feedback: 'practice',
        autoDismiss: true,
      };
    case 'already_in':
      if (!r.practice && r.byThisPass && (r.secondsAgo ?? Infinity) <= SAME_GATE_SECONDS) {
        return sameGate(r, true);
      }
      return {
        tone: 'red',
        icon: Ban,
        eyebrow,
        headline: 'ALREADY IN',
        sub: [at, r.gate].filter(Boolean).join(' · ') || undefined,
        detail: 'From the offline list.',
        feedback: 'deny',
        autoDismiss: false,
      };
    case 'cancelled':
      return {
        tone: 'red',
        icon: CircleX,
        eyebrow,
        headline: 'CANCELLED',
        detail: 'This ticket was cancelled. Send them to the organizer. (Offline)',
        feedback: 'deny',
        autoDismiss: false,
      };
    case 'unknown':
    default:
      return {
        tone: 'red',
        icon: X,
        eyebrow,
        headline: 'NOT ON THIS LIST',
        detail:
          'Offline: not a ticket for this event on this phone’s list. Check the printed list, or wait for signal.',
        feedback: 'deny',
        autoDismiss: false,
      };
  }
}

export function ResultOverlay({
  overlay,
  gate,
  onDismiss,
  onRetry,
}: {
  overlay: Overlay;
  gate: string;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const view = viewOf(overlay, gate);
  const r = overlay.kind === 'result' ? overlay.result : null;
  const offline = overlay.kind === 'result' && overlay.offline;
  const chips = [
    r?.ticketTypeName,
    r?.position !== undefined && r.total !== undefined && r.total > 1
      ? `${r.position} of ${r.total}`
      : undefined,
  ].filter(Boolean);
  const Icon = view.icon;
  // Sized by length so a word never breaks in the middle ("ALREAD-Y IN") on a
  // 320 px phone: one huge word (ADMIT), a short phrase, or a long one.
  const size =
    view.headline.length <= 6
      ? 'text-[clamp(3.25rem,19vw,5rem)]'
      : view.headline.length <= 12
        ? 'text-[clamp(2.25rem,12.5vw,3.5rem)]'
        : 'text-[clamp(1.875rem,9.5vw,2.75rem)]';
  // Focus the button without scrolling: an autoFocus scrolls the card when
  // it is taller than a small screen, and hides its top (icon, headline).
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    next.current?.focus({ preventScroll: true });
  }, [overlay]);
  const retry = overlay.kind === 'not_recorded' && overlay.canRetry;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={view.headline}
      data-testid="door-result"
      data-result={r?.result ?? overlay.kind}
      data-offline={offline ? 'true' : undefined}
      data-tone={view.tone}
      onClick={view.autoDismiss ? onDismiss : undefined}
      className={cn(
        'absolute inset-0 z-20 flex flex-col gap-2.5 overflow-y-auto px-4.5 pt-4.5 pb-4 text-white',
        TONE_BG[view.tone],
      )}
    >
      <div className="flex min-h-14 items-center gap-2.5">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white">
          <Icon aria-hidden strokeWidth={3} className={cn('size-9', TONE_TEXT[view.tone])} />
        </span>
        <span className="min-w-0 flex-1 truncate font-heading text-[15px] font-extrabold tracking-[0.06em]">
          {view.eyebrow}
        </span>
        {offline ? (
          <span className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-black/30 px-2.5 text-xs font-bold">
            <CloudOff aria-hidden className="size-3.5" />
            offline
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          'font-heading leading-[0.95] font-black tracking-tight text-balance wrap-break-word',
          size,
        )}
      >
        {view.headline}
      </p>
      {view.sub ? (
        <p className="font-heading text-[22px] leading-tight font-extrabold">{view.sub}</p>
      ) : null}
      {r?.attendeeName ? (
        <p className="mt-1 line-clamp-2 text-[22px] leading-tight font-bold">{r.attendeeName}</p>
      ) : null}
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip}
              className="flex h-7.5 items-center rounded-full bg-black/25 px-3 text-[15px] font-bold whitespace-nowrap"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}
      {view.detail ? <p className="text-[15px] leading-snug text-pretty">{view.detail}</p> : null}
      <div className="min-h-0 flex-1" />
      {view.autoDismiss ? (
        <div className="flex flex-col gap-2">
          <span className="truncate text-[13px] font-semibold">
            Clears itself · next scan replaces it
          </span>
          <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
            <div
              className="h-full origin-left bg-white"
              style={{ animation: `door-progress ${AUTO_DISMISS_MS}ms linear forwards` }}
            />
          </div>
        </div>
      ) : (
        <div className="flex shrink-0 flex-col gap-2">
          {retry ? (
            <button
              type="button"
              onClick={onRetry}
              className={cn(
                'h-15 rounded-[14px] bg-white font-heading text-xl font-extrabold',
                TONE_TEXT[view.tone],
              )}
            >
              Retry
            </button>
          ) : null}
          <button
            type="button"
            ref={next}
            onClick={onDismiss}
            className={cn(
              'truncate rounded-[14px] px-3 font-heading font-extrabold',
              retry
                ? 'h-12 border-2 border-white/80 text-base'
                : cn('h-15 bg-white text-xl', TONE_TEXT[view.tone]),
            )}
          >
            {retry ? 'Dismiss' : 'OK — next scan'}
          </button>
        </div>
      )}
    </div>
  );
}
