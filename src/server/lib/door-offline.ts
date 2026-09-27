/**
 * ADR-034 — the gate's offline fallback, pure: the list a door phone
 * downloads, the hash that stands in for each ticket code on it, and the
 * answer the phone gives from it when there is no signal. No `node:*`
 * imports — the door phone runs this exact file, and WebCrypto is the same
 * `crypto.subtle` in Node and in the browser, so both sides hash alike.
 *
 * What an offline answer is worth: the list is a snapshot, so two offline
 * gates can both admit one screenshot. That cannot be prevented without
 * signal; the server records what each door showed and the organizer sees
 * every double entry. The phone's verdict is recorded, never trusted.
 */

/** Bumped when the list's shape changes: a phone holding an older one re-downloads. */
export const OFFLINE_LIST_VERSION = 1;

/**
 * Hex characters kept from each SHA-256: 128 bits, far past any collision
 * among a few thousand tickets, and half the payload of the full digest.
 */
const DIGEST_HEX = 32;

/** One ticket on the phone. No ticket code, no buyer contact details. */
export interface OfflineEntry {
  /** `offlineDigest(list.salt, code)`. */
  d: string;
  /** Ticket id: name search and the local "already in" mark key on it. */
  id: string;
  name: string;
  type: string;
  pos: number;
  of: number;
  status: 'issued' | 'cancelled';
  /** Checked in when the list was built: when (ISO) and at which gate. */
  inAt: string | null;
  inBy: string | null;
}

export interface OfflineList {
  v: typeof OFFLINE_LIST_VERSION;
  eventId: string;
  passId: string;
  /** Fresh per download. */
  salt: string;
  /** The server's clock when the list was built (ISO): the phone's clock offset. */
  serverTime: string;
  /** Doors open (ISO). Before it the phone answers practice, as online. */
  validFrom: string;
  validUntil: string;
  entries: OfflineEntry[];
}

/**
 * The code's stand-in on the phone. Salted so the list's hashes cannot be
 * looked up in a table, and so no two downloads match. NOT a defence
 * against brute force — codes carry ~40 bits, and anyone holding the list
 * could grind through them. It keeps codes from being read straight off a
 * door phone; the printed backup list prints them in full anyway.
 */
export async function offlineDigest(salt: string, code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${code}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const b of hash) hex += b.toString(16).padStart(2, '0');
  return hex.slice(0, DIGEST_HEX);
}

/** What the offline door phone showed; stored as `door_scans.door_verdict`. */
export type DoorVerdict = 'admitted' | 'refused' | 'practice' | 'undone';

export type OfflineResultKind = 'admitted' | 'already_in' | 'cancelled' | 'unknown' | 'practice_ok';

export interface OfflineJudgement {
  result: OfflineResultKind;
  verdict: DoorVerdict;
  practice: boolean;
  entry: OfflineEntry | null;
  /** already_in: when and where, and whether it was this phone. */
  at?: string;
  gate?: string;
  byThisPhone?: boolean;
}

/**
 * A check-in this phone knows of that is newer than its list: its own
 * admit (online or offline), or one the server told it about since.
 */
export interface LocalAdmit {
  at: string;
  gate: string;
  byThisPhone: boolean;
}

/**
 * The offline answer for one read. `entry` is null when the read did not
 * parse as a code or its hash is not on the list — offline, a ticket for
 * another event cannot be told apart from a made-up one.
 */
export function judgeOffline(input: {
  entry: OfflineEntry | null;
  localAdmit: LocalAdmit | null;
  /** The phone's clock corrected by the list's offset (ms). */
  now: number;
  validFrom: number;
}): OfflineJudgement {
  const { entry, localAdmit } = input;
  const practice = input.now < input.validFrom;
  const refused = practice ? 'practice' : 'refused';
  if (!entry) return { result: 'unknown', verdict: refused, practice, entry };
  if (entry.status === 'cancelled')
    return { result: 'cancelled', verdict: refused, practice, entry };
  // What this phone learned since the list's snapshot wins over it.
  if (localAdmit) {
    return {
      result: 'already_in',
      verdict: refused,
      practice,
      entry,
      at: localAdmit.at,
      gate: localAdmit.gate,
      byThisPhone: localAdmit.byThisPhone,
    };
  }
  if (entry.inAt) {
    return {
      result: 'already_in',
      verdict: refused,
      practice,
      entry,
      at: entry.inAt,
      gate: entry.inBy ?? undefined,
      byThisPhone: false,
    };
  }
  if (practice) return { result: 'practice_ok', verdict: 'practice', practice, entry };
  return { result: 'admitted', verdict: 'admitted', practice, entry };
}

/**
 * The server's side of an offline admit's time: the phone's corrected
 * clock, never before doors opened and never in the future. The phone's
 * clock is advisory — this only keeps "admitted 20:41" close to the truth
 * instead of stamping the moment signal came back.
 */
export function clampOfflineTime(scannedAt: Date, validFrom: Date, now: Date): Date {
  const t = Math.min(Math.max(scannedAt.getTime(), validFrom.getTime()), now.getTime());
  return new Date(t);
}
