'use client';

import { formatDhakaClock } from '@/lib/time';
import { cn } from '@/lib/utils';
import { SAME_GATE_SECONDS } from '@/server/lib/door-rules';
import type { WireScanResult } from './door-api';
import type { FeedbackKind } from './use-feedback';

/**
 * The full-screen answer, readable at arm's length in a dark doorway.
 * Green lets them in and clears itself; amber (this gate admitted the
 * same ticket a moment ago) and every red stay until tapped — staff must
 * look at those. Never shows a ticket code or contact details.
 */

export const AUTO_DISMISS_MS = 1_500;

export type Overlay =
  /** `viaRetry`: sent by the Retry button, with the same person still at the gate. */
  | { kind: 'result'; result: WireScanResult; viaRetry?: boolean; offline?: boolean }
  | { kind: 'not_recorded'; canRetry: boolean }
  | { kind: 'slow'; retryAfter: number };

type Tone = 'green' | 'amber' | 'red' | 'blue';

interface View {
  tone: Tone;
  headline: string;
  detail?: string;
  feedback: FeedbackKind;
  autoDismiss: boolean;
}

const TONE_CLASS: Record<Tone, string> = {
  green: 'bg-[#1f7a4c]',
  amber: 'bg-[#b86a00]',
  red: 'bg-[#b3261e]',
  blue: 'bg-[#1d4e89]',
};

function seconds(n: number | undefined): string {
  return n === undefined ? '' : n < 60 ? `${n} s` : `${Math.round(n / 60)} min`;
}

export function viewOf(overlay: Overlay): View {
  if (overlay.kind === 'slow') {
    return {
      tone: 'red',
      headline: 'SLOW DOWN',
      detail: `Too many scans from this phone — wait ${overlay.retryAfter} s.`,
      feedback: 'deny',
      autoDismiss: false,
    };
  }
  if (overlay.kind === 'not_recorded') {
    return {
      tone: 'red',
      headline: 'NOT RECORDED',
      detail: overlay.canRetry
        ? 'No answer from the server. Retry — or check their name on the printed list.'
        : 'Scan it again.',
      feedback: 'deny',
      autoDismiss: false,
    };
  }
  const r = overlay.result;
  const at = r.at ? formatDhakaClock(new Date(r.at)) : '';
  if (overlay.offline) return offlineView(r, at);
  const practice = r.practice ? 'PRACTICE — ' : '';
  switch (r.result) {
    case 'admitted':
      // A replayed ADMIT from a fresh read (not the Retry button) might be a
      // second person with a screenshot of a ticket whose first answer was
      // lost: staff must look, so amber — never green, never a false red.
      if (r.replayed && !overlay.viaRetry) {
        return {
          tone: 'amber',
          headline: `ADMITTED ${seconds(r.secondsAgo)} AGO AT THIS GATE`,
          detail: 'Same person? Let them through. Someone else? Stop them.',
          feedback: 'warn',
          autoDismiss: false,
        };
      }
      return { tone: 'green', headline: 'ADMIT', feedback: 'admit', autoDismiss: true };
    case 'phone_mismatch':
      return {
        tone: 'red',
        headline: 'DIGITS DO NOT MATCH',
        detail:
          'Not the last 3 digits of the phone that bought this ticket. Do not admit — ask to see the ticket, or call the organizer.',
        feedback: 'deny',
        autoDismiss: false,
      };
    case 'rescan':
      return {
        tone: 'red',
        headline: 'SCAN AGAIN',
        detail: 'The earlier answer for this ticket no longer holds.',
        feedback: 'deny',
        autoDismiss: false,
      };
    case 'practice_ok':
      return {
        tone: 'blue',
        headline: 'PRACTICE — WOULD ADMIT',
        detail: 'Doors are not open yet: nothing was checked in.',
        feedback: 'practice',
        autoDismiss: true,
      };
    case 'already_in':
      if (!r.practice && r.byThisPass && (r.secondsAgo ?? Infinity) <= SAME_GATE_SECONDS) {
        return {
          tone: 'amber',
          headline: `ADMITTED ${seconds(r.secondsAgo)} AGO AT THIS GATE`,
          detail: 'Same person? Let them through. Someone else? Stop them.',
          feedback: 'warn',
          autoDismiss: false,
        };
      }
      return {
        tone: 'red',
        headline: `${practice}ALREADY IN`,
        detail: [at, r.gate].filter(Boolean).join(' · '),
        feedback: 'deny',
        autoDismiss: false,
      };
    case 'cancelled':
      return {
        tone: 'red',
        headline: `${practice}CANCELLED`,
        detail: 'This ticket was cancelled. Send them to the organizer.',
        feedback: 'deny',
        autoDismiss: false,
      };
    case 'wrong_event':
      return {
        tone: 'red',
        headline: `${practice}WRONG EVENT`,
        detail: `This ticket is for ${r.otherEventTitle ?? 'another event'}.`,
        feedback: 'deny',
        autoDismiss: false,
      };
    case 'scan_id_conflict':
      return {
        tone: 'red',
        headline: 'NOT RECORDED',
        detail: 'Scan it again.',
        feedback: 'deny',
        autoDismiss: false,
      };
    case 'unknown':
    default:
      return {
        tone: 'red',
        headline: `${practice}NOT A VALID TICKET`,
        detail: 'Check the code, or find them by name.',
        feedback: 'deny',
        autoDismiss: false,
      };
  }
}

/**
 * ADR-034: an answer from the phone's own list. Same colours and sounds —
 * the gate works the same way — but every one says "offline", and a code
 * that is not on the list cannot be called a wrong event: offline, another
 * event's ticket looks exactly like a made-up one.
 */
function offlineView(r: WireScanResult, at: string): View {
  const practice = r.practice ? 'PRACTICE — ' : '';
  switch (r.result) {
    case 'admitted':
      return {
        tone: 'green',
        headline: 'ADMIT',
        detail: 'Offline — sent when the signal is back.',
        feedback: 'admit',
        autoDismiss: true,
      };
    case 'practice_ok':
      return {
        tone: 'blue',
        headline: 'PRACTICE — WOULD ADMIT',
        detail: 'Offline. Doors are not open yet: nothing was checked in.',
        feedback: 'practice',
        autoDismiss: true,
      };
    case 'already_in':
      if (!r.practice && r.byThisPass && (r.secondsAgo ?? Infinity) <= SAME_GATE_SECONDS) {
        return {
          tone: 'amber',
          headline: `ADMITTED ${seconds(r.secondsAgo)} AGO AT THIS GATE`,
          detail: 'Same person? Let them through. Someone else? Stop them. (Offline)',
          feedback: 'warn',
          autoDismiss: false,
        };
      }
      return {
        tone: 'red',
        headline: `${practice}ALREADY IN`,
        detail: `${[at, r.gate].filter(Boolean).join(' · ')} — offline list`,
        feedback: 'deny',
        autoDismiss: false,
      };
    case 'cancelled':
      return {
        tone: 'red',
        headline: `${practice}CANCELLED`,
        detail: 'This ticket was cancelled. Send them to the organizer. (Offline)',
        feedback: 'deny',
        autoDismiss: false,
      };
    case 'unknown':
    default:
      return {
        tone: 'red',
        headline: `${practice}NOT ON THIS LIST`,
        detail:
          'Offline: not a ticket for this event on this phone’s list. Check the printed list, or wait for signal.',
        feedback: 'deny',
        autoDismiss: false,
      };
  }
}

export function ResultOverlay({
  overlay,
  onDismiss,
  onRetry,
}: {
  overlay: Overlay;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const view = viewOf(overlay);
  const r = overlay.kind === 'result' ? overlay.result : null;
  const who = r?.attendeeName;
  const ticketOf =
    r?.position !== undefined && r.total !== undefined && r.total > 1
      ? `Ticket ${r.position} of ${r.total}`
      : null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={view.headline}
      data-testid="door-result"
      data-result={r?.result ?? overlay.kind}
      data-offline={overlay.kind === 'result' && overlay.offline ? 'true' : undefined}
      data-tone={view.tone}
      onClick={view.autoDismiss ? onDismiss : undefined}
      className={cn(
        'fixed inset-0 z-50 flex flex-col justify-between gap-6 px-6 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-white',
        TONE_CLASS[view.tone],
      )}
    >
      <div className="flex flex-col gap-4">
        <p className="font-heading text-[clamp(2.5rem,13vw,5rem)] leading-[0.95] font-bold tracking-tight wrap-break-word">
          {view.headline}
        </p>
        {who ? <p className="text-3xl leading-tight font-semibold wrap-break-word">{who}</p> : null}
        {r?.ticketTypeName || ticketOf ? (
          <p className="text-xl text-white/85">
            {[r?.ticketTypeName, ticketOf].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        {view.detail ? <p className="text-xl leading-snug text-white/90">{view.detail}</p> : null}
      </div>

      {view.autoDismiss ? null : (
        <div className="flex flex-col gap-3">
          {overlay.kind === 'not_recorded' && overlay.canRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="h-16 rounded-xl bg-white text-xl font-bold text-[#1c1a17]"
            >
              Retry
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDismiss}
            autoFocus
            className="h-16 rounded-xl border-2 border-white/80 text-xl font-bold"
          >
            {overlay.kind === 'not_recorded' && overlay.canRetry ? 'Dismiss' : 'Next'}
          </button>
        </div>
      )}
    </div>
  );
}
