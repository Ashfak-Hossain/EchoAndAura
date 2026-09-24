import type { DoorUndoReason } from '@/server/lib/door-rules';
import type {
  DoorRecentScan,
  DoorSearchResult,
  DoorStatus,
  ScanMethod,
  ScanResult,
} from '@/server/services/door.service';

/**
 * The door phone's side of /door/api (ADR-030). Every call has a hard
 * timeout: at a gate a spinning request is worse than a clear "not
 * recorded — retry", and a retry re-sends the same scanId, so the server's
 * replay can never turn the person just admitted away.
 */

/** Dates arrive over JSON as ISO strings. */
type Wire<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K] extends Date | undefined
        ? string | undefined
        : T[K];
};

export type WireScanResult = Wire<ScanResult>;
export type WireSearchResult = Wire<DoorSearchResult>;
export type WireRecentScan = Wire<DoorRecentScan>;
export interface WireStatus extends Omit<Wire<DoorStatus>, 'recent'> {
  recent: WireRecentScan[];
  event: { title: string; startsAt: string };
  gate: string;
  validFrom: string;
}
export interface WireSession {
  event: { title: string; startsAt: string };
  gate: string;
  practice: boolean;
  validFrom: string;
}

export type DoorReply<T> =
  | { ok: true; data: T }
  /** The pass is not (or no longer) active. */
  | { ok: false; kind: 'signed_out'; message: string }
  | { ok: false; kind: 'slow'; retryAfter: number }
  /** A 4xx the screen should show as-is (a refused undo, a bad request). */
  | { ok: false; kind: 'refused'; message: string }
  /** No answer: offline, the 4 s timeout, or a 5xx. */
  | { ok: false; kind: 'network' };

export const DOOR_REQUEST_TIMEOUT_MS = 4_000;

function messageOf(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return body.error;
  }
  return fallback;
}

async function doorRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
): Promise<DoorReply<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOOR_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`/door/api/${path}`, {
      method,
      // The server's CSRF guard wants JSON on every write (and the browser
      // adds Origin to every non-GET request).
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const json: unknown = await res.json().catch(() => null);
    // Headers arrived but the body did not (the timeout fired mid-body, or
    // it was cut off): that is no answer, not an empty success.
    if (res.ok && (json === null || typeof json !== 'object')) {
      return { ok: false, kind: 'network' };
    }
    if (res.ok) return { ok: true, data: json as T };
    if (res.status === 401) {
      return {
        ok: false,
        kind: 'signed_out',
        message: messageOf(json, 'This gate pass is not active.'),
      };
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 10;
      return { ok: false, kind: 'slow', retryAfter };
    }
    if (res.status >= 500) return { ok: false, kind: 'network' };
    return { ok: false, kind: 'refused', message: messageOf(json, 'That did not work.') };
  } catch {
    return { ok: false, kind: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

export const doorApi = {
  signIn: (code: string) => doorRequest<WireSession>('session', 'POST', { code }),
  signOut: () => doorRequest<{ ok: true }>('session', 'DELETE'),
  status: () => doorRequest<WireStatus>('status', 'GET'),
  scan: (scan: {
    scanId: string;
    method: ScanMethod;
    input?: string;
    ticketId?: string;
    phoneLast3?: string;
    scannedAt: string;
  }) => doorRequest<{ results: WireScanResult[] }>('scans', 'POST', { scans: [scan] }),
  search: (q: string) => doorRequest<{ results: WireSearchResult[] }>('search', 'POST', { q }),
  undo: (scanId: string, reason: DoorUndoReason) =>
    doorRequest<{ ok: true }>('undo', 'POST', { scanId, reason }),
};
