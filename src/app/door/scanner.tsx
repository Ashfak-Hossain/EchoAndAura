'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { formatDhakaClock } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  DOOR_UNDO_REASONS,
  DOOR_UNDO_WINDOW_MS,
  type DoorUndoReason,
  SCAN_INPUT_MAX,
} from '@/server/lib/door-rules';
import { parseScanToken } from '@/server/lib/scan-token';
import type { ScanMethod } from '@/server/services/door.service';
import {
  type WireRecentScan,
  type WireScanResult,
  type WireSearchResult,
  type WireStatus,
  doorApi,
} from './door-api';
import { loadQrDetector } from './decoder';
import { DoorSearch } from './door-search';
import { forgetPageOffline, keepPageOffline } from './offline/keep-page';
import { type OfflineApi, useOffline } from './offline/use-offline';
import { isIos, subscribeNever } from './platform';
import { AUTO_DISMISS_MS, type Overlay, ResultOverlay, viewOf } from './result-overlay';
import { type CameraProblem, useCamera } from './use-camera';
import { useFeedback } from './use-feedback';

/**
 * The gate scanner (ADR-030). One submit path for the camera, a handheld
 * (keyboard-wedge) scanner, a typed code and a name-search admit.
 *
 * Duplicate reads are a camera problem only: while a code stays in view it
 * is ignored (a sliding window). Once it leaves view and comes back it goes
 * to the server, which answers amber for a re-read at this gate — that is
 * how a screenshot handed back down the queue gets caught. Typed and
 * handheld codes always go to the server. The camera is ignored while a
 * full-screen panel hides the viewfinder.
 *
 * A request that gets no answer keeps its scanId: Retry — or reading the
 * same code again within 2 minutes — sends the SAME id, so if the first
 * attempt did land, the server replays it instead of a false ALREADY IN.
 * A replayed ADMIT is green only for the Retry button (same person, still
 * there); from a fresh read it is amber, because it could be someone else.
 *
 * ADR-034: with no answer, a code read is judged from the phone's offline
 * list instead ("offline" on the answer) and queued; from then on scans
 * skip the network until a status ping gets through, and the queue is sent.
 * A name-search admit still needs signal: its phone digits are checked
 * only on the server.
 *
 * ADR-035: once a status ping gets through, the page saves a copy of
 * itself (and the decoder) so it reloads without signal. A page whose
 * first ping gets no answer — likely that saved copy — starts offline.
 */

const SEEN_WINDOW_MS = 1_500;
const RETRY_REUSE_MS = 2 * 60_000;
const STATUS_EVERY_MS = 15_000;
const WEDGE_KEY_GAP_MS = 300;
const IOS_CHECKLIST_KEY = 'door:ios-checklist';

interface PendingScan {
  key: string;
  scanId: string;
  method: ScanMethod;
  input?: string;
  ticketId?: string;
  phoneLast3?: string;
  firstAt: number;
}

/** Same key for every way a code is read ("tkt 4h8z…", a /tickets/ URL): what the server parses. */
function scanKey(raw: string): string {
  return parseScanToken(raw) ?? raw.trim().toUpperCase();
}

const RESULT_LABEL: Record<string, string> = {
  admitted: 'Admitted',
  already_in: 'Already in',
  cancelled: 'Cancelled',
  wrong_event: 'Wrong event',
  unknown: 'Not valid',
  practice_ok: 'Practice',
  phone_mismatch: 'Digits did not match',
  turned_away: 'Turned away (offline)',
};

/** What an offline scan waiting in the outbox shows in "Last scans here". */
const VERDICT_LABEL: Record<string, string> = {
  admitted: 'Admitted · offline, not sent yet',
  refused: 'Turned away · offline, not sent yet',
  practice: 'Practice · offline, not sent yet',
  undone: 'Undone · offline, not sent yet',
};

/** A row of "Last scans here": the server's, or one still in the outbox. */
type RecentRow = WireRecentScan & { offline?: boolean };

const PROBLEM_TEXT: Record<CameraProblem, { title: string; ios: string; other: string }> = {
  denied: {
    title: 'The camera is blocked',
    ios: 'Tap aA in the address bar → Website Settings → Camera → Allow. Then reload this page.',
    other:
      'Tap the icon left of the address → Permissions → Camera → Allow. Then reload this page.',
  },
  busy: {
    title: 'Another app is using the camera',
    ios: 'Close the other app (swipe it away), then try again.',
    other: 'Close the other app (swipe it away), then try again.',
  },
  none: {
    title: 'No camera found',
    ios: 'Type codes or find people by name instead.',
    other: 'Type codes or find people by name instead.',
  },
  insecure: {
    title: 'The camera needs the secure link',
    ios: 'Open the https:// link from the gate pass.',
    other: 'Open the https:// link from the gate pass.',
  },
  decoder: {
    title: 'The scanner did not load',
    ios: 'Check the signal and tap Try again.',
    other: 'Check the signal and tap Try again.',
  },
};

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Private mode: the checklist shows again next time, which is harmless.
  }
}

function prune(map: Map<string, number>, olderThan: number): void {
  if (map.size < 200) return;
  for (const [k, at] of map) if (at < olderThan) map.delete(k);
}

export function Scanner({
  passId,
  initial,
  onSignedOut: onSessionOver,
}: {
  passId: string;
  initial: WireStatus;
  onSignedOut: (message: string) => void;
}) {
  const [status, setStatus] = useState(initial);
  const [online, setOnline] = useState(true);
  /** No answer lately: scans are judged from the list until a ping gets through. */
  const [offlineMode, setOfflineMode] = useState(false);
  const offlineModeRef = useRef(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'none' | 'type' | 'search' | 'checklist'>('none');
  const [typed, setTyped] = useState('');
  const [undoFor, setUndoFor] = useState<RecentRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  /** The second tap: sending what is left, then signing out. */
  const [closing, setClosing] = useState(false);

  const ios = useSyncExternalStore(
    subscribeNever,
    () => isIos(navigator.userAgent, navigator.maxTouchPoints),
    () => false,
  );

  // Mutable scan bookkeeping — read by camera callbacks between renders.
  const busyRef = useRef(false);
  const overlayOpen = useRef(false);
  const activeKey = useRef<string | null>(null);
  const seen = useRef(new Map<string, number>());
  const failed = useRef(new Map<string, PendingScan>());
  const retryScan = useRef<PendingScan | null>(null);
  /** A full-screen panel hides the viewfinder: the camera must not admit behind it. */
  const modalOpen = useRef(false);
  /** Only the newest status reply may land (they can resolve out of order). */
  const statusSeq = useRef(0);
  /** A status ping got through on this page (so it is signed in and online). */
  const pinged = useRef(false);

  const { unlock, play } = useFeedback();

  // The session is over (401, or End session): wipe the offline list and
  // outbox, and say so if scans never reached the server.
  const offlineRef = useRef<OfflineApi | null>(null);
  const onSignedOut = useCallback(
    (message: string) => {
      void (async () => {
        const [unsent = 0] = await Promise.all([offlineRef.current?.clear(), forgetPageOffline()]);
        onSessionOver(
          unsent > 0
            ? `${message} ${unsent} offline ${unsent === 1 ? 'scan' : 'scans'} from this phone could not be sent — tell the organizer.`
            : message,
        );
      })();
    },
    [onSessionOver],
  );
  const offline = useOffline({ passId, gate: status.gate, onSignedOut });
  useEffect(() => {
    offlineRef.current = offline;
  });
  // The hook's functions are stable; the object around them is not. The
  // scan path must only depend on stable ones, or the handheld-scanner
  // listener would re-subscribe on every render and drop a code mid-read.
  const { answer: judgeOffline, learn: learnOnline, now: correctedNow } = offline;

  const goOffline = useCallback((on: boolean) => {
    offlineModeRef.current = on;
    setOfflineMode(on);
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++statusSeq.current;
    const sentAt = Date.now();
    const reply = await doorApi.status();
    if (seq !== statusSeq.current) return;
    if (reply.ok) {
      offlineRef.current?.learnServerTime(reply.data.serverTime, sentAt, Date.now());
      setStatus(reply.data);
      setOnline(true);
      goOffline(false);
      if (!pinged.current) {
        pinged.current = true;
        // The decoder first, so the saved copy holds it: a reload without
        // signal must still be able to start the camera. Failing to load
        // it here costs nothing — Start tries again.
        void loadQrDetector()
          .catch(() => undefined)
          .then(() => keepPageOffline());
      }
      // Signal is back: send what was scanned without it, then show the
      // counts and last scans with those scans in them.
      const off = offlineRef.current;
      if (off && off.pending.length > 0 && (await off.sync())) {
        const again = await doorApi.status();
        if (again.ok && seq === statusSeq.current) setStatus(again.data);
      }
    } else if (reply.kind === 'signed_out') {
      onSignedOut(reply.message);
    } else if (reply.kind === 'network') {
      setOnline(false);
      // Never reached the server on this page — most likely it is the
      // saved copy, opened without signal: the first person in the queue
      // must not wait out a request that cannot answer.
      if (!pinged.current) goOffline(true);
    }
  }, [onSignedOut, goOffline]);

  const show = useCallback(
    (next: Overlay) => {
      overlayOpen.current = true;
      setOverlay(next);
      play(viewOf(next).feedback);
    },
    [play],
  );

  const dismiss = useCallback(() => {
    overlayOpen.current = false;
    // The code on screen stays "seen": if it is still in view, the sliding
    // window keeps ignoring it instead of flashing the same answer again.
    if (activeKey.current) seen.current.set(activeKey.current, Date.now());
    activeKey.current = null;
    setOverlay(null);
  }, []);

  /** Judge a code read from the offline list; false when there is no usable list. */
  const answerOffline = useCallback(
    async (scan: PendingScan, supersedes?: string): Promise<boolean> => {
      if (scan.input === undefined || scan.method === 'search') return false;
      const result = await judgeOffline(scan.input, scan.method, supersedes);
      if (!result) return false;
      failed.current.delete(scan.key);
      retryScan.current = null;
      show({ kind: 'result', result, offline: true });
      return true;
    },
    [judgeOffline, show],
  );

  const send = useCallback(
    async (scan: PendingScan, viaRetry = false) => {
      busyRef.current = true;
      activeKey.current = scan.key;
      setBusy(true);
      const done = () => {
        busyRef.current = false;
        setBusy(false);
      };
      // Known to be offline: straight to the list, no 4 s wait per person.
      if (offlineModeRef.current && (await answerOffline(scan))) {
        done();
        return;
      }
      const reply = await doorApi.scan({
        scanId: scan.scanId,
        method: scan.method,
        input: scan.input,
        ticketId: scan.ticketId,
        phoneLast3: scan.phoneLast3,
        scannedAt: new Date(correctedNow()).toISOString(),
      });
      // No answer: judge it offline, naming this request — if it did land,
      // the server knows the offline admit is the same person.
      if (!reply.ok && reply.kind === 'network' && (await answerOffline(scan, scan.scanId))) {
        done();
        setOnline(false);
        goOffline(true);
        return;
      }
      done();

      if (reply.ok) {
        setOnline(true);
        goOffline(false);
        failed.current.delete(scan.key);
        retryScan.current = null;
        const result: WireScanResult | undefined = reply.data.results[0];
        if (!result) {
          show({ kind: 'not_recorded', canRetry: false });
          return;
        }
        show({ kind: 'result', result, viaRetry });
        void learnOnline({ raw: scan.input, ticketId: scan.ticketId }, result);
        void refresh();
        return;
      }
      if (reply.kind === 'signed_out') {
        onSignedOut(reply.message);
        return;
      }
      if (reply.kind === 'refused') {
        retryScan.current = null;
        show({ kind: 'not_recorded', canRetry: false });
        return;
      }
      // No answer (or told to slow down): keep the scanId for the retry.
      failed.current.set(scan.key, scan);
      retryScan.current = scan;
      if (reply.kind === 'slow') {
        show({ kind: 'slow', retryAfter: reply.retryAfter });
        return;
      }
      setOnline(false);
      show({ kind: 'not_recorded', canRetry: true });
    },
    [onSignedOut, refresh, show, answerOffline, correctedNow, learnOnline, goOffline],
  );

  const submit = useCallback(
    (raw: string, method: 'qr' | 'typed', fromCamera: boolean) => {
      if (!raw.trim()) return;
      const key = scanKey(raw);
      const now = Date.now();
      if (fromCamera) {
        if (modalOpen.current) return;
        if (busyRef.current || overlayOpen.current) {
          if (key === activeKey.current) seen.current.set(key, now);
          return;
        }
        const last = seen.current.get(key);
        seen.current.set(key, now);
        prune(seen.current, now - RETRY_REUSE_MS);
        if (last !== undefined && now - last < SEEN_WINDOW_MS) return;
      } else if (busyRef.current) {
        // A handheld or typed code is one-shot (the camera would read it
        // again): never drop it silently, or the answer still on its way
        // would look like this one's.
        setNotice('Still checking the previous code — scan or type that one again.');
        play('deny');
        return;
      }
      const earlier = failed.current.get(key);
      const reuse = earlier && now - earlier.firstAt < RETRY_REUSE_MS ? earlier : null;
      void send({
        key,
        scanId: reuse?.scanId ?? crypto.randomUUID(),
        method,
        input: raw.trim().slice(0, SCAN_INPUT_MAX),
        firstAt: reuse?.firstAt ?? now,
      });
    },
    [send, play],
  );

  const {
    video,
    state: cam,
    torch,
    cameras,
    awake,
    start: startCamera,
    switchCamera,
    toggleTorch,
    touch: touchCamera,
  } = useCamera((text) => submit(text, 'qr', true));

  const admitFromSearch = useCallback(
    (row: WireSearchResult, phoneLast3?: string) => {
      if (busyRef.current) return;
      // Other digits are another request (a new scan id), not a retry.
      const key = `search:${row.ticketId}:${phoneLast3 ?? ''}`;
      const now = Date.now();
      const earlier = failed.current.get(key);
      const reuse = earlier && now - earlier.firstAt < RETRY_REUSE_MS ? earlier : null;
      setPanel('none');
      touchCamera();
      void send({
        key,
        scanId: reuse?.scanId ?? crypto.randomUUID(),
        method: 'search',
        ticketId: row.ticketId,
        phoneLast3,
        firstAt: reuse?.firstAt ?? now,
      });
    },
    [touchCamera, send],
  );

  function begin() {
    // Inside the tap: sound, vibration and the wake lock all need a gesture.
    unlock();
    void startCamera();
  }

  function onStart() {
    if (ios && !readFlag(IOS_CHECKLIST_KEY)) {
      setPanel('checklist');
      return;
    }
    begin();
  }

  useEffect(() => {
    modalOpen.current = panel === 'search' || panel === 'checklist' || undoFor !== null;
  }, [panel, undoFor]);

  // Sound needs a gesture: take the first one of any kind, so a gate that
  // only types codes or uses a handheld (and never taps Start) still beeps.
  useEffect(() => {
    const once = () => unlock();
    document.addEventListener('pointerdown', once, { once: true });
    document.addEventListener('keydown', once, { once: true });
    return () => {
      document.removeEventListener('pointerdown', once);
      document.removeEventListener('keydown', once);
    };
  }, [unlock]);

  // Green (and practice) clear themselves; everything else waits for a tap.
  useEffect(() => {
    if (!overlay || !viewOf(overlay).autoDismiss) return;
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [overlay, dismiss]);

  // Counts and the last scans; doubles as the "am I online" ping.
  useEffect(() => {
    // Straight away too: `initial` may be from an older page load.
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), STATUS_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onOnline = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [refresh]);

  // A handheld (keyboard-wedge) scanner "types" the code fast and presses
  // Enter. Listen at the document so no hidden field has to hold focus;
  // keys aimed at a real field (Type a code, search) are left alone.
  useEffect(() => {
    let buffer = '';
    let lastKey = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      const now = performance.now();
      if (now - lastKey > WEDGE_KEY_GAP_MS) buffer = '';
      lastKey = now;
      if (e.key === 'Enter') {
        if (buffer.length >= 4) {
          // Not also a click on whatever button kept focus (torch, End session…).
          e.preventDefault();
          e.stopPropagation();
          touchCamera();
          submit(buffer, 'qr', false);
        }
        buffer = '';
        return;
      }
      if (e.key.length === 1 && buffer.length < SCAN_INPUT_MAX) buffer += e.key;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [touchCamera, submit]);

  async function undo(scan: RecentRow, reason: DoorUndoReason) {
    setUndoFor(null);
    if (scan.offline) {
      // Not sent yet: it goes to the server as "undone" — never checked in.
      const outcome = await offline.undo(scan.scanId);
      setNotice(
        outcome === 'done'
          ? `Check-in undone for ${scan.attendeeName ?? 'that ticket'}.`
          : outcome === 'sent'
            ? 'That scan may already be recorded — once the signal is back, undo it from Last scans here.'
            : 'Too late to undo that one here — the organizer can.',
      );
      return;
    }
    const reply = await doorApi.undo(scan.scanId, reason);
    if (reply.ok) {
      // A retry of the undone scan must not reuse its id (it would replay).
      for (const [key, pending] of failed.current) {
        if (pending.scanId === scan.scanId) failed.current.delete(key);
      }
      setNotice(`Check-in undone for ${scan.attendeeName ?? 'that ticket'}.`);
    } else if (reply.kind === 'signed_out') {
      onSignedOut(reply.message);
      return;
    } else {
      setNotice(
        reply.kind === 'refused' ? reply.message : 'No connection — the undo did not go through.',
      );
    }
    void refresh();
  }

  async function endSession() {
    if (!ending) {
      setEnding(true);
      setTimeout(() => setEnding(false), 4_000);
      return;
    }
    if (closing) return;
    setClosing(true);
    // Last chance to send what was scanned offline — waits for a send
    // already in flight, which can take a few seconds.
    await offline.sync();
    const reply = await doorApi.signOut();
    setClosing(false);
    // The cookie is httpOnly: only the server can end the session.
    if (!reply.ok) {
      setEnding(false);
      setNotice('Could not end the session — no connection. Try again.');
      return;
    }
    onSignedOut('Session ended on this phone.');
  }

  const doorsOpen = formatDhakaClock(new Date(status.validFrom));
  const pending = offline.pending;
  // The outbox's scans (newest first) above the server's own list.
  const undoFrom = offline.now() - DOOR_UNDO_WINDOW_MS;
  const recent: RecentRow[] = [
    ...[...pending].reverse().map((p) => ({
      scanId: p.scanId,
      result: p.verdict,
      method: p.method,
      at: p.scannedAt,
      attendeeName: p.attendeeName ?? null,
      ticketTypeName: p.ticketTypeName ?? null,
      // Once sent (even unanswered) only the online undo is safe: see use-offline.
      undoable: p.verdict === 'admitted' && !p.attempted && Date.parse(p.scannedAt) >= undoFrom,
      offline: true,
    })),
    ...status.recent,
  ];
  const listTime = offline.listAt ? formatDhakaClock(new Date(offline.listAt)) : null;
  const countsTime = formatDhakaClock(new Date(status.serverTime));

  return (
    <main
      className="mx-auto flex w-full max-w-lg flex-1 flex-col"
      // How many tickets the offline list holds (e2e waits on it).
      data-offline-list={offline.ready ? offline.size : undefined}
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-white">{status.event.title}</p>
          <p className="flex items-center gap-2 text-sm text-white/65">
            <span>{status.gate}</span>
            <span aria-hidden>·</span>
            <span className="tabular" data-testid="door-count">
              {status.checkedIn} / {status.issued} in
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1" data-testid="door-online">
              <span
                aria-hidden
                className={cn('size-2 rounded-full', online ? 'bg-[#4ade80]' : 'bg-[#f87171]')}
              />
              {online ? 'Online' : 'Offline'}
            </span>
            {pending.length > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span className="tabular" data-testid="door-pending">
                  {offline.syncing ? 'sending' : `${pending.length} to send`}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          onClick={endSession}
          className="h-10 shrink-0 rounded-lg border border-white/25 px-3 text-sm text-white/85"
        >
          {closing
            ? pending.length > 0
              ? 'Sending, then ending…'
              : 'Ending…'
            : ending
              ? pending.length > 0
                ? `${pending.length} not sent — tap to end anyway`
                : 'Tap again to end'
              : 'End session'}
        </button>
      </header>

      {offlineMode ? (
        <p
          role="status"
          data-testid="door-offline"
          className="bg-[#b86a00] px-4 py-2 text-center text-sm font-semibold text-white"
        >
          {offline.ready
            ? `OFFLINE — answering from the ticket list of ${listTime}. Scans are sent when the signal is back.`
            : 'OFFLINE — no ticket list on this phone. Use the printed list.'}{' '}
          <span className="font-normal">Counts as of {countsTime}.</span>
        </p>
      ) : null}
      {offline.problem ? (
        <p role="status" className="bg-[#b3261e] px-4 py-2 text-sm text-white">
          {offline.problem}
        </p>
      ) : null}

      {status.practice ? (
        <p
          data-testid="door-practice"
          className="bg-[#1d4e89] px-4 py-2 text-center text-sm font-semibold text-white"
        >
          PRACTICE — nothing is checked in until doors open at {doorsOpen}
        </p>
      ) : null}

      <div className="relative aspect-3/4 max-h-[60dvh] w-full overflow-hidden bg-black">
        <video ref={video} muted playsInline autoPlay className="size-full object-cover" />
        {cam.kind === 'on' ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-white/70"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 px-8 text-center">
            {cam.kind === 'off' ? (
              <button
                type="button"
                onClick={onStart}
                className="h-16 w-full max-w-xs rounded-xl bg-[#eda43c] text-xl font-bold text-[#1c1a17]"
              >
                Start scanning
              </button>
            ) : cam.kind === 'starting' ? (
              <p className="text-lg text-white">Starting the camera…</p>
            ) : cam.kind === 'paused' ? (
              <>
                <p className="text-lg text-white">
                  {cam.why === 'idle' ? 'Camera paused to save battery.' : 'Scanning paused.'}
                </p>
                <button
                  type="button"
                  onClick={begin}
                  className="h-16 w-full max-w-xs rounded-xl bg-[#eda43c] text-xl font-bold text-[#1c1a17]"
                >
                  Tap to resume
                </button>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold text-white">
                  {PROBLEM_TEXT[cam.problem].title}
                </p>
                <p className="text-[15px] text-white/75">
                  {ios ? PROBLEM_TEXT[cam.problem].ios : PROBLEM_TEXT[cam.problem].other}
                </p>
                <button
                  type="button"
                  onClick={begin}
                  className="h-12 w-full max-w-xs rounded-xl border border-white/40 text-lg font-semibold text-white"
                >
                  Try again
                </button>
              </>
            )}
          </div>
        )}
        {cam.kind === 'on' && awake === false ? (
          <p className="absolute inset-x-3 bottom-3 rounded-lg bg-black/70 px-3 py-2 text-center text-sm text-white">
            The screen may turn off — set Auto-Lock to Never.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setPanel(panel === 'type' ? 'none' : 'type')}
          className="h-12 flex-1 rounded-xl border border-white/25 px-3 text-[15px] font-semibold text-white"
        >
          Type a code
        </button>
        <button
          type="button"
          onClick={() => setPanel('search')}
          className="h-12 flex-1 rounded-xl border border-white/25 px-3 text-[15px] font-semibold text-white"
        >
          Find by name
        </button>
        {torch.available ? (
          <button
            type="button"
            aria-pressed={torch.on}
            onClick={() => void toggleTorch()}
            className="h-12 rounded-xl border border-white/25 px-3 text-[15px] text-white"
          >
            {torch.on ? 'Light off' : 'Light'}
          </button>
        ) : null}
        {cam.kind === 'on' && cameras > 1 ? (
          <button
            type="button"
            onClick={() => void switchCamera()}
            className="h-12 rounded-xl border border-white/25 px-3 text-[15px] text-white"
          >
            Switch camera
          </button>
        ) : null}
      </div>

      {panel === 'type' ? (
        <form
          className="flex gap-2 px-4 pb-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!typed.trim() || busy) return;
            touchCamera();
            submit(typed, 'typed', false);
            setTyped('');
          }}
        >
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value.toUpperCase())}
            autoFocus
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={40}
            placeholder="TKT-XXXXXXXX"
            aria-label="Ticket code"
            className="h-12 min-w-0 flex-1 rounded-xl border border-white/25 bg-white/5 px-3 font-mono text-lg tracking-wider text-white placeholder:text-white/30 focus:border-white focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="h-12 rounded-xl bg-white px-5 text-[15px] font-bold text-[#1c1a17] disabled:opacity-60"
          >
            Check
          </button>
        </form>
      ) : null}

      {notice ? (
        <p role="status" className="mx-4 mb-3 rounded-lg bg-white/10 px-3 py-2 text-sm text-white">
          {notice}
        </p>
      ) : null}

      <section
        aria-label="Last scans at this gate"
        className="flex flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <h2 className="pb-2 text-xs font-semibold tracking-widest text-white/50 uppercase">
          Last scans here
        </h2>
        {recent.length === 0 ? (
          <p className="py-3 text-sm text-white/50">Nothing scanned at this gate yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-white/10">
            {recent.map((r) => (
              <li key={r.scanId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[15px] text-white">
                    {r.attendeeName ?? 'Unknown code'}
                  </p>
                  <p className="text-xs text-white/55">
                    {formatDhakaClock(new Date(r.at))}
                    {r.ticketTypeName ? ` · ${r.ticketTypeName}` : ''} ·{' '}
                    {(r.offline ? VERDICT_LABEL[r.result] : RESULT_LABEL[r.result]) ?? r.result}
                  </p>
                </div>
                {r.undoable ? (
                  <button
                    type="button"
                    onClick={() => setUndoFor(r)}
                    className="h-9 shrink-0 rounded-lg border border-white/30 px-3 text-sm text-white"
                  >
                    Undo
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {panel === 'search' ? (
        <DoorSearch
          busy={busy}
          offlineMode={offlineMode}
          searchOffline={offline.search}
          onAdmit={admitFromSearch}
          onClose={() => setPanel('none')}
          onSignedOut={onSignedOut}
        />
      ) : null}

      {panel === 'checklist' ? (
        <section
          aria-label="Before you start"
          className="fixed inset-0 z-40 flex flex-col justify-between gap-6 bg-[#161412] px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <div className="flex flex-col gap-4 text-white">
            <h2 className="font-heading text-2xl">Before you start (iPhone)</h2>
            <ol className="flex list-decimal flex-col gap-3 pl-5 text-lg leading-snug">
              <li>
                Safari: tap <b>aA</b> in the address bar → <b>Website Settings</b> → Camera:{' '}
                <b>Allow</b>.
              </li>
              <li>
                Settings → Display &amp; Brightness → <b>Auto-Lock: Never</b> (for tonight).
              </li>
              <li>Turn the volume up — the beep tells you the answer without looking.</li>
              <li>Plug in a power bank if you have one.</li>
            </ol>
          </div>
          <button
            type="button"
            onClick={() => {
              writeFlag(IOS_CHECKLIST_KEY);
              setPanel('none');
              begin();
            }}
            className="h-16 rounded-xl bg-[#eda43c] text-xl font-bold text-[#1c1a17]"
          >
            Done — start scanning
          </button>
        </section>
      ) : null}

      {undoFor ? (
        <section
          aria-label="Undo check-in"
          className="fixed inset-0 z-40 flex flex-col justify-end gap-3 bg-black/70 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <div className="flex flex-col gap-3 rounded-2xl bg-[#231f1b] p-5">
            <p className="text-lg font-semibold text-white">
              Undo the check-in for {undoFor.attendeeName ?? 'this ticket'}?
            </p>
            <p className="text-sm text-white/65">Why? It goes in the record.</p>
            {(Object.keys(DOOR_UNDO_REASONS) as DoorUndoReason[]).map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => void undo(undoFor, reason)}
                className="h-12 rounded-xl border border-white/30 text-[15px] font-semibold text-white"
              >
                {DOOR_UNDO_REASONS[reason]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setUndoFor(null)}
              className="h-12 text-[15px] text-white/70 underline"
            >
              Keep them checked in
            </button>
          </div>
        </section>
      ) : null}

      {overlay ? (
        <ResultOverlay
          overlay={overlay}
          onDismiss={dismiss}
          onRetry={() => {
            const scan = retryScan.current;
            dismiss();
            if (scan) void send(scan, true);
          }}
        />
      ) : null}
    </main>
  );
}
