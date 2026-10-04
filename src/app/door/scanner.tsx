'use client';

import {
  Ban,
  BatteryCharging,
  BatteryLow,
  CalendarX,
  Camera,
  CameraOff,
  Check,
  ChevronUp,
  CirclePause,
  CircleX,
  CloudOff,
  Flashlight,
  FlashlightOff,
  GraduationCap,
  Hash,
  Keyboard,
  Lock,
  LockOpen,
  type LucideIcon,
  Play,
  RefreshCw,
  ScanLine,
  SwitchCamera,
  TriangleAlert,
  Undo2,
  UserSearch,
  VideoOff,
  Volume2,
  Wifi,
  X,
} from 'lucide-react';
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
  type DoorReply,
  type WireRecentScan,
  type WireScanResult,
  type WireSearchResult,
  type WireStatus,
  doorApi,
} from './door-api';
import { loadFallbackDecoder, loadQrDetector } from './decoder';
import { DisagreeAlert } from './disagree-alert';
import { DoorSearch } from './door-search';
import { forgetPageOffline, keepPageOffline } from './offline/keep-page';
import { type OfflineApi, useOffline } from './offline/use-offline';
import { isIos, subscribeNever } from './platform';
import { AUTO_DISMISS_MS, type Overlay, ResultOverlay, viewOf } from './result-overlay';
import { type CameraProblem, useCamera } from './use-camera';
import { useFeedback } from './use-feedback';
import { useRelay } from './use-relay';
import type { RelayOwnMark } from './offline/rules';

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
/** The status ping, which also brings other gates' check-ins (ADR-053). */
const STATUS_EVERY_MS = 5_000;
/**
 * ADR-053: how long a scan the phone's own list would admit waits for the
 * server before the phone shows ADMIT itself. Refusals always wait for the
 * server: a stale list must never turn away a valid ticket.
 */
const RACE_MS = 400;
/** Re-asks a little before the last answer: a check-in committed meanwhile is never missed. */
const CHECKINS_OVERLAP_MS = 10_000;
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

/** ADR-053: an early ADMIT the server refused, waiting for staff to answer. */
interface Disagreement {
  scanId: string;
  result: WireScanResult;
  /** When this phone showed ADMIT (HH:MM, Dhaka). */
  admittedAt: string;
}

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
  const [panel, setPanel] = useState<'none' | 'type' | 'search' | 'checklist' | 'history'>('none');
  const [typed, setTyped] = useState('');
  const [undoFor, setUndoFor] = useState<RecentRow | null>(null);
  const [undoReason, setUndoReason] = useState<DoorUndoReason>('wrong_person');
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
  /** The answer on screen clears itself (green, practice): the next code may replace it. */
  const overlayAuto = useRef(false);
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
  // ADR-058: this phone's own admits go to the other gates through the relay.
  const relaySend = useRef<(mark: RelayOwnMark) => void>(() => {});
  const onOwnMark = useCallback((mark: RelayOwnMark) => relaySend.current(mark), []);
  const offline = useOffline({ passId, gate: status.gate, onSignedOut, onOwnMark });
  useEffect(() => {
    offlineRef.current = offline;
  });
  const relay = useRelay({
    ticket: offline.relay,
    onRows: offline.learnRelayRows,
    onUndo: offline.learnRelayUndo,
    ownClaims: offline.ownClaims,
  });
  useEffect(() => {
    relaySend.current = relay.send;
  }, [relay.send]);
  // The hook's functions are stable; the object around them is not. The
  // scan path must only depend on stable ones, or the handheld-scanner
  // listener would re-subscribe on every render and drop a code mid-read.
  const {
    answer: judgeOffline,
    learn: learnOnline,
    now: correctedNow,
    peek: peekOffline,
    admitEarly,
    settleEarly,
    queueEarlyAdmit,
    learnCheckIns,
  } = offline;
  /** ADR-053: early ADMITs the server then refused — each needs staff to answer. */
  const [disagreements, setDisagreements] = useState<Disagreement[]>([]);
  /** The check-ins already asked for: the next ping asks for those after this. */
  const checkInsSince = useRef<string | null>(null);

  const goOffline = useCallback((on: boolean) => {
    offlineModeRef.current = on;
    setOfflineMode(on);
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++statusSeq.current;
    const sentAt = Date.now();
    // Other gates' check-ins since the last ask, or since the list was made.
    const since = checkInsSince.current ?? offlineRef.current?.listAt ?? undefined;
    const reply = await doorApi.status(since);
    if (seq !== statusSeq.current) return;
    if (reply.ok) {
      offlineRef.current?.learnServerTime(reply.data.serverTime, sentAt, Date.now());
      if (since) {
        learnCheckIns(reply.data.checkIns);
        checkInsSince.current = new Date(
          Date.parse(reply.data.serverTime) - CHECKINS_OVERLAP_MS,
        ).toISOString();
      }
      setStatus(reply.data);
      setOnline(true);
      goOffline(false);
      if (!pinged.current) {
        pinged.current = true;
        // The decoders first, so the saved copy holds them: a reload without
        // signal must still be able to start the camera — with the
        // WebAssembly reader too, should the phone's own one fail then.
        // Failing to load them here costs nothing — Start tries again.
        void Promise.allSettled([loadQrDetector(), loadFallbackDecoder()]).then(() =>
          keepPageOffline(),
        );
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
  }, [onSignedOut, goOffline, learnCheckIns]);

  const show = useCallback(
    (next: Overlay) => {
      const view = viewOf(next);
      overlayOpen.current = true;
      overlayAuto.current = view.autoDismiss;
      setOverlay(next);
      play(view.feedback);
    },
    [play],
  );

  const dismiss = useCallback(() => {
    overlayOpen.current = false;
    overlayAuto.current = false;
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

  /**
   * ADR-053: the server's answer to a scan the phone already admitted. An
   * ADMIT confirms it; a refusal (in first at another gate, cancelled…)
   * raises the "server disagrees" alert; no answer turns it into an
   * offline admit that replaces the request, as ADR-034 would have.
   */
  const confirmEarly = useCallback(
    async (
      scan: PendingScan,
      request: Promise<DoorReply<{ results: WireScanResult[] }>>,
      ticketId: string,
      input: string,
      method: 'qr' | 'typed',
    ) => {
      const admittedAt = formatDhakaClock(new Date(correctedNow()));
      const reply = await request;
      if (reply.ok) {
        setOnline(true);
        goOffline(false);
        const result = reply.data.results[0];
        if (!result) return;
        settleEarly(ticketId, result);
        if (result.result !== 'admitted') {
          setDisagreements((list) => [...list, { scanId: scan.scanId, result, admittedAt }]);
        }
        void refresh();
        return;
      }
      if (reply.kind === 'signed_out') {
        onSignedOut(reply.message);
        return;
      }
      if (reply.kind === 'refused') {
        setNotice('That admit could not be recorded — note their name for the organizer.');
        return;
      }
      // No answer, or told to slow down: the admit stands and is sent later.
      await queueEarlyAdmit(input, method, scan.scanId);
      if (reply.kind === 'network') {
        setOnline(false);
        goOffline(true);
      }
    },
    [goOffline, settleEarly, refresh, onSignedOut, queueEarlyAdmit, correctedNow],
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
      // ADR-053: the phone's own list first — one hash, well under a
      // millisecond. Only a read it would ADMIT races the server; a retry,
      // a name search (digits are checked only there) and every refusal
      // wait for the server's answer.
      const local =
        !viaRetry && scan.input !== undefined && scan.method !== 'search'
          ? await peekOffline(scan.input)
          : null;
      const request = doorApi.scan({
        scanId: scan.scanId,
        method: scan.method,
        input: scan.input,
        ticketId: scan.ticketId,
        phoneLast3: scan.phoneLast3,
        scannedAt: new Date(correctedNow()).toISOString(),
      });
      if (local?.ticketId && local.result.result === 'admitted' && scan.input !== undefined) {
        const first = await Promise.race([
          request,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), RACE_MS)),
        ]);
        if (first === null) {
          // The server is slow: let them in now, and check behind them.
          const ticketId = local.ticketId;
          const input = scan.input;
          const method = scan.method === 'typed' ? 'typed' : 'qr';
          admitEarly(ticketId);
          done();
          show({ kind: 'result', result: { ...local.result, scanId: scan.scanId } });
          void confirmEarly(scan, request, ticketId, input, method);
          return;
        }
      }
      const reply = await request;
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
    [
      onSignedOut,
      refresh,
      show,
      answerOffline,
      correctedNow,
      learnOnline,
      goOffline,
      peekOffline,
      admitEarly,
      confirmEarly,
    ],
  );

  const submit = useCallback(
    (raw: string, method: 'qr' | 'typed', fromCamera: boolean) => {
      if (!raw.trim()) return;
      const key = scanKey(raw);
      const now = Date.now();
      if (fromCamera) {
        if (modalOpen.current) return;
        // A green on screen does not hold up the queue: another code
        // replaces it at once. Anything else waits for staff to tap.
        const replaceable = !busyRef.current && overlayAuto.current && key !== activeKey.current;
        if (!replaceable && (busyRef.current || overlayOpen.current)) {
          if (key === activeKey.current) seen.current.set(key, now);
          return;
        }
        if (replaceable) dismiss();
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
      if (fromCamera) play('read');
      void send({
        key,
        scanId: reuse?.scanId ?? crypto.randomUUID(),
        method,
        input: raw.trim().slice(0, SCAN_INPUT_MAX),
        firstAt: reuse?.firstAt ?? now,
      });
    },
    [send, play, dismiss],
  );

  const {
    video,
    state: cam,
    torch,
    zoom,
    readMs,
    decoder,
    cameras,
    awake,
    start: startCamera,
    switchCamera,
    toggleTorch,
    setZoomLevel,
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
    // Every sheet covers the viewfinder (with a backdrop): nothing is admitted behind it.
    modalOpen.current = panel !== 'none' || undoFor !== null || disagreements.length > 0;
  }, [panel, undoFor, disagreements.length]);

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

  // A notice (undo done, still checking…) is read once, then gets out of the way.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6_000);
    return () => clearTimeout(timer);
  }, [notice]);

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
  const latest = recent[0];
  const listTime = offline.listAt ? formatDhakaClock(new Date(offline.listAt)) : null;
  const countsTime = formatDhakaClock(new Date(status.serverTime));
  /** A code is on its way to the server: say so at once, never look frozen. */
  const reading = busy && !overlay;
  const sending = pending.length > 0 && offline.syncing;
  const pill = sending
    ? { icon: RefreshCw, className: 'bg-[#eda43c]/16 text-[#eda43c]' }
    : offlineMode || !online
      ? { icon: CloudOff, className: 'bg-[#a65b00] text-white' }
      : { icon: Wifi, className: 'bg-[#12803f]/22 text-[#6fd897]' };
  const PillIcon = pill.icon;
  const ProblemIcon = cam.kind === 'error' ? PROBLEM_ICON[cam.problem] : null;
  const sheetHandle = <span aria-hidden className="h-1 w-9 self-center rounded-full bg-white/25" />;

  return (
    <main
      className="mx-auto flex h-dvh w-full max-w-lg flex-col overflow-hidden"
      // How many tickets the offline list holds (e2e waits on it).
      data-offline-list={offline.ready ? offline.size : undefined}
      // Which QR reader runs and its average read time (pre-doors test, e2e).
      data-decoder={decoder ?? undefined}
      data-read-ms={readMs ?? undefined}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-white/7 pt-[max(0.5rem,env(safe-area-inset-top))] pr-2.5 pb-2 pl-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <p className="truncate font-heading text-[15px] font-bold text-white">
            {status.event.title}
          </p>
          <p className="flex min-w-0 items-center gap-1.5 text-[13px] whitespace-nowrap">
            <span className="truncate text-white/75">{status.gate}</span>
            <span aria-hidden className="text-white/55">
              ·
            </span>
            <span className="shrink-0 font-bold text-white tabular" data-testid="door-count">
              {status.checkedIn} / {status.issued} in
            </span>
            {offline.relay ? (
              // ADR-058: other gates' check-ins reach this phone live.
              <span
                data-testid="door-relay"
                data-state={relay.state}
                className={cn(
                  'flex shrink-0 items-center gap-1 text-[12px] font-semibold',
                  relay.state === 'live' ? 'text-[#7ee2a8]' : 'text-white/45',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-1.5 rounded-full',
                    relay.state === 'live' ? 'bg-[#7ee2a8]' : 'bg-white/45',
                  )}
                />
                {relay.state === 'live' ? 'Live' : relay.state === 'connecting' ? 'Linking' : 'Off'}
              </span>
            ) : null}
          </p>
        </div>
        <span
          className={cn(
            'flex h-7.5 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-bold whitespace-nowrap',
            pill.className,
          )}
        >
          <PillIcon aria-hidden className={cn('size-4', sending && 'animate-spin')} />
          {pending.length > 0 ? (
            <span className="tabular" data-testid="door-pending">
              {sending ? `Sending ${pending.length}` : `${pending.length} to send`}
            </span>
          ) : (
            <span data-testid="door-online">{online ? 'Online' : 'Offline'}</span>
          )}
        </span>
        <button
          type="button"
          onClick={endSession}
          aria-label="End session"
          className={cn(
            'h-12 min-w-13 shrink-0 rounded-xl border px-3 text-sm font-bold text-white',
            ending ? 'border-[#c4242b] bg-[#c4242b]' : 'border-white/20',
          )}
        >
          {ending ? 'Sure?' : 'End'}
        </button>
      </header>

      {ending || closing ? (
        <div className="flex shrink-0 gap-2 bg-[#2a1414] px-2.5 py-2">
          <button
            type="button"
            onClick={endSession}
            className="h-12 min-w-0 flex-1 truncate rounded-xl bg-[#c4242b] px-2.5 text-[15px] font-bold text-white"
          >
            {closing
              ? pending.length > 0
                ? 'Sending, then ending…'
                : 'Ending…'
              : pending.length > 0
                ? `${pending.length} not sent — tap to end anyway`
                : 'Tap again to end'}
          </button>
          <button
            type="button"
            onClick={() => setEnding(false)}
            disabled={closing}
            aria-label="Keep scanning"
            className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-white/20 text-white"
          >
            <X aria-hidden className="size-5.5" />
          </button>
        </div>
      ) : null}

      {offlineMode ? (
        <p
          role="status"
          data-testid="door-offline"
          className="flex shrink-0 gap-2.5 bg-[#a65b00] px-3.5 py-2.5 text-sm leading-snug font-semibold text-white"
        >
          <CloudOff aria-hidden className="mt-px size-5 shrink-0" />
          <span>
            <b>OFFLINE</b> —{' '}
            {offline.ready
              ? `answering from the ticket list of ${listTime}. Scans are sent when the signal is back.`
              : 'no ticket list on this phone. Use the printed list.'}{' '}
            <span className="font-normal">Counts as of {countsTime}.</span>
          </span>
        </p>
      ) : null}
      {offline.problem ? (
        <p role="status" className="shrink-0 bg-[#c4242b] px-3.5 py-2 text-sm text-white">
          {offline.problem}
        </p>
      ) : null}
      {status.practice ? (
        <p
          data-testid="door-practice"
          className="flex shrink-0 gap-2.5 bg-[#2457c5] px-3.5 py-2.5 text-sm leading-snug font-semibold text-white"
        >
          <GraduationCap aria-hidden className="mt-px size-5 shrink-0" />
          <span>
            <b>PRACTICE</b> — nothing is checked in until doors open at {doorsOpen}
          </span>
        </p>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#090807]">
        <video
          ref={video}
          muted
          playsInline
          autoPlay
          className="absolute inset-0 size-full object-cover"
        />
        {cam.kind === 'on' ? (
          <>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4.5 px-17.5 py-4">
              <div
                key={reading ? 'reading' : 'idle'}
                data-door-motion
                className={cn(
                  'relative aspect-square w-full max-w-57.5 shrink-0 rounded-[18px]',
                  reading && 'bg-[#eda43c]/12',
                )}
                style={
                  reading
                    ? {
                        animation:
                          'door-snap .22s ease-out, door-pulse .6s ease-in-out .22s infinite',
                      }
                    : undefined
                }
              >
                {FRAME_CORNERS.map((corner) => (
                  <span
                    key={corner}
                    className={cn(
                      'absolute size-9.5',
                      corner,
                      reading ? 'border-[#eda43c]' : 'border-white/90',
                    )}
                  />
                ))}
              </div>
              {reading ? (
                <p className="flex h-10 max-w-full min-w-0 items-center gap-2 rounded-full bg-[#eda43c] px-3.5 text-[#161412]">
                  <span
                    aria-hidden
                    className="size-4 shrink-0 animate-spin rounded-full border-[2.5px] border-[#161412]/30 border-t-[#161412]"
                  />
                  <span className="truncate text-[15px] font-bold">Checking…</span>
                </p>
              ) : (
                <p className="flex h-10 items-center text-sm whitespace-nowrap text-white/75 [text-shadow:0_1px_3px_rgb(0_0_0/0.9)]">
                  Hold the QR in the frame
                </p>
              )}
            </div>
            <div className="absolute top-3 right-3 flex flex-col gap-2.5">
              {torch.available ? (
                <button
                  type="button"
                  aria-label={torch.on ? 'Light off' : 'Light'}
                  aria-pressed={torch.on}
                  onClick={() => void toggleTorch()}
                  className={cn(
                    'flex size-13 items-center justify-center rounded-full border border-white/18',
                    torch.on ? 'bg-white text-[#161412]' : 'bg-black/55 text-white',
                  )}
                >
                  {torch.on ? (
                    <Flashlight aria-hidden className="size-6" />
                  ) : (
                    <FlashlightOff aria-hidden className="size-6" />
                  )}
                </button>
              ) : null}
              {cameras > 1 ? (
                <button
                  type="button"
                  aria-label="Switch camera"
                  onClick={() => void switchCamera()}
                  className="flex size-13 items-center justify-center rounded-full border border-white/18 bg-black/55 text-white"
                >
                  <SwitchCamera aria-hidden className="size-6" />
                </button>
              ) : null}
            </div>
            {zoom.available ? (
              <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-0.5 rounded-full border border-white/14 bg-black/60 p-0.75">
                {([1, 2] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={zoom.level === level}
                    aria-label={`Zoom ${level}x`}
                    onClick={() => void setZoomLevel(level)}
                    className={cn(
                      'h-10.5 w-12 rounded-full text-sm font-bold',
                      zoom.level === level ? 'bg-white text-[#161412]' : 'text-white',
                    )}
                  >
                    {level}x
                  </button>
                ))}
              </div>
            ) : null}
            {awake === false ? (
              <p className="absolute inset-x-3 bottom-20 rounded-lg bg-black/70 px-3 py-2 text-center text-sm text-white">
                The screen may turn off — set Auto-Lock to Never.
              </p>
            ) : null}
          </>
        ) : cam.kind === 'off' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#161412] px-6 pb-6 text-center">
            <p className="text-[15px] text-white/75">
              {status.practice ? `Doors open at ${doorsOpen}` : `Doors opened at ${doorsOpen}`}
            </p>
            <button
              type="button"
              onClick={onStart}
              className="flex h-15 w-full max-w-xs items-center justify-center gap-2 rounded-[14px] bg-[#eda43c] font-heading text-xl font-extrabold text-[#161412]"
            >
              <ScanLine aria-hidden className="size-6" />
              Start scanning
            </button>
            <p className="max-w-xs text-[13px] text-white/55">
              A handheld scanner works without starting the camera.
            </p>
          </div>
        ) : cam.kind === 'starting' ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#090807]/90">
            <p className="text-lg text-white">Starting the camera…</p>
          </div>
        ) : cam.kind === 'paused' ? (
          <button
            type="button"
            onClick={begin}
            className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-[#090807]/92 p-6 text-center"
          >
            {cam.why === 'idle' ? (
              <BatteryLow aria-hidden className="size-9 text-white/55" />
            ) : (
              <CirclePause aria-hidden className="size-9 text-white/55" />
            )}
            <span className="font-heading text-[22px] leading-tight font-bold text-balance text-white">
              {cam.why === 'idle' ? 'Camera paused to save battery' : 'Scanning paused'}
            </span>
            <span className="flex size-42 flex-col items-center justify-center gap-1 rounded-full bg-[#eda43c] text-[#161412]">
              <Play aria-hidden className="size-11 fill-current" />
              <span className="font-heading text-lg font-extrabold">Tap to resume</span>
            </span>
          </button>
        ) : (
          <div className="absolute inset-0 flex flex-col justify-center gap-4 overflow-y-auto bg-[#161412] px-5.5 py-6">
            {ProblemIcon ? (
              <span className="flex size-14 items-center justify-center rounded-2xl bg-[#231f1b]">
                <ProblemIcon aria-hidden className="size-7.5 text-[#eda43c]" />
              </span>
            ) : null}
            <p className="font-heading text-2xl leading-tight font-extrabold text-balance text-white">
              {PROBLEM_TEXT[cam.problem].title}
            </p>
            <p className="text-base leading-normal text-pretty text-white/75">
              {ios ? PROBLEM_TEXT[cam.problem].ios : PROBLEM_TEXT[cam.problem].other}
            </p>
            <button
              type="button"
              onClick={begin}
              className="mt-1.5 h-14 rounded-[14px] bg-[#eda43c] font-heading text-lg font-extrabold text-[#161412]"
            >
              Try again
            </button>
          </div>
        )}

        {overlay ? (
          <ResultOverlay
            overlay={overlay}
            gate={status.gate}
            onDismiss={dismiss}
            onRetry={() => {
              const scan = retryScan.current;
              dismiss();
              if (scan) void send(scan, true);
            }}
          />
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setPanel('history')}
        aria-label="Last scans here"
        className="relative z-10 -mt-3 flex shrink-0 flex-col gap-1 rounded-t-2xl bg-[#231f1b] px-3 py-1.5 text-left"
      >
        {sheetHandle}
        <span className="flex min-h-11 min-w-0 items-center gap-2.5">
          {latest ? (
            <>
              <RowIcon row={latest} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">
                {latest.attendeeName ?? 'Unknown code'}
              </span>
              <span className="shrink-0 font-mono text-[13px] text-white/55">
                {formatDhakaClock(new Date(latest.at))}
              </span>
              <span className="max-w-[38%] shrink-0 truncate text-[13px] font-bold text-white/75 max-[340px]:hidden">
                {rowLabel(latest)}
              </span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm text-white/55">
              Nothing scanned at this gate yet.
            </span>
          )}
          <ChevronUp aria-hidden className="size-5 shrink-0 text-white/55" />
        </span>
      </button>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-white/6 bg-[#231f1b] px-2.5 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => setPanel('type')}
          className="flex h-13 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-white/14 bg-[#2d2823] px-2 text-white"
        >
          <Keyboard aria-hidden className="size-5 shrink-0 max-[340px]:hidden" />
          <span className="truncate text-[15px] font-bold">Type a code</span>
        </button>
        <button
          type="button"
          onClick={() => setPanel('search')}
          className="flex h-13 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-white/14 bg-[#2d2823] px-2 text-white"
        >
          <UserSearch aria-hidden className="size-5 shrink-0 max-[340px]:hidden" />
          <span className="truncate text-[15px] font-bold">Find by name</span>
        </button>
      </div>

      {notice ? (
        <p
          role="status"
          onClick={() => setNotice(null)}
          className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-70 mx-auto max-w-md rounded-xl border border-white/10 bg-[#2d2823] px-3.5 py-3 text-sm text-white shadow-lg"
        >
          {notice}
        </p>
      ) : null}

      {panel === 'type' ? (
        <>
          <div
            aria-hidden
            className="fixed inset-0 z-40 bg-black/60"
            onClick={() => setPanel('none')}
          />
          <form
            aria-label="Type a code"
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-lg flex-col gap-3 rounded-t-[20px] bg-[#231f1b] px-4 pt-2.5 pb-[max(1rem,env(safe-area-inset-bottom))]"
            onSubmit={(e) => {
              e.preventDefault();
              if (!typed.trim() || busy) return;
              touchCamera();
              const code = typed;
              setTyped('');
              // The answer shows over the camera view: the sheet must not hide it.
              setPanel('none');
              submit(code, 'typed', false);
            }}
          >
            {sheetHandle}
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-heading text-xl font-extrabold text-white">Type a code</h2>
              <button
                type="button"
                onClick={() => setPanel('none')}
                aria-label="Close"
                className="-mr-2.5 flex size-12 items-center justify-center text-white"
              >
                <X aria-hidden className="size-6" />
              </button>
            </div>
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
              className="h-15 min-w-0 rounded-xl border-2 border-[#eda43c] bg-[#161412] px-3.5 font-mono text-[22px] tracking-[0.06em] text-white placeholder:text-white/30 focus:outline-none"
            />
            <p className="text-[13px] text-white/55">Printed under the QR, e.g. TKT-XXXXXXXX</p>
            <button
              type="submit"
              disabled={busy}
              className="h-14 rounded-[14px] bg-[#eda43c] font-heading text-lg font-extrabold text-[#161412] disabled:opacity-60"
            >
              Check
            </button>
          </form>
        </>
      ) : null}

      {panel === 'history' ? (
        <>
          <div
            aria-hidden
            className="fixed inset-0 z-40 bg-black/60"
            onClick={() => setPanel('none')}
          />
          <section
            aria-label="Last scans at this gate"
            className="fixed inset-x-0 top-16 bottom-0 z-50 mx-auto flex max-w-lg flex-col rounded-t-[20px] bg-[#231f1b]"
          >
            <div className="flex shrink-0 flex-col gap-2 px-4 pt-2.5 pb-1">
              {sheetHandle}
              <div className="flex items-center gap-2">
                <h2 className="min-w-0 flex-1 truncate font-heading text-xl font-extrabold text-white">
                  Last scans here
                </h2>
                <span className="shrink-0 text-[13px] text-white/55">
                  Undo within {DOOR_UNDO_WINDOW_MS / 60_000} min
                </span>
                <button
                  type="button"
                  onClick={() => setPanel('none')}
                  aria-label="Close"
                  className="-mr-2.5 flex size-12 shrink-0 items-center justify-center text-white"
                >
                  <X aria-hidden className="size-6" />
                </button>
              </div>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {recent.length === 0 ? (
                <li className="py-6 text-center text-sm text-white/55">
                  Nothing scanned at this gate yet.
                </li>
              ) : (
                recent.map((r) => (
                  <li
                    key={r.scanId}
                    className="flex min-h-15 items-center gap-2.5 border-b border-white/6 px-1 py-1.5"
                  >
                    <RowIcon row={r} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[15px] font-semibold text-white">
                        {r.attendeeName ?? 'Unknown code'}
                      </span>
                      <span className="flex min-w-0 gap-1.5 text-[13px] whitespace-nowrap">
                        <span className="shrink-0 font-mono text-white/55">
                          {formatDhakaClock(new Date(r.at))}
                        </span>
                        <span className="truncate text-white/75">
                          {[r.ticketTypeName, rowLabel(r)].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </div>
                    {r.undoable ? (
                      <button
                        type="button"
                        onClick={() => {
                          setUndoReason('wrong_person');
                          setUndoFor(r);
                        }}
                        className="h-12 shrink-0 rounded-xl border border-white/20 px-3.5 text-sm font-bold text-white"
                      >
                        Undo
                      </button>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </section>
        </>
      ) : null}

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
          className="fixed inset-0 z-50 flex flex-col gap-4.5 overflow-y-auto bg-[#161412] px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <div className="flex flex-col gap-1.5">
            <h2 className="font-heading text-[28px] leading-tight font-extrabold text-white">
              Before you start on iPhone
            </h2>
            <p className="text-[15px] text-white/75">Shown once on this phone.</p>
          </div>
          <ul className="flex flex-col gap-2">
            {IOS_CHECKLIST.map(({ icon: Icon, title, body }) => (
              <li
                key={title}
                className="flex items-start gap-3.5 rounded-[14px] bg-[#231f1b] p-3.5"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#eda43c]/14">
                  <Icon aria-hidden className="size-5.5 text-[#eda43c]" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-base font-bold text-white">{title}</span>
                  <span className="text-sm leading-snug text-white/75">{body}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => {
              writeFlag(IOS_CHECKLIST_KEY);
              setPanel('none');
              begin();
            }}
            className="h-15 shrink-0 rounded-[14px] bg-[#eda43c] font-heading text-xl font-extrabold text-[#161412]"
          >
            Done — start scanning
          </button>
        </section>
      ) : null}

      {undoFor ? (
        <>
          <div
            aria-hidden
            className="fixed inset-0 z-55 bg-black/60"
            onClick={() => setUndoFor(null)}
          />
          <section
            aria-label="Undo check-in"
            className="fixed inset-x-0 bottom-0 z-60 mx-auto flex max-w-lg flex-col gap-3 rounded-t-[20px] bg-[#231f1b] px-4 pt-2.5 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            {sheetHandle}
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="font-heading text-xl font-extrabold text-white">Undo check-in?</h2>
              <p className="truncate text-sm text-white/75">
                {[
                  undoFor.attendeeName ?? 'This ticket',
                  undoFor.ticketTypeName,
                  formatDhakaClock(new Date(undoFor.at)),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <p className="text-[13px] text-white/55">Why? It goes in the record.</p>
            <div role="radiogroup" aria-label="Reason" className="flex flex-col gap-1.5">
              {(Object.keys(DOOR_UNDO_REASONS) as DoorUndoReason[]).map((reason) => {
                const on = undoReason === reason;
                return (
                  <button
                    key={reason}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setUndoReason(reason)}
                    className={cn(
                      'flex min-h-13 items-center gap-2.5 rounded-xl border-2 bg-[#2d2823] px-3 text-left text-white',
                      on ? 'border-[#eda43c]' : 'border-white/10',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full border-2',
                        on ? 'border-[#eda43c]' : 'border-white/40',
                      )}
                    >
                      {on ? <span className="size-2.5 rounded-full bg-[#eda43c]" /> : null}
                    </span>
                    <span className="truncate text-[15px]">{DOOR_UNDO_REASONS[reason]}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setUndoFor(null)}
              className="h-14 rounded-[14px] bg-[#eda43c] font-heading text-lg font-extrabold text-[#161412]"
            >
              Keep them checked in
            </button>
            <button
              type="button"
              onClick={() => void undo(undoFor, undoReason)}
              className="h-13 rounded-[14px] border border-[#ff8a80]/60 text-base font-bold text-[#ff8a80]"
            >
              Undo check-in
            </button>
          </section>
        </>
      ) : null}
      {disagreements[0] ? (
        <DisagreeAlert
          key={disagreements[0].scanId}
          result={disagreements[0].result}
          admittedAt={disagreements[0].admittedAt}
          play={play}
          onAnswer={async (decision) => {
            const d = disagreements[0]!;
            const reply = await doorApi.decide(d.scanId, decision);
            setDisagreements((list) => list.filter((x) => x.scanId !== d.scanId));
            if (reply.ok) return;
            if (reply.kind === 'signed_out') {
              onSignedOut(reply.message);
              return;
            }
            const who = d.result.attendeeName ?? 'this ticket';
            setNotice(
              `Not recorded (${reply.kind === 'network' ? 'no signal' : 'refused'}) — tell the organizer: ${who}, ${decision === 'let_in' ? 'let in anyway' : 'turned away'}.`,
            );
          }}
        />
      ) : null}
    </main>
  );
}

/** Corner brackets of the scan frame (top-left, top-right, bottom-left, bottom-right). */
const FRAME_CORNERS = [
  'top-0 left-0 rounded-tl-[18px] border-t-[5px] border-l-[5px]',
  'top-0 right-0 rounded-tr-[18px] border-t-[5px] border-r-[5px]',
  'bottom-0 left-0 rounded-bl-[18px] border-b-[5px] border-l-[5px]',
  'bottom-0 right-0 rounded-br-[18px] border-b-[5px] border-r-[5px]',
];

const PROBLEM_ICON: Record<CameraProblem, LucideIcon> = {
  denied: CameraOff,
  busy: VideoOff,
  none: CameraOff,
  insecure: LockOpen,
  decoder: TriangleAlert,
};

const IOS_CHECKLIST: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Camera,
    title: 'Allow camera',
    body: 'Tap aA in the address bar → Website Settings → Camera: Allow.',
  },
  {
    icon: Lock,
    title: 'Auto-Lock: Never',
    body: 'Settings → Display & Brightness → Auto-Lock (for tonight).',
  },
  {
    icon: Volume2,
    title: 'Volume up',
    body: 'The beep tells you the answer without looking.',
  },
  {
    icon: BatteryCharging,
    title: 'Power bank in',
    body: 'Scanning all night drains the battery.',
  },
];

const RED = 'bg-[#c4242b]';
/** The small coloured square in front of a scan row: same colour and icon as its answer. */
const ROW_LOOK: Record<string, { icon: LucideIcon; bg: string }> = {
  admitted: { icon: Check, bg: 'bg-[#12803f]' },
  practice_ok: { icon: GraduationCap, bg: 'bg-[#2457c5]' },
  practice: { icon: GraduationCap, bg: 'bg-[#2457c5]' },
  already_in: { icon: Ban, bg: RED },
  turned_away: { icon: Ban, bg: RED },
  refused: { icon: Ban, bg: RED },
  cancelled: { icon: CircleX, bg: RED },
  wrong_event: { icon: CalendarX, bg: RED },
  phone_mismatch: { icon: Hash, bg: RED },
  undone: { icon: Undo2, bg: 'bg-white/15' },
};

function RowIcon({ row }: { row: RecentRow }) {
  const look = ROW_LOOK[row.result] ?? { icon: X, bg: RED };
  const Icon = look.icon;
  return (
    <span
      aria-hidden
      className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', look.bg)}
    >
      <Icon className="size-4.5 text-white" strokeWidth={2.5} />
    </span>
  );
}

function rowLabel(r: RecentRow): string {
  return (r.offline ? VERDICT_LABEL[r.result] : RESULT_LABEL[r.result]) ?? r.result;
}
