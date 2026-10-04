import { DOOR_UNDO_WINDOW_MS } from '@/server/lib/door-rules';
import type { OutboxItem } from './store';

/**
 * ADR-034: the door phone's two bookkeeping rules, pure so they are tested
 * without a browser.
 */

/**
 * A list's "as of" is the server's clock, a mark's `knownSince` this
 * phone's corrected one — good to about half a round trip. A mark
 * outlives the list by this much rather than risk forgetting someone this
 * gate let in.
 */
export const MARK_GRACE_MS = 15_000;

/**
 * May a new list (read as of `listAsOf`, server clock) replace this phone's
 * own "already in" mark? Only once the server is known to have had the
 * check-in before the list was read. Never by when the person walked in:
 * an offline admit can be long before the server heard of it.
 */
export function listCovers(knownSince: number | null, listAsOf: number): boolean {
  return knownSince !== null && knownSince + MARK_GRACE_MS < listAsOf;
}

/** `sent`: it went to the server at least once — only the online undo is safe now. */
export type OfflineUndo = 'done' | 'sent' | 'not_found';

/**
 * May the door undo this outbox scan on the phone (sending it as UNDONE)?
 * Not once it was sent, even unanswered: the ADMIT may already stand on
 * the server, and a later UNDONE under the same scan id cannot take it back.
 */
export function localUndo(
  item: Pick<OutboxItem, 'verdict' | 'attempted' | 'scannedAt'> | undefined,
  now: number,
  inFlight: boolean,
): OfflineUndo {
  if (!item || item.verdict !== 'admitted') return 'not_found';
  if (item.attempted || inFlight) return 'sent';
  if (now - Date.parse(item.scannedAt) > DOOR_UNDO_WINDOW_MS) return 'not_found';
  return 'done';
}

/**
 * Where a phone's "already in" mark came from. `own`: this phone let them
 * in. `server`: the server said so (an answer, the status ping). `relay`:
 * another gate said so through the relay (ADR-058) — a claim until the
 * server confirms it.
 */
export type MarkSource = 'own' | 'server' | 'relay';

export interface Mark {
  /** When they were checked in (corrected clock, ms) — what the screen says. */
  at: number;
  gate: string;
  byThisPhone: boolean;
  /**
   * When the server is known to have had this check-in (corrected clock,
   * ms); null while it does not yet (an unsent admit here, or another
   * gate's unconfirmed claim). A new list drops the mark only if the list
   * was read after this.
   */
  knownSince: number | null;
  source: MarkSource;
}

/** A row from the relay (relay/src/room.ts `RoomCheckIn`). */
export interface RelayRow {
  ticketId: string;
  at: string;
  gate: string | null;
  confirmed: boolean;
  seq: number;
}

/** What this phone tells the relay: its own admit, or taking it back. */
export type RelayOwnMark =
  { t: 'in'; ticketId: string; at: number } | { t: 'undo'; ticketId: string };

/**
 * ADR-058: a relay row against this phone's mark for the ticket. Returns the
 * new mark, or null for no change. A claim the server has not confirmed is
 * kept with `knownSince: null`, so no list download can drop it before the
 * server knows (S1); the server's confirmation then sets it. This phone's
 * own marks and the server's are never touched.
 */
export function markFromRelay(existing: Mark | undefined, row: RelayRow, now: number): Mark | null {
  const at = Date.parse(row.at);
  if (!Number.isFinite(at)) return null;
  if (!existing) {
    return {
      at,
      gate: row.gate ?? '?',
      byThisPhone: false,
      knownSince: row.confirmed ? now : null,
      source: 'relay',
    };
  }
  if (existing.source === 'relay' && (existing.knownSince === null || row.confirmed)) {
    return {
      ...existing,
      at,
      gate: row.gate ?? existing.gate,
      knownSince: row.confirmed ? (existing.knownSince ?? now) : null,
    };
  }
  return null;
}

/** Two clocks' "same moment": the server's ISO time against a phone's ms. */
const SAME_CHECK_IN_MS = 1_000;
/** A claim this much newer than an undone check-in is a re-admit (relay/src/room.ts). */
export const UNDO_SLACK_MS = 5_000;

/**
 * ADR-058: does an undo heard through the relay remove this phone's mark?
 * - This phone's own admit the server has not had yet: never.
 * - A gate taking back its claim (`gate`; the room checked it is that
 *   pass's own): only a mark that is still an unconfirmed relay claim —
 *   never one the server or the ping vouched for (B1).
 * - The server's undo names the check-in it undid by time: it removes that
 *   check-in, or an unconfirmed claim from before it — never a re-admit or
 *   a newer claim (S4, S-B).
 */
export function relayUndoRemoves(
  mark: Mark | undefined,
  undo: { by: 'gate' | 'server'; at: string },
): boolean {
  if (!mark) return false;
  if (mark.source === 'own' && mark.knownSince === null) return false;
  const unconfirmedClaim = mark.source === 'relay' && mark.knownSince === null;
  if (undo.by === 'gate') return unconfirmedClaim;
  const at = Date.parse(undo.at);
  if (!Number.isFinite(at)) return false;
  if (unconfirmedClaim) return mark.at <= at + UNDO_SLACK_MS;
  return Math.abs(mark.at - at) < SAME_CHECK_IN_MS;
}

/**
 * ADR-058: what this phone re-sends each time its relay link opens (S3): a
 * message may have gone into a dead socket. Its own admits the server has
 * not had, and its local undos still in the outbox. The room ignores
 * repeats.
 */
export function unconfirmedOwnClaims(
  marks: ReadonlyMap<string, Mark>,
  outbox: readonly Pick<OutboxItem, 'verdict' | 'ticketId'>[],
): RelayOwnMark[] {
  const out: RelayOwnMark[] = [];
  for (const [ticketId, m] of marks) {
    if (m.source === 'own' && m.knownSince === null) out.push({ t: 'in', ticketId, at: m.at });
  }
  for (const item of outbox) {
    if (item.verdict === 'undone' && item.ticketId && !marks.has(item.ticketId)) {
      out.push({ t: 'undo', ticketId: item.ticketId });
    }
  }
  return out;
}
